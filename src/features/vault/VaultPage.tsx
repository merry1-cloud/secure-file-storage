import { useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Modal,
  Progress,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  CloudUploadOutlined,
  FileProtectOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import type { StoredFileRecord } from '@/core/storage/schema';
import type { CertInfo } from '@/core/types/key';
import type { VerificationReport } from '@/core/types/verification';
import { verifyContainer } from '@/core/vault/verifyContainer';
import { verifyStoredFile } from '@/core/vault/importExport';
import {
  isCertificateTrusted,
  trustCertificate,
} from '@/core/keys/trustStore';
import { logAudit } from '@/core/audit/auditService';
import { isAppError } from '@/core/errors/AppError';
import {
  startExportContainerJob,
  startStoreContainerJob,
} from '@/workers/workerClient';
import { useSessionStore } from '@/store/sessionStore';
import { useVaultStore } from '@/store/vaultStore';
import { DropZone } from './components/DropZone';
import { EncryptDialog } from './components/EncryptDialog';
import { DecryptWizard } from './components/DecryptWizard';
import { VaultTable } from './components/VaultTable';
import { FileDetailsDrawer } from './components/FileDetailsDrawer';
import { VerificationReportView } from '@/components/ui/VerificationReportView';
import { downloadBlob, ensureExtension, sanitizeDownloadName } from '@/lib/download';
import { errorCode, errorReport, errorText } from '@/lib/errors';
import {
  formatBytes,
  formatDate,
  groupFingerprint,
  shortFingerprint,
} from '@/lib/format';

const { Text, Title } = Typography;

interface ImportProgress {
  fileName: string;
  percent: number;
  stage: string;
}

export function VaultPage(): JSX.Element {
  const { message, modal } = AntApp.useApp();
  const session = useSessionStore((state) => state.session);
  const files = useVaultStore((state) => state.files);
  const loading = useVaultStore((state) => state.loading);
  const error = useVaultStore((state) => state.error);
  const refresh = useVaultStore((state) => state.refresh);
  const remove = useVaultStore((state) => state.remove);

  const [encryptFiles, setEncryptFiles] = useState<File[]>([]);
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [decryptTarget, setDecryptTarget] = useState<StoredFileRecord | null>(null);
  const [detailsFile, setDetailsFile] = useState<StoredFileRecord>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reportModal, setReportModal] = useState<{
    open: boolean;
    title: string;
    report?: VerificationReport;
  }>({ open: false, title: '验证报告' });
  const [importProgress, setImportProgress] = useState<ImportProgress>();
  const [exportingId, setExportingId] = useState<string>();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const importedCount = files.filter((file) => file.origin === 'imported').length;
  const signedCount = files.length;

  const confirmTrust = (info: CertInfo): Promise<boolean> =>
    new Promise((resolve) => {
      modal.confirm({
        title: '信任未知签名证书？',
        width: 560,
        icon: <SafetyCertificateOutlined style={{ color: '#d97706' }} />,
        content: (
          <div>
            <Alert
              type="warning"
              showIcon
              message="请核对完整 SHA-256 指纹"
              style={{ marginBottom: 12 }}
            />
            <div className="fingerprint-box">
              <div className="fingerprint-label">SHA-256 指纹</div>
              <div className="fingerprint-value mono">{groupFingerprint(info.fingerprint)}</div>
              <div className="fingerprint-meta">主题：{info.subject}</div>
              <div className="fingerprint-meta">序列号：{info.serialNumber}</div>
            </div>
          </div>
        ),
        okText: '信任并继续',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });

  const infoFromError = (errorValue: unknown): CertInfo | undefined => {
    if (!isAppError(errorValue) || errorValue.code !== 'E_CERT_UNTRUSTED' || !errorValue.details) {
      return undefined;
    }
    const details = errorValue.details as Record<string, unknown>;
    return {
      pem: String(details.certPem ?? ''),
      fingerprint: String(details.fingerprint ?? ''),
      subject: String(details.subject ?? ''),
      serialNumber: String(details.serialNumber ?? ''),
      notBefore: Number(details.notBefore ?? 0),
      notAfter: Number(details.notAfter ?? 0),
    };
  };

  const verifyContainerWithTrust = async (
    blob: Blob,
  ): Promise<void> => {
    try {
      await verifyContainer(blob, { isTrusted: isCertificateTrusted });
    } catch (err) {
      const info = infoFromError(err);
      if (!info) throw err;
      const trusted = await confirmTrust(info);
      if (!trusted) {
        throw new Error('用户拒绝信任签名者证书');
      }
      await trustCertificate(info, 'manual');
      await verifyContainer(blob, { isTrusted: isCertificateTrusted });
    }
  };

  const importSfv = async (file: File): Promise<void> => {
    setImportProgress({ fileName: file.name, percent: 0, stage: '验证容器' });
    try {
      await verifyContainerWithTrust(file);
      setImportProgress({ fileName: file.name, percent: 0, stage: '写入分块' });
      const handle = startStoreContainerJob(file, ({ stage, done, total }) => {
        setImportProgress({
          fileName: file.name,
          percent: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0,
          stage: stage === 'storeContainer' ? '写入分块' : stage,
        });
      });
      const result = await handle.promise;
      await logAudit('file.import', 'success', {
        fileId: result.fileId,
        detail: { name: result.fileName, size: result.size },
      });
      message.success(`已导入 ${result.fileName}`);
      await refresh();
    } catch (err) {
      if (errorCode(err) === 'E_CANCELLED') return;
      await logAudit('file.import', 'failure', {
        stage: isAppError(err) ? err.stage : undefined,
        errorCode: errorCode(err),
        detail: { name: file.name },
      });
      message.error(errorText(err));
    } finally {
      setImportProgress(undefined);
    }
  };

  const handleFiles = (incoming: File[]): void => {
    const containers = incoming.filter((file) => file.name.toLowerCase().endsWith('.sfv'));
    const backups = incoming.filter((file) =>
      file.name.toLowerCase().endsWith('.sfbackup'),
    );
    const normal = incoming.filter(
      (file) =>
        !file.name.toLowerCase().endsWith('.sfv') &&
        !file.name.toLowerCase().endsWith('.sfbackup'),
    );

    if (backups.length > 0) {
      message.info('备份文件请在“密钥管理 → 恢复备份”中处理');
    }
    void (async () => {
      for (const container of containers) {
        await importSfv(container);
      }
      if (normal.length > 0) {
        setEncryptFiles(normal);
        setEncryptOpen(true);
      }
    })();
  };

  const verifyFileWithTrust = async (file: StoredFileRecord): Promise<VerificationReport> => {
    try {
      const verified = await verifyStoredFile(file.id, {
        isTrusted: isCertificateTrusted,
      });
      return verified.report;
    } catch (err) {
      const info = infoFromError(err);
      if (!info) throw err;
      const trusted = await confirmTrust(info);
      if (!trusted) throw new Error('用户拒绝信任签名者证书');
      await trustCertificate(info, 'manual');
      const verified = await verifyStoredFile(file.id, {
        isTrusted: isCertificateTrusted,
      });
      return verified.report;
    }
  };

  const handleVerify = async (file: StoredFileRecord): Promise<void> => {
    try {
      const report = await verifyFileWithTrust(file);
      setReportModal({ open: true, title: `验证报告 · ${file.fileName}`, report });
      await logAudit('file.verify', 'success', { fileId: file.id });
      message.success('证书与签名验证通过');
    } catch (err) {
      const report = errorReport(err);
      setReportModal({ open: true, title: `验证失败 · ${file.fileName}`, report });
      await logAudit('file.verify', 'failure', {
        fileId: file.id,
        stage: isAppError(err) ? err.stage : undefined,
        errorCode: errorCode(err),
      });
      message.error(errorText(err));
    }
  };

  const handleExport = async (file: StoredFileRecord): Promise<void> => {
    setExportingId(file.id);
    try {
      const handle = startExportContainerJob(file.id);
      const result = await handle.promise;
      downloadBlob(
        result.blob,
        sanitizeDownloadName(ensureExtension(result.fileName, '.sfv')),
      );
      await logAudit('file.export', 'success', { fileId: file.id });
      message.success('容器已导出');
    } catch (err) {
      await logAudit('file.export', 'failure', {
        fileId: file.id,
        errorCode: errorCode(err),
      });
      message.error(errorText(err));
    } finally {
      setExportingId(undefined);
    }
  };

  const handleDelete = async (file: StoredFileRecord): Promise<void> => {
    try {
      await remove(file.id);
      await logAudit('file.delete', 'success', { fileId: file.id });
      message.success('文件已删除');
    } catch (err) {
      message.error(errorText(err));
    }
  };

  const lastCreated = files.reduce((latest, file) => Math.max(latest, file.createdAt), 0);

  return (
    <div className="page-stack">
      {error && <Alert type="error" showIcon message={error} />}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card className="stat-card" bordered={false}>
            <Statistic
              title="加密文件"
              value={files.length}
              prefix={<FileProtectOutlined />}
              suffix="个"
            />
            <div className="stat-footnote">本机密文与导入容器</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="stat-card" bordered={false}>
            <Statistic title="密文总量" value={formatBytes(totalSize)} />
            <div className="stat-footnote">IndexedDB 中的分块密文</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="stat-card" bordered={false}>
            <Statistic
              title="已签名"
              value={signedCount}
              prefix={<SafetyCertificateOutlined />}
              suffix="个"
            />
            <div className="stat-footnote">RSA-3072 · 先验签</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="stat-card" bordered={false}>
            <Statistic
              title="最近入库"
              value={lastCreated ? formatDate(lastCreated) : '—'}
              valueStyle={{ fontSize: 18 }}
            />
            <div className="stat-footnote">
              导入容器 {importedCount} 个 · 加密会话 {session?.displayName ?? '—'}
            </div>
          </Card>
        </Col>
      </Row>

      <Card className="upload-card" bordered={false}>
        <div className="section-heading">
          <div>
            <Title level={4}>上传并加密</Title>
          </div>
          <Space>
            <Tag icon={<CloudUploadOutlined />} color="blue">
              支持拖拽
            </Tag>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>
              刷新
            </Button>
          </Space>
        </div>
        <DropZone onFiles={handleFiles} disabled={Boolean(importProgress)} />
        {importProgress && (
          <div className="import-progress">
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Text>
                <CloudUploadOutlined /> 正在导入 <Text strong>{importProgress.fileName}</Text>
              </Text>
              <Text type="secondary">{importProgress.stage}</Text>
            </Space>
            <Progress percent={importProgress.percent} status="active" />
          </div>
        )}
      </Card>

      <Card
        className="table-card"
        bordered={false}
        title={
          <Space>
            <SafetyOutlined />
            <span>文件库</span>
            <Tag>{files.length}</Tag>
          </Space>
        }
      >
        <VaultTable
          files={files}
          loading={loading}
          onDecrypt={(file) => setDecryptTarget(file)}
          onVerify={(file) => void handleVerify(file)}
          onExport={(file) => void handleExport(file)}
          onDetails={(file) => {
            setDetailsFile(file);
            setDetailsOpen(true);
          }}
          onDelete={(file) => void handleDelete(file)}
        />
        {exportingId && (
          <div className="table-footnote">
            <Text type="secondary">正在打包导出容器…</Text>
          </div>
        )}
      </Card>

      <EncryptDialog
        open={encryptOpen}
        files={encryptFiles}
        onClose={() => setEncryptOpen(false)}
        onComplete={() => void refresh()}
      />

      <DecryptWizard
        file={decryptTarget}
        open={Boolean(decryptTarget)}
        onClose={() => setDecryptTarget(null)}
        onComplete={() => void refresh()}
      />

      <FileDetailsDrawer
        file={detailsFile}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      />

      <Modal
        open={reportModal.open}
        title={reportModal.title}
        width={760}
        footer={
          <Button type="primary" onClick={() => setReportModal({ ...reportModal, open: false })}>
            关闭
          </Button>
        }
        onCancel={() => setReportModal({ ...reportModal, open: false })}
      >
        {reportModal.report ? (
          <VerificationReportView report={reportModal.report} title={reportModal.title} />
        ) : (
          <Alert type="error" showIcon message="没有可展示的验证阶段信息" />
        )}
      </Modal>
    </div>
  );
}
