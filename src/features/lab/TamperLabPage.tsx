import { useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  DownloadOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
  SafetyOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { StoredFileRecord } from '@/core/storage/schema';
import type { VerificationReport, VerifyStage } from '@/core/types/verification';
import type { ErrorCode } from '@/core/errors/codes';
import {
  TAMPER_LABELS,
  tamperContainer,
  type TamperKind,
  type TamperOutcome,
} from '@/core/vault/tamper';
import { verifyContainer } from '@/core/vault/verifyContainer';
import { exportContainerBlob } from '@/core/vault/importExport';
import { isCertificateTrusted } from '@/core/keys/trustStore';
import { verifyPasswordAndUnlock } from '@/core/crypto/kdf';
import { isAppError } from '@/core/errors/AppError';
import { logAudit } from '@/core/audit/auditService';
import { startDecryptJob } from '@/workers/workerClient';
import { useVaultStore } from '@/store/vaultStore';
import { VerificationReportView } from '@/components/ui/VerificationReportView';
import { downloadBlob, sanitizeDownloadName } from '@/lib/download';
import { errorCode, errorReport, errorText } from '@/lib/errors';
import { formatDuration, stageLabel } from '@/lib/format';

const { Text, Title } = Typography;

interface LabResult {
  outcome: TamperOutcome;
  report?: VerificationReport;
  actualStage: string;
  actualCode: string;
  passed: boolean;
  durationMs: number;
  tamperedBlob?: Blob;
}

const EXPECTED_MATRIX: Array<{
  kind: TamperKind;
  expectedStage: VerifyStage;
  expectedCode: ErrorCode;
}> = [
  { kind: 'ciphertext-bit-flip', expectedStage: 'decrypt', expectedCode: 'E_AUTH_TAG' },
  { kind: 'replace-signature', expectedStage: 'signature', expectedCode: 'E_SIGNATURE' },
  { kind: 'modify-filename', expectedStage: 'signature', expectedCode: 'E_SIGNATURE' },
  { kind: 'downgrade-hash', expectedStage: 'signature', expectedCode: 'E_SIGNATURE' },
  { kind: 'truncate', expectedStage: 'parse', expectedCode: 'E_CONTAINER_PARSE' },
  { kind: 'swap-chunks', expectedStage: 'decrypt', expectedCode: 'E_AUTH_TAG' },
  { kind: 'replace-chunk-cross-file', expectedStage: 'decrypt', expectedCode: 'E_AUTH_TAG' },
  { kind: 'replace-certificate', expectedStage: 'certificate', expectedCode: 'E_CERT_UNTRUSTED' },
  { kind: 'wrong-password', expectedStage: 'password', expectedCode: 'E_WRONG_PASSWORD' },
];

const KIND_OPTIONS = (Object.keys(TAMPER_LABELS) as TamperKind[]).map((kind) => ({
  value: kind,
  label: TAMPER_LABELS[kind],
}));

function lastFailedStage(report?: VerificationReport): string | undefined {
  return [...(report?.stages ?? [])].reverse().find((stage) => stage.status === 'failed')
    ?.stage;
}

export function TamperLabPage(): JSX.Element {
  const { message } = AntApp.useApp();
  const files = useVaultStore((state) => state.files);
  const loading = useVaultStore((state) => state.loading);
  const refresh = useVaultStore((state) => state.refresh);
  const [form] = Form.useForm();
  const [fileId, setFileId] = useState<string>();
  const [kind, setKind] = useState<TamperKind>('ciphertext-bit-flip');
  const [otherFileId, setOtherFileId] = useState<string>();
  const [password, setPassword] = useState('');
  const [wrongPassword, setWrongPassword] = useState('definitely-wrong-password');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<LabResult>();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedFile = files.find((file) => file.id === fileId);
  const otherFile = files.find((file) => file.id === otherFileId);
  const decryptKind = ['ciphertext-bit-flip', 'swap-chunks', 'replace-chunk-cross-file'].includes(
    kind,
  );

  const run = async (): Promise<void> => {
    setError(undefined);
    setResult(undefined);
    setProgress(0);
    if (!selectedFile) {
      setError('请选择要测试的加密文件');
      return;
    }
    if (kind === 'replace-chunk-cross-file' && !otherFile) {
      setError('跨文件分块替换需要选择另一个容器');
      return;
    }
    if (decryptKind && !password) {
      setError('密文类篡改需要输入正确的保管库口令，才能走到 GCM 解密阶段');
      return;
    }
    if (kind === 'wrong-password' && !wrongPassword) {
      setError('请输入用于测试的错误口令');
      return;
    }

    setRunning(true);
    const started = performance.now();
    try {
      const { blob } = await exportContainerBlob(selectedFile.id);
      let otherContainer: Blob | undefined;
      if (kind === 'replace-chunk-cross-file' && otherFile) {
        otherContainer = (await exportContainerBlob(otherFile.id)).blob;
      }
      const outcome = await tamperContainer(blob, kind, { otherContainer });

      let actualStage = 'success';
      let actualCode = '—';
      let report: VerificationReport | undefined;
      let tamperedBlob = outcome.blob;

      if (kind === 'wrong-password') {
        const verified = await verifyContainer(blob, {
          isTrusted: isCertificateTrusted,
        });
        report = verified.report;
        try {
          await verifyPasswordAndUnlock(
            wrongPassword,
            verified.parsed.manifest.kdf,
            verified.parsed.manifest.kcv,
          );
          actualStage = 'success';
          actualCode = '—';
        } catch (err) {
          actualStage = isAppError(err) ? err.stage : 'password';
          actualCode = errorCode(err) ?? 'E_WRONG_PASSWORD';
          report = {
            ...verified.report,
            ok: false,
            errorCode: actualCode,
            summary: errorText(err),
            stages: [
              ...verified.report.stages,
              {
                stage: 'password',
                status: 'failed',
                durationMs: 0,
                detail: errorText(err),
                code: actualCode,
              },
            ],
          };
        }
      } else if (outcome.blob) {
        try {
          const verified = await verifyContainer(outcome.blob, {
            isTrusted: isCertificateTrusted,
          });
          report = verified.report;
          if (decryptKind) {
            const kdfStart = performance.now();
            const material = await verifyPasswordAndUnlock(
              password,
              verified.parsed.manifest.kdf,
              verified.parsed.manifest.kcv,
            );
            const reportWithPassword: VerificationReport = {
              ...verified.report,
              stages: [
                ...verified.report.stages,
                {
                  stage: 'password',
                  status: 'ok',
                  durationMs: performance.now() - kdfStart,
                  detail: 'KCV 口令校验通过（主线程 KDF）',
                },
              ],
            };
            report = reportWithPassword;
            try {
              const handle = startDecryptJob(
                {
                  source: { kind: 'container', blob: outcome.blob },
                  vmk: material.vmk,
                  initialReport: reportWithPassword,
                },
                ({ done, total }) => {
                  setProgress(total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);
                },
              );
              await handle.promise;
              actualStage = 'success';
              actualCode = '—';
            } catch (err) {
              actualStage = isAppError(err) ? err.stage : 'decrypt';
              actualCode = errorCode(err) ?? 'E_UNKNOWN';
              report = errorReport(err) ?? reportWithPassword;
            }
          } else {
            actualStage = 'success';
            actualCode = '—';
          }
        } catch (err) {
          actualStage = isAppError(err) ? err.stage : 'unknown';
          actualCode = errorCode(err) ?? 'E_UNKNOWN';
          report = errorReport(err);
        }
      }

      const passed =
        actualStage === outcome.expectedStage && actualCode === outcome.expectedCode;
      setResult({
        outcome,
        report,
        actualStage,
        actualCode,
        passed,
        durationMs: performance.now() - started,
        tamperedBlob,
      });
      await logAudit('tamper.test', passed ? 'success' : 'failure', {
        fileId: selectedFile.id,
        stage: actualStage,
        errorCode: actualCode,
        detail: {
          kind,
          expectedStage: outcome.expectedStage,
          expectedCode: outcome.expectedCode,
          passed,
        },
      });
      if (passed) {
        message.success('结果符合预期：攻击被按预期阶段拦截');
      } else {
        message.warning('实际结果与预期不一致，请查看报告');
      }
    } catch (err) {
      setError(errorText(err));
      await logAudit('tamper.test', 'failure', {
        fileId: selectedFile.id,
        stage: isAppError(err) ? err.stage : undefined,
        errorCode: errorCode(err),
        detail: { kind },
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page-stack">
      <Alert
        type="info"
        showIcon
        icon={<ExperimentOutlined />}
        message="篡改实验（内存副本）"
        description="不改原文件；可导出篡改容器复现。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card className="lab-card" bordered={false} loading={loading}>
            <div className="section-heading">
              <div>
                <Title level={4}>选择攻击场景</Title>
                <Text type="secondary">预期结果来自项目的篡改检测矩阵</Text>
              </div>
              <Tag color="volcano">现场测试</Tag>
            </div>
            <Form form={form} name="tamper-form" layout="vertical">
              <Form.Item label="目标文件" required>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择文件库中的文件"
                  value={fileId}
                  onChange={(value) => {
                    setFileId(value);
                    setResult(undefined);
                    setError(undefined);
                  }}
                  options={files.map((file) => ({
                    value: file.id,
                    label: `${file.fileName} · ${file.origin === 'imported' ? '导入' : '本机'}`,
                  }))}
                />
              </Form.Item>
              <Form.Item label="篡改类型" required>
                <Select
                  value={kind}
                  options={KIND_OPTIONS}
                  onChange={(value: TamperKind) => {
                    setKind(value);
                    setResult(undefined);
                    setError(undefined);
                  }}
                />
              </Form.Item>
              {kind === 'replace-chunk-cross-file' && (
                <Form.Item label="用于替换分块的另一个文件" required>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择另一个容器"
                    value={otherFileId}
                    onChange={setOtherFileId}
                    options={files
                      .filter((file) => file.id !== fileId)
                      .map((file) => ({ value: file.id, label: file.fileName }))}
                  />
                </Form.Item>
              )}
              {decryptKind && (
                <Form.Item
                  label="正确的保管库口令"
                  extra="需解密至 GCM 阶段才会失败。"
                >
                  <Input.Password
                    size="large"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="输入正确口令"
                  />
                </Form.Item>
              )}
              {kind === 'wrong-password' && (
                <Form.Item label="用于测试的错误口令">
                  <Input
                    size="large"
                    value={wrongPassword}
                    onChange={(event) => setWrongPassword(event.target.value)}
                  />
                </Form.Item>
              )}
              <Space wrap>
                <Button
                  type="primary"
                  size="large"
                  icon={<PlayCircleOutlined />}
                  loading={running}
                  onClick={() => void run()}
                >
                  运行攻击测试
                </Button>
                {result?.tamperedBlob && (
                  <Button
                    size="large"
                    icon={<DownloadOutlined />}
                    onClick={() =>
                      downloadBlob(
                        result.tamperedBlob!,
                        sanitizeDownloadName(`${selectedFile?.fileName ?? 'file'}.tampered.sfv`),
                      )
                    }
                  >
                    导出被篡改容器
                  </Button>
                )}
              </Space>
              {running && decryptKind && <Progress percent={progress} style={{ marginTop: 16 }} />}
              {error && <Alert type="error" showIcon message={error} style={{ marginTop: 16 }} />}
            </Form>
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card className="lab-card" bordered={false} title="预期结果矩阵">
            <Table
              size="small"
              pagination={false}
              rowKey="kind"
              dataSource={EXPECTED_MATRIX}
              columns={[
                {
                  title: '篡改',
                  dataIndex: 'kind',
                  render: (value: TamperKind) => TAMPER_LABELS[value],
                },
                {
                  title: '失败阶段',
                  dataIndex: 'expectedStage',
                  width: 100,
                  render: (value: string) => <Tag>{stageLabel(value)}</Tag>,
                },
                {
                  title: '错误码',
                  dataIndex: 'expectedCode',
                  width: 150,
                  render: (value: string) => (
                    <Text className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {value}
                    </Text>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {result && (
        <Card className="lab-result-card" bordered={false}>
          <div className="section-heading">
            <Space>
              {result.passed ? (
                <Tag color="success" icon={<SafetyOutlined />}>符合预期</Tag>
              ) : (
                <Tag color="error" icon={<WarningOutlined />}>与预期不一致</Tag>
              )}
              <Title level={4} style={{ margin: 0 }}>{result.outcome.label}</Title>
            </Space>
            <Text type="secondary">总耗时 {formatDuration(result.durationMs)}</Text>
          </div>
          <Alert
            type={result.passed ? 'success' : 'error'}
            showIcon
            message={result.passed ? '攻击已被正确拦截' : '需要检查实现或测试前置条件'}
            description={result.outcome.description}
          />
          <Descriptions
            size="small"
            bordered
            column={{ xs: 1, sm: 2 }}
            style={{ marginTop: 16 }}
            items={[
              {
                key: 'expected',
                label: '预期阶段 / 错误码',
                children: (
                  <Space wrap>
                    <Tag>{stageLabel(result.outcome.expectedStage)}</Tag>
                    <Text className="mono">{result.outcome.expectedCode}</Text>
                  </Space>
                ),
              },
              {
                key: 'actual',
                label: '实际阶段 / 错误码',
                children: (
                  <Space wrap>
                    <Tag color={result.passed ? 'green' : 'red'}>
                      {result.actualStage === 'success' ? '成功（未拦截）' : stageLabel(result.actualStage)}
                    </Tag>
                    <Text className="mono">{result.actualCode}</Text>
                  </Space>
                ),
              },
              {
                key: 'file',
                label: '目标文件',
                children: selectedFile?.fileName ?? '—',
              },
              {
                key: 'stageReason',
                label: '最后失败阶段',
                children: lastFailedStage(result.report)
                  ? stageLabel(lastFailedStage(result.report)!)
                  : '—',
              },
            ]}
          />
          {result.report && (
            <div style={{ marginTop: 16 }}>
              <VerificationReportView report={result.report} title={`${result.outcome.label} 验证报告`} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
