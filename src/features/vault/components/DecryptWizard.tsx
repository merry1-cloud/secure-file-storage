import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Input,
  Modal,
  Progress,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  DownloadOutlined,
  KeyOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { StoredFileRecord } from '@/core/storage/schema';
import type { CertInfo } from '@/core/types/key';
import type {
  VerificationReport,
  VerificationStageResult,
} from '@/core/types/verification';
import type { DecryptedJobResult } from '@/workers/protocol';
import { startDecryptJob, type JobHandle } from '@/workers/workerClient';
import { verifyStoredFile } from '@/core/vault/importExport';
import { isCertificateTrusted, trustCertificate } from '@/core/keys/trustStore';
import { verifyPasswordAndUnlock } from '@/core/crypto/kdf';
import { logAudit } from '@/core/audit/auditService';
import { isAppError } from '@/core/errors/AppError';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { downloadBlob, sanitizeDownloadName } from '@/lib/download';
import { errorCode, errorReport, errorText } from '@/lib/errors';
import {
  formatBytes,
  formatDuration,
  groupFingerprint,
  shortFingerprint,
} from '@/lib/format';
import { VerificationReportView } from '@/components/ui/VerificationReportView';

const { Text, Title } = Typography;

type Phase = 'verifying' | 'untrusted' | 'password' | 'decrypting' | 'success' | 'error';

export interface DecryptWizardProps {
  file: StoredFileRecord | null;
  open: boolean;
  onClose(): void;
  onComplete(): void;
}

function reportWithPasswordFailure(
  base: VerificationReport | undefined,
  code: string,
  message: string,
): VerificationReport {
  const stage: VerificationStageResult = {
    stage: 'password',
    status: 'failed',
    durationMs: 0,
    detail: message,
    code,
  };
  return {
    ok: false,
    errorCode: code,
    summary: message,
    stages: [...(base?.stages ?? []), stage],
  };
}

