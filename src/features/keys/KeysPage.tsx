import { useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  List,
  Popconfirm,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CloudDownloadOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  ExportOutlined,
  ImportOutlined,
  KeyOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type { TrustedCert } from '@/core/types/key';
import {
  listTrustedCertificates,
  untrustCertificate,
} from '@/core/keys/trustStore';
import {
  exportPublicKeySpki,
  importPublicKeyJwk,
  spkiToPem,
} from '@/core/crypto/rsa';
import { logAudit } from '@/core/audit/auditService';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { downloadText } from '@/lib/download';
import { errorText } from '@/lib/errors';
import {
  formatBytes,
  formatDate,
  groupFingerprint,
  kdfLabel,
  shortFingerprint,
} from '@/lib/format';
import { Fingerprint } from '@/components/ui/Fingerprint';
import { ExportKeyDialog } from './components/ExportKeyDialog';
import { BackupDialog } from './components/BackupDialog';
import { RestoreDialog } from './components/RestoreDialog';
import { ImportKeyDialog } from './components/ImportKeyDialog';
import { ChangePasswordDialog } from './components/ChangePasswordDialog';

const { Text, Title, Paragraph } = Typography;

const SOURCE_LABEL: Record<TrustedCert['source'], { label: string; color: string }> = {
  self: { label: '本机创建', color: 'green' },
  imported: { label: '导入/恢复', color: 'purple' },
  manual: { label: '手动信任', color: 'gold' },
};

export function KeysPage(): JSX.Element {
  const { message } = AntApp.useApp();
  const keyring = useSessionStore((state) => state.keyring);
  const session = useSessionStore((state) => state.session);
  const storagePersisted = useSessionStore((state) => state.storagePersisted);
  const requestPersistence = useSessionStore((state) => state.requestPersistence);
  const autoLockMinutes = useSettingsStore((state) => state.autoLockMinutes);

  const [trusted, setTrusted] = useState<TrustedCert[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [importKeyOpen, setImportKeyOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({});
  const [busy, setBusy] = useState<string>();

  const loadTrusted = async (): Promise<void> => {
    try {
      setTrusted(await listTrustedCertificates());
    } catch (error) {
      setTrusted([]);
      message.error(errorText(error));
    }
  };

  const loadStorage = async (): Promise<void> => {
    try {
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        setStorage({ usage: estimate.usage, quota: estimate.quota });
      }
    } catch {
      setStorage({});
    }
  };

  useEffect(() => {
    void loadTrusted();
    void loadStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!keyring) {
    return <Alert type="info" showIcon message="正在加载密钥环信息…" />;
  }

  const exportCertificate = async (): Promise<void> => {
    downloadText(
      keyring.cert.pem,
      `certificate-${shortFingerprint(keyring.cert.fingerprint).replace('…', '-')}.pem`,
      'application/x-pem-file',
    );
    await logAudit('key.export', 'success', { detail: { type: 'certificate' } });
    message.success('证书 PEM 已导出');
  };

  const exportPublicKey = async (): Promise<void> => {
    setBusy('public-key');
    try {
      const key = await importPublicKeyJwk(keyring.publicKeyJwk);
      const spki = await exportPublicKeySpki(key);
      downloadText(spkiToPem(spki), 'public-key.pem', 'application/x-pem-file');
      await logAudit('key.export', 'success', { detail: { type: 'public-key' } });
      message.success('公钥 PEM 已导出');
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setBusy(undefined);
    }
  };

  const removeTrust = async (record: TrustedCert): Promise<void> => {
    try {
      await untrustCertificate(record.fingerprint);
      await loadTrusted();
      message.success('证书已从信任库移除；其签名的容器将无法通过验证');
    } catch (error) {
      message.error(errorText(error));
    }
  };

  const isCurrentCert = (record: TrustedCert): boolean =>
    record.fingerprint.toLowerCase() === keyring.cert.fingerprint.toLowerCase();

  return (
    <div className="page-stack">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card className="keys-card" bordered={false}>
            <div className="section-heading">
              <Space>
                <span className="card-icon"><LockOutlined /></span>
                <div>
                  <Title level={4}>保管库状态</Title>
                  <Text type="secondary">本地密钥环与会话</Text>
                </div>
              </Space>
              <Tag color="success">已解锁</Tag>
            </div>
            <Descriptions
              column={1}
              size="small"
              items={[
                { key: 'name', label: '显示名称', children: keyring.displayName },
                {
                  key: 'user',
                  label: '会话用户',
                  children: session?.displayName ?? keyring.displayName,
                },
                { key: 'kdf', label: 'KDF 档位', children: kdfLabel(keyring.kdfParams) },
                {
                  key: 'autolock',
                  label: '自动锁定',
                  children: autoLockMinutes > 0 ? `${autoLockMinutes} 分钟无操作` : '已关闭',
                },
                {
                  key: 'persist',
                  label: '存储持久化',
                  children: storagePersisted ? (
                    <Tag color="success">已获浏览器授权</Tag>
                  ) : (
                    <Space>
                      <Tag>未授权</Tag>
                      <Button
                        size="small"
                        icon={<SyncOutlined />}
                        onClick={() => void requestPersistence()}
                      >
                        请求
                      </Button>
                    </Space>
                  ),
                },
                {
                  key: 'storage',
                  label: '存储估算',
                  children:
                    storage.usage !== undefined && storage.quota !== undefined ? (
                      <span>
                        {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
                      </span>
                    ) : (
                      '浏览器未提供'
                    ),
                },
                {
                  key: 'created',
                  label: '创建时间',
                  children: formatDate(keyring.createdAt),
                },
              ]}
            />
            <Divider />
            <Paragraph type="secondary" className="small-paragraph">
              主口令不落盘，密钥仅存内存。
            </Paragraph>
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card className="keys-card" bordered={false}>
            <div className="section-heading">
              <Space>
                <span className="card-icon"><SafetyCertificateOutlined /></span>
                <div>
                  <Title level={4}>签名证书</Title>
                  <Text type="secondary">自签名 X.509 · RSA-3072</Text>
                </div>
              </Space>
              <Space>
                <Button
                  icon={<ExportOutlined />}
                  onClick={() => void exportCertificate()}
                >
                  导出证书
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  loading={busy === 'public-key'}
                  onClick={() => void exportPublicKey()}
                >
                  导出公钥
                </Button>
              </Space>
            </div>
            <Descriptions
              column={1}
              size="small"
              items={[
                { key: 'subject', label: '主题', children: keyring.cert.subject },
                {
                  key: 'serial',
                  label: '序列号',
                  children: <span className="mono">{keyring.cert.serialNumber}</span>,
                },
                {
                  key: 'valid',
                  label: '有效期',
                  children: `${formatDate(keyring.cert.notBefore)} → ${formatDate(keyring.cert.notAfter)}`,
                },
                {
                  key: 'fingerprint',
                  label: 'SHA-256 指纹',
                  children: <Fingerprint value={keyring.cert.fingerprint} />,
                },
                {
                  key: 'trust',
                  label: '信任状态',
                  children: <Tag color="green">已在本机信任库中</Tag>,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card className="keys-card" bordered={false}>
            <div className="section-heading">
              <Space>
                <span className="card-icon"><KeyOutlined /></span>
                <div>
                  <Title level={4}>密钥生命周期操作</Title>
                  <Text type="secondary">导出、备份、恢复与口令轮换</Text>
                </div>
              </Space>
            </div>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Button
                block
                size="large"
                icon={<ExportOutlined />}
                onClick={() => setExportOpen(true)}
              >
                加密导出 RSA 私钥（.sfkey）
              </Button>
              <Button
                block
                size="large"
                icon={<CloudDownloadOutlined />}
                onClick={() => setBackupOpen(true)}
              >
                创建密钥备份（.sfbackup）
              </Button>
              <Button
                block
                size="large"
                icon={<ImportOutlined />}
                onClick={() => setRestoreOpen(true)}
              >
                从备份恢复并替换签名密钥
              </Button>
              <Button
                block
                size="large"
                icon={<KeyOutlined />}
                onClick={() => setImportKeyOpen(true)}
              >
                导入私钥（.sfkey）
              </Button>
              <Button
                block
                size="large"
                icon={<SafetyOutlined />}
                onClick={() => setChangeOpen(true)}
              >
                修改主口令 / 重包文件 DEK
              </Button>
            </Space>
            <Divider />
            <Alert
              type="warning"
              showIcon
              message="导出/备份可被离线破解"
              description="请用强口令并离线保存。"
            />
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            className="keys-card"
            bordered={false}
            title={
              <Space>
                <DatabaseOutlined />
                <span>证书信任库</span>
                <Tag>{trusted.length}</Tag>
              </Space>
            }
            extra={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadTrusted()}>
                刷新
              </Button>
            }
          >
            <List
              dataSource={trusted}
              locale={{ emptyText: '信任库为空' }}
              renderItem={(record) => (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="remove"
                      title="从信任库移除此证书？"
                      description="其签名的容器将无法通过证书校验。"
                      okText="移除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      disabled={isCurrentCert(record)}
                      onConfirm={() => void removeTrust(record)}
                    >
                      <Button
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        disabled={isCurrentCert(record)}
                      >
                        移除
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<span className="trust-icon"><SafetyCertificateOutlined /></span>}
                    title={
                      <Space wrap>
                        <Text strong>{record.subject}</Text>
                        <Tag color={SOURCE_LABEL[record.source].color}>
                          {SOURCE_LABEL[record.source].label}
                        </Tag>
                        {isCurrentCert(record) && <Tag color="blue">当前签名证书</Tag>}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={2}>
                        <Fingerprint value={record.fingerprint} short />
                        <Text type="secondary">
                          加入时间 {formatDate(record.addedAt)} · {groupFingerprint(record.fingerprint).slice(0, 24)}…
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
            <Paragraph type="secondary" className="small-paragraph" style={{ marginTop: 12 }}>
              移除后其容器将无法验证；当前证书不可移除。
            </Paragraph>
          </Card>
        </Col>
      </Row>

      <ExportKeyDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <BackupDialog open={backupOpen} onClose={() => setBackupOpen(false)} />
      <RestoreDialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onRestored={() => void loadTrusted()}
      />
      <ImportKeyDialog
        open={importKeyOpen}
        onClose={() => setImportKeyOpen(false)}
        onImported={() => void loadTrusted()}
      />
      <ChangePasswordDialog
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        onChanged={() => void loadTrusted()}
      />
    </div>
  );
}
