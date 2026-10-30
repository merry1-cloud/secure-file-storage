import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Form,
  Modal,
  Progress,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { LockOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons';
import type { CipherAlgorithm, HashAlgorithm } from '@/core/types/crypto';
import type { EncryptTimings } from '@/core/types/file';
import type { EncryptedJobResult } from '@/workers/protocol';
import {
  startEncryptJob,
  type JobHandle,
} from '@/workers/workerClient';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { logAudit } from '@/core/audit/auditService';
import { randomUuid } from '@/core/crypto/random';
import { errorCode, errorText } from '@/lib/errors';
import {
  formatBytes,
  formatDuration,
  kdfLabel,
  shortFingerprint,
} from '@/lib/format';

const { Text } = Typography;

type QueueStatus = 'waiting' | 'running' | 'done' | 'error' | 'cancelled';

interface QueueItem {
  index: number;
  file: File;
  status: QueueStatus;
  percent: number;
  stage?: string;
  error?: string;
  timings?: EncryptTimings;
}

export interface EncryptDialogProps {
  open: boolean;
  files: File[];
  onClose(): void;
  onComplete(): void;
}

const STAGE_TEXT: Record<string, string> = {
  hash: '计算内容哈希',
  encrypt: '分块 AES-GCM 加密',
};

export function EncryptDialog({
  open,
  files,
  onClose,
  onComplete,
}: EncryptDialogProps): JSX.Element {
  const { message } = AntApp.useApp();
  const session = useSessionStore((state) => state.session);
  const defaultCipher = useSettingsStore((state) => state.defaultCipher);
  const defaultHash = useSettingsStore((state) => state.defaultHashAlg);
  const [form] = Form.useForm();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancelRef = useRef(false);
  const handlesRef = useRef(new Map<number, JobHandle<EncryptedJobResult>>());
  const hashAlg = Form.useWatch('hashAlg', form) as HashAlgorithm | undefined;

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      cipher: defaultCipher,
      hashAlg: defaultHash,
    });
    setQueue(
      files.map((file, index) => ({
        index,
        file,
        status: 'waiting',
        percent: 0,
      })),
    );
    setRunning(false);
    setCancelling(false);
    cancelRef.current = false;
    handlesRef.current.clear();
  }, [open, files, form, defaultCipher, defaultHash]);

  const updateItem = (index: number, patch: Partial<QueueItem>): void => {
    setQueue((current) =>
      current.map((item) => (item.index === index ? { ...item, ...patch } : item)),
    );
  };

  const start = async (): Promise<void> => {
    if (!session) {
      message.error('保管库未解锁');
      return;
    }
    let values: { cipher: CipherAlgorithm; hashAlg: HashAlgorithm };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (files.length === 0) return;

    setRunning(true);
    setCancelling(false);
    cancelRef.current = false;
    let success = 0;
    let failed = 0;

    for (const item of queue) {
      if (cancelRef.current) {
        updateItem(item.index, { status: 'cancelled', percent: 0 });
        continue;
      }
      updateItem(item.index, { status: 'running', percent: 0, error: undefined });
      const fileId = randomUuid();
      try {
        const handle = startEncryptJob(
          {
            file: {
              name: item.file.name,
              mime: item.file.type || 'application/octet-stream',
              size: item.file.size,
              blob: item.file,
            },
            fileId,
            options: {
              cipher: values.cipher,
              hashAlg: values.hashAlg,
              kdfParams: session.kdfParams,
              kcv: session.kcv,
            },
            vmk: session.vmk,
            signingKey: session.privateKey,
            signer: {
              subject: session.cert.subject,
              serialNumber: session.cert.serialNumber,
              certPem: session.cert.pem,
              certSha256: session.cert.fingerprint,
            },
          },
          ({ stage, done, total }) => {
            updateItem(item.index, {
              stage,
              percent: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0,
            });
          },
        );
        handlesRef.current.set(item.index, handle);
        const result = await handle.promise;
        success += 1;
        updateItem(item.index, {
          status: 'done',
          percent: 100,
          timings: result.timings,
          stage: '完成',
        });
        await logAudit('file.encrypt', 'success', {
          fileId,
          detail: {
            name: item.file.name,
            size: item.file.size,
            cipher: values.cipher,
            hashAlg: values.hashAlg,
          },
        });
      } catch (error) {
        if (errorCode(error) === 'E_CANCELLED') {
          updateItem(item.index, { status: 'cancelled', percent: 0, error: '已取消' });
        } else {
          failed += 1;
          updateItem(item.index, {
            status: 'error',
            error: errorText(error),
          });
          await logAudit('file.encrypt', 'failure', {
            fileId,
            errorCode: errorCode(error),
            detail: { name: item.file.name },
          });
        }
      } finally {
        handlesRef.current.delete(item.index);
      }
    }

    setRunning(false);
    setCancelling(false);
    onComplete();
    if (success > 0) {
      message.success(`已加密并签名 ${success} 个文件${failed > 0 ? `，${failed} 个失败` : ''}`);
    } else if (failed > 0) {
      message.error('加密失败，请查看文件列表中的错误信息');
    } else if (cancelRef.current) {
      message.info('加密已取消');
    }
  };

  const cancel = (): void => {
    cancelRef.current = true;
    setCancelling(true);
    for (const handle of handlesRef.current.values()) {
      handle.cancel();
    }
  };

  const close = (): void => {
    if (running) {
      cancel();
      return;
    }
    onClose();
  };

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <Modal
      open={open}
      title="加密并签名文件"
      width={760}
      onCancel={close}
      closable={!running}
      maskClosable={false}
      destroyOnClose
      footer={[
        running ? (
          <Button
            key="cancel"
            danger
            icon={<StopOutlined />}
            loading={cancelling}
            onClick={cancel}
          >
            取消任务
          </Button>
        ) : (
          <Button key="close" onClick={onClose}>
            关闭
          </Button>
        ),
        <Button
          key="start"
          type="primary"
          icon={<LockOutlined />}
          loading={running}
          disabled={running || files.length === 0 || !session}
          onClick={() => void start()}
        >
          开始加密
        </Button>,
      ]}
    >
      <Form form={form} name="encrypt-file-form" layout="vertical">
        <div className="dialog-section">
          <Space split={<span className="dot-divider" />} wrap>
            <Text strong>{files.length} 个文件</Text>
            <Text type="secondary">合计 {formatBytes(totalBytes)}</Text>
            <Tag color="blue" icon={<SafetyCertificateOutlined />}>
              RSA-3072 签名（强制）
            </Tag>
          </Space>
        </div>

        <div className="dialog-grid">
          <Form.Item name="cipher" label="对称加密算法" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'AES-256-GCM', label: 'AES-256-GCM（推荐）' },
                { value: 'AES-128-GCM', label: 'AES-128-GCM' },
              ]}
            />
          </Form.Item>
          <Form.Item name="hashAlg" label="完整性哈希" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'SHA-256', label: 'SHA-256（推荐）' },
                { value: 'SHA-1', label: 'SHA-1（不安全，仅演示）' },
              ]}
            />
          </Form.Item>
        </div>

        {hashAlg === 'SHA-1' ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="SHA-1 仅演示用"
            description="签名摘要始终为 SHA-256。"
          />
        ) : null}

        {session && (
          <Descriptions
            size="small"
            column={1}
            bordered
            style={{ marginBottom: 16 }}
            items={[
              {
                key: 'kdf',
                label: '密钥派生',
                children: kdfLabel(session.kdfParams),
              },
              {
                key: 'signer',
                label: '签名者证书',
                children: (
                  <Space wrap>
                    <span>{session.cert.subject}</span>
                    <Tag className="mono">
                      {shortFingerprint(session.cert.fingerprint)}
                    </Tag>
                  </Space>
                ),
              },
              {
                key: 'chunk',
                label: '分块策略',
                children: '4 MiB/块，独立 IV 与认证标签',
              },
            ]}
          />
        )}

        <div className="queue-list">
          {queue.map((item) => (
            <div key={`${item.file.name}-${item.index}`} className="queue-item">
              <div className="queue-item-head">
                <div className="queue-file">
                  <Text strong ellipsis={{ tooltip: item.file.name }}>
                    {item.file.name}
                  </Text>
                  <Text type="secondary">
                    {formatBytes(item.file.size)} · {item.file.type || '未知类型'}
                  </Text>
                </div>
                <QueueStatusTag item={item} />
              </div>
              {item.status === 'running' && (
                <div className="queue-progress">
                  <Progress percent={item.percent} size="small" />
                  <Text type="secondary">{STAGE_TEXT[item.stage ?? ''] ?? item.stage ?? '处理中'}</Text>
                </div>
              )}
              {item.status === 'done' && item.timings && (
                <div className="queue-detail">
                  总耗时 {formatDuration(item.timings.totalMs)} · 哈希{' '}
                  {formatDuration(item.timings.hashMs)} · AES{' '}
                  {formatDuration(item.timings.encryptMs)} · 签名{' '}
                  {formatDuration(item.timings.signMs)}
                </div>
              )}
              {item.error && <div className="queue-error">{item.error}</div>}
            </div>
          ))}
        </div>
      </Form>
    </Modal>
  );
}

function QueueStatusTag({ item }: { item: QueueItem }): JSX.Element {
  switch (item.status) {
    case 'waiting':
      return <Tag>等待</Tag>;
    case 'running':
      return <Tag color="processing">加密中</Tag>;
    case 'done':
      return <Tag color="success">已完成</Tag>;
    case 'error':
      return <Tag color="error">失败</Tag>;
    case 'cancelled':
      return <Tag>已取消</Tag>;
    default:
      return <Tag>—</Tag>;
  }
}