export function DecryptWizard({
  file,
  open,
  onClose,
  onComplete,
}: DecryptWizardProps): JSX.Element {
  const { message } = AntApp.useApp();
  const session = useSessionStore((state) => state.session);
  const skipPasswordForSession = useSessionStore((state) => state.skipPasswordForSession);
  const setSkipPasswordForSession = useSessionStore((state) => state.setSkipPasswordForSession);
  const rememberDefault = useSettingsStore((state) => state.rememberPasswordInSession);
  const setRememberDefault = useSettingsStore((state) => state.setRememberPasswordInSession);

  const [phase, setPhase] = useState<Phase>('verifying');
  const [envelopeReport, setEnvelopeReport] = useState<VerificationReport>();
  const [report, setReport] = useState<VerificationReport>();
  const [error, setError] = useState<string>();
  const [trustCert, setTrustCert] = useState<CertInfo>();
  const [password, setPassword] = useState('');
  const [useSessionKey, setUseSessionKey] = useState(false);
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<DecryptedJobResult>();
  const runIdRef = useRef(0);
  const handleRef = useRef<JobHandle<DecryptedJobResult> | null>(null);

  const reset = (): void => {
    setPhase('verifying');
    setEnvelopeReport(undefined);
    setReport(undefined);
    setError(undefined);
    setTrustCert(undefined);
    setPassword('');
    setUseSessionKey(Boolean(session && (skipPasswordForSession || rememberDefault)));
    setRemember(rememberDefault);
    setSubmitting(false);
    setProgress(0);
    setResult(undefined);
    handleRef.current = null;
  };

  const verifyEnvelope = async (): Promise<void> => {
    if (!file) return;
    const runId = ++runIdRef.current;
    setPhase('verifying');
    setError(undefined);
    setReport(undefined);
    try {
      const verified = await verifyStoredFile(file.id, {
        isTrusted: (fingerprint) => isCertificateTrusted(fingerprint),
      });
      if (runId !== runIdRef.current) return;
      setEnvelopeReport(verified.report);
      setPhase('password');
    } catch (err) {
      if (runId !== runIdRef.current) return;
      if (isAppError(err) && err.code === 'E_CERT_UNTRUSTED' && err.details) {
        const details = err.details as Record<string, unknown>;
        setTrustCert({
          pem: String(details.certPem ?? ''),
          fingerprint: String(details.fingerprint ?? ''),
          subject: String(details.subject ?? ''),
          serialNumber: String(details.serialNumber ?? ''),
          notBefore: Number(details.notBefore ?? 0),
          notAfter: Number(details.notAfter ?? 0),
        });
        setPhase('untrusted');
        return;
      }
      setError(errorText(err));
      setReport(errorReport(err));
      setPhase('error');
      await logAudit('file.verify', 'failure', {
        fileId: file.id,
        stage: isAppError(err) ? err.stage : undefined,
        errorCode: errorCode(err),
      });
    }
  };

  useEffect(() => {
    if (!open || !file) return;
    reset();
    void verifyEnvelope();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file?.id]);

  useEffect(() => {
    if (!open) {
      runIdRef.current += 1;
      handleRef.current?.cancel();
      handleRef.current = null;
    }
  }, [open]);

  const trustAndRetry = async (): Promise<void> => {
    if (!trustCert) return;
    try {
      await trustCertificate(trustCert, 'manual');
      message.success('证书已加入信任库');
      setTrustCert(undefined);
      await verifyEnvelope();
    } catch (err) {
      setError(errorText(err));
      setPhase('error');
    }
  };

  const decrypt = async (): Promise<void> => {
    if (!file || !file.manifest) return;
    setError(undefined);
    setSubmitting(true);
    let vmk: CryptoKey;
    let baseReport = envelopeReport;

    if (useSessionKey) {
      if (!session) {
        setError('会话已锁定，请输入口令');
        setSubmitting(false);
        return;
      }
      vmk = session.vmk;
    } else {
      if (!password) {
        setError('请输入口令');
        setSubmitting(false);
        return;
      }
      try {
        const kdfStart = performance.now();
        const material = await verifyPasswordAndUnlock(
          password,
          file.manifest.kdf,
          file.manifest.kcv,
        );
        vmk = material.vmk;
        const passwordStage: VerificationStageResult = {
          stage: 'password',
          status: 'ok',
          durationMs: performance.now() - kdfStart,
          detail: 'KCV 口令校验通过（主线程 KDF）',
        };
        baseReport = {
          ok: envelopeReport?.ok ?? true,
          summary: envelopeReport?.summary ?? '口令校验通过',
          errorCode: envelopeReport?.errorCode,
          stages: [...(envelopeReport?.stages ?? []), passwordStage],
        };
        if (remember) {
          setSkipPasswordForSession(true);
          setRememberDefault(true);
        }
      } catch (err) {
        const failed = reportWithPasswordFailure(
          envelopeReport,
          errorCode(err) ?? 'E_WRONG_PASSWORD',
          errorText(err),
        );
        setReport(failed);
        setError(errorText(err));
        setPhase('error');
        setSubmitting(false);
        await logAudit('file.decrypt', 'failure', {
          fileId: file.id,
          stage: 'password',
          errorCode: errorCode(err),
        });
        return;
      }
    }

    setPassword('');
    setPhase('decrypting');
    setProgress(0);
    try {
      const handle = startDecryptJob(
        {
          source: { kind: 'vault', fileId: file.id },
          vmk,
          initialReport: baseReport,
        },
        ({ done, total }) => {
          setProgress(total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);
        },
      );
      handleRef.current = handle;
      const decrypted = await handle.promise;
      setResult(decrypted);
      setReport(decrypted.report);
      setPhase('success');
      downloadBlob(decrypted.blob, sanitizeDownloadName(decrypted.filename));
      await logAudit('file.decrypt', 'success', {
        fileId: file.id,
        detail: {
          name: file.fileName,
          totalMs: decrypted.report.stages.reduce((sum, item) => sum + item.durationMs, 0),
        },
      });
      onComplete();
      message.success('解密完成，文件已开始下载');
    } catch (err) {
      if (errorCode(err) === 'E_CANCELLED') {
        setError('解密已取消');
        setPhase('password');
      } else {
        setError(errorText(err));
        setReport(errorReport(err) ?? baseReport);
        setPhase('error');
      }
      await logAudit('file.decrypt', 'failure', {
        fileId: file.id,
        stage: isAppError(err) ? err.stage : undefined,
        errorCode: errorCode(err),
      });
    } finally {
      handleRef.current = null;
      setSubmitting(false);
    }
  };

  const close = (): void => {
    if (phase === 'decrypting') {
      handleRef.current?.cancel();
      return;
    }
    onClose();
  };

  const cancelDecrypt = (): void => {
    handleRef.current?.cancel();
  };

  const footer = (): React.ReactNode => {
    switch (phase) {
      case 'verifying':
        return [
          <Button key="close" onClick={onClose}>
            关闭
          </Button>,
        ];
      case 'untrusted':
        return [
          <Button key="close" onClick={onClose}>
            不信任，关闭
          </Button>,
          <Button
            key="trust"
            type="primary"
            icon={<SafetyCertificateOutlined />}
            onClick={() => void trustAndRetry()}
          >
            信任此证书并继续
          </Button>,
        ];
      case 'password':
        return [
          <Button key="close" onClick={onClose}>
            取消
          </Button>,
          <Button
            key="decrypt"
            type="primary"
            icon={<DownloadOutlined />}
            loading={submitting}
            onClick={() => void decrypt()}
          >
            解密并下载
          </Button>,
        ];
      case 'decrypting':
        return [
          <Button key="cancel" danger icon={<StopOutlined />} onClick={cancelDecrypt}>
            取消解密
          </Button>,
        ];
      case 'success':
        return [
          <Button key="close" type="primary" onClick={onClose}>
            关闭
          </Button>,
        ];
      case 'error':
        return [
          <Button
            key="retry"
            onClick={() => {
              setError(undefined);
              setReport(undefined);
              setPhase('password');
            }}
          >
            返回重试
          </Button>,
          <Button key="close" type="primary" onClick={onClose}>
            关闭
          </Button>,
        ];
      default:
        return null;
    }
  };

  return (
    <Modal
      open={open}
      title="解密、验签与完整性校验"
      width={780}
      onCancel={close}
      closable={phase !== 'decrypting'}
      maskClosable={false}
      destroyOnClose
      footer={footer()}
    >
      {file && (
        <div className="decrypt-head">
          <div>
            <Title level={5} style={{ marginBottom: 4 }}>
              {file.fileName}
            </Title>
            <Space split={<span className="dot-divider" />} wrap>
              <Text type="secondary">{formatBytes(file.size)}</Text>
              <Text type="secondary">{file.cipherAlg}</Text>
              <Tag color={file.hashAlg === 'SHA-1' ? 'red' : 'green'}>{file.hashAlg}</Tag>
              {file.origin === 'imported' && <Tag color="purple">外部容器</Tag>}
            </Space>
          </div>
          <Tag className="mono">{shortFingerprint(file.signerFingerprint ?? '')}</Tag>
        </div>
      )}

      {file?.origin === 'imported' && (phase === 'password' || phase === 'verifying') && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="外部容器需用原口令。"
        />
      )}

      {phase === 'verifying' && (
        <div className="decrypt-center">
          <Spin size="large" />
          <Text type="secondary">正在解析容器、校验证书与 RSA 签名…</Text>
        </div>
      )}

      {phase === 'untrusted' && trustCert && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message="首次信任：请核对证书指纹。"
          />
          <div className="fingerprint-box">
            <div className="fingerprint-label">证书 SHA-256 指纹</div>
            <div className="fingerprint-value mono">{groupFingerprint(trustCert.fingerprint)}</div>
            <div className="fingerprint-meta">主题：{trustCert.subject}</div>
            <div className="fingerprint-meta">序列号：{trustCert.serialNumber}</div>
          </div>
        </Space>
      )}

      {phase === 'password' && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          {envelopeReport && <VerificationReportView report={envelopeReport} compact />}
          {error && <Alert type="error" showIcon message={error} />}
          {session && (
            <Checkbox
              checked={useSessionKey}
              onChange={(event) => setUseSessionKey(event.target.checked)}
            >
              使用会话密钥（免输口令）
            </Checkbox>
          )}
          <Input.Password
            size="large"
            prefix={<KeyOutlined />}
            placeholder={file?.origin === 'imported' ? '容器创建时的保管库口令' : '保管库主口令'}
            value={password}
            disabled={useSessionKey}
            onChange={(event) => setPassword(event.target.value)}
            onPressEnter={() => void decrypt()}
          />
          {session && (
            <Checkbox
              checked={remember}
              onChange={(event) => {
                setRemember(event.target.checked);
                if (!event.target.checked) {
                  setSkipPasswordForSession(false);
                  setRememberDefault(false);
                }
              }}
            >
              本次会话记住口令（仅演示）
            </Checkbox>
          )}
          <Text type="secondary">任一步失败都不会生成下载文件。</Text>
        </Space>
      )}

      {phase === 'decrypting' && (
        <div className="decrypt-center">
          <Progress type="circle" percent={progress} status="active" />
          <Text type="secondary">正在分块解密并重算内容哈希…</Text>
        </div>
      )}

      {phase === 'success' && result && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Alert
            type="success"
            showIcon
            message="验证通过，文件已开始下载"
            description={`内容哈希（${file?.hashAlg ?? 'SHA-256'}）：${result.digestBase64}`}
          />
          <VerificationReportView report={result.report} title="解密验证报告" />
        </Space>
      )}

      {phase === 'error' && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Alert
            type="error"
            showIcon
            message="解密或验证失败，已阻止输出明文"
            description={error}
          />
          {report && <VerificationReportView report={report} />}
        </Space>
      )}
    </Modal>
  );
}
