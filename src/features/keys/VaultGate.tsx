import { useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Input,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  CloudUploadOutlined,
  FileProtectOutlined,
  KeyOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useSessionStore } from '@/store/sessionStore';
import { assessPassword } from '@/core/validation/passwordPolicy';
import {
  DEFAULT_KDF_PROFILE_ID,
  KDF_PROFILES,
  type KdfProfileId,
} from '@/core/types/crypto';
import { restoreBackup } from '@/core/keys/backup';
import { errorText } from '@/lib/errors';
import {
  formatDate,
  groupFingerprint,
  kdfLabel,
  shortFingerprint,
} from '@/lib/format';

const { Title, Paragraph, Text } = Typography;

const KDF_OPTIONS = Object.values(KDF_PROFILES).map((profile) => ({
  value: profile.id,
  label: profile.label,
}));

function PasswordStrength({ value }: { value: string }): JSX.Element | null {
  if (!value) return null;
  const assessment = assessPassword(value);
  const color =
    assessment.score >= 3 ? 'green' : assessment.score >= 2 ? 'gold' : 'red';
  return (
    <div className="password-meter">
      <Tag color={color}>{assessment.label}</Tag>
      <Text type="secondary">{assessment.message}</Text>
    </div>
  );
}

function KdfHint({ value }: { value: KdfProfileId }): JSX.Element {
  const profile = KDF_PROFILES[value] ?? KDF_PROFILES[DEFAULT_KDF_PROFILE_ID];
  return (
    <div className="field-hint">{profile.description}</div>
  );
}

function FeatureList(): JSX.Element {
  return (
    <div className="gate-features">
      <div className="gate-feature">
        <span className="gate-feature-icon"><FileProtectOutlined /></span>
        <div>
          <div className="gate-feature-title">分块 AES-GCM 加密</div>
          <div className="gate-feature-text">4 MiB 分块，独立 DEK 与认证标签。</div>
        </div>
      </div>
      <div className="gate-feature">
        <span className="gate-feature-icon"><KeyOutlined /></span>
        <div>
          <div className="gate-feature-title">PBKDF2 / scrypt 派生</div>
          <div className="gate-feature-text">PBKDF2 600k；口令不截断。</div>
        </div>
      </div>
      <div className="gate-feature">
        <span className="gate-feature-icon"><SafetyCertificateOutlined /></span>
        <div>
          <div className="gate-feature-title">RSA-3072 签名与 X.509</div>
          <div className="gate-feature-text">清单签名，先验签后解密。</div>
        </div>
      </div>
    </div>
  );
}

export function VaultGate(): JSX.Element {
  const { message } = AntApp.useApp();
  const status = useSessionStore((state) => state.status);
  const keyring = useSessionStore((state) => state.keyring);
  const createVault = useSessionStore((state) => state.createVault);
  const unlock = useSessionStore((state) => state.unlock);
  const installRestoredKey = useSessionStore((state) => state.installRestoredKey);
  const retryBootstrap = useSessionStore((state) => state.retryBootstrap);

  const [tab, setTab] = useState(status === 'locked' ? 'unlock' : 'create');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [createPassword, setCreatePassword] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [createKdf, setCreateKdf] = useState<KdfProfileId>(DEFAULT_KDF_PROFILE_ID);
  const [restoreKdf, setRestoreKdf] = useState<KdfProfileId>(DEFAULT_KDF_PROFILE_ID);
  const [backupFile, setBackupFile] = useState<File | null>(null);

  const [createForm] = Form.useForm();
  const [restoreForm] = Form.useForm();
  const [unlockForm] = Form.useForm();

  const locked = status === 'locked';
  const secureContext = typeof window === 'undefined' ? true : window.isSecureContext;
  const webCryptoAvailable = Boolean(globalThis.crypto?.subtle);

  const handleCreate = async (): Promise<void> => {
    setError(undefined);
    try {
      const values = await createForm.validateFields();
      setLoading(true);
      await createVault({
        displayName: values.displayName,
        password: values.password,
        kdfProfileId: values.kdfProfileId as KdfProfileId,
      });
      message.success('保管库创建成功，RSA 密钥与证书已生成');
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async (): Promise<void> => {
    setError(undefined);
    try {
      const values = await unlockForm.validateFields();
      setLoading(true);
      await unlock(values.password);
      message.success('保管库已解锁');
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (): Promise<void> => {
    setError(undefined);
    if (!backupFile) {
      setError('请选择 .sfbackup 备份文件');
      return;
    }
    try {
      const values = await restoreForm.validateFields();
      setLoading(true);
      const text = await backupFile.text();
      const material = await restoreBackup(text, values.backupPassphrase);
      await installRestoredKey({
        pkcs8: material.pkcs8,
        certInfo: material.certInfo,
        publicKeyJwk: material.publicKeyJwk,
        displayName: values.displayName || material.displayName,
        password: values.password,
        kdfProfileId: values.kdfProfileId as KdfProfileId,
        trustedCerts: material.trustedCerts,
      });
      message.success('备份恢复成功，已建立新的保管库');
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  if (locked) {
    return (
      <div className="gate-page">
        <div className="gate-ambient gate-ambient-a" />
        <div className="gate-ambient gate-ambient-b" />
        <div className="gate-shell gate-shell-locked">
          <div className="gate-brand">
            <div className="gate-logo">
              <SafetyCertificateOutlined />
            </div>
            <Title level={1} className="gate-title">SecureFile Vault</Title>
            <Paragraph className="gate-subtitle">
              本地加密保险箱，主口令不落盘。
            </Paragraph>
            <FeatureList />
          </div>
          <Card className="gate-panel" bordered={false}>
            <Space direction="vertical" size={18} style={{ width: '100%' }}>
              <div>
                <Tag color="blue">已锁定</Tag>
                <Title level={3} style={{ marginTop: 12, marginBottom: 4 }}>
                  {keyring?.displayName ?? '安全保管库'}
                </Title>
                <Text type="secondary">解锁后密钥仅存本页内存。</Text>
              </div>
              {keyring && (
                <div className="fingerprint-box">
                  <div className="fingerprint-label">签名证书 SHA-256</div>
                  <div className="fingerprint-value mono">
                    {groupFingerprint(keyring.cert.fingerprint)}
                  </div>
                  <div className="fingerprint-meta">
                    {keyring.cert.subject} · 有效期至 {formatDate(keyring.cert.notAfter)}
                  </div>
                  <div className="fingerprint-meta">{kdfLabel(keyring.kdfParams)}</div>
                </div>
              )}
              {error && <Alert type="error" showIcon message={error} />}
              <Form
                form={unlockForm}
                name="unlock-vault-form"
                layout="vertical"
                onFinish={() => void handleUnlock()}
              >
                <Form.Item
                  name="password"
                  label="主口令"
                  rules={[{ required: true, message: '请输入主口令' }]}
                >
                  <Input.Password
                    size="large"
                    autoFocus
                    placeholder="输入保管库主口令"
                    prefix={<LockOutlined />}
                  />
                </Form.Item>
                <Button
                  type="primary"
                  size="large"
                  htmlType="submit"
                  block
                  loading={loading}
                  icon={<LockOutlined />}
                >
                  解锁保管库
                </Button>
              </Form>
              <Divider plain style={{ margin: '4px 0' }}>
                无法解锁？
              </Divider>
              <Text type="secondary">口令无法找回；可用备份恢复。</Text>
              <Button type="link" onClick={() => void retryBootstrap()} style={{ padding: 0 }}>
                重新检测本地保管库
              </Button>
            </Space>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="gate-page">
      <div className="gate-ambient gate-ambient-a" />
      <div className="gate-ambient gate-ambient-b" />
      <div className="gate-shell">
        <div className="gate-brand">
          <div className="gate-logo">
            <SafetyCertificateOutlined />
          </div>
          <Title level={1} className="gate-title">SecureFile Vault</Title>
          <Paragraph className="gate-subtitle">纯前端加密文件保险箱。</Paragraph>
          <FeatureList />
          <div className="gate-badges">
            <Tag>AES-256-GCM</Tag>
            <Tag>PBKDF2 / scrypt</Tag>
            <Tag>SHA-256 / SHA-1</Tag>
            <Tag>RSA-3072</Tag>
            <Tag>X.509 TOFU</Tag>
          </div>
        </div>

        <Card className="gate-panel" bordered={false}>
          {(!secureContext || !webCryptoAvailable) && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message="当前环境不安全"
              description="WebCrypto 需要 HTTPS 或 localhost。请通过本地开发服务器访问，不要用 file:// 打开。"
            />
          )}
          {error && (
            <Alert
              type="error"
              showIcon
              closable
              message={error}
              style={{ marginBottom: 16 }}
              onClose={() => setError(undefined)}
            />
          )}
          <Tabs
            activeKey={tab}
            onChange={(key) => {
              setTab(key);
              setError(undefined);
            }}
            items={[
              {
                key: 'create',
                label: '创建保管库',
                children: (
                  <Form
                    form={createForm}
                    name="create-vault-form"
                    layout="vertical"
                    initialValues={{
                      displayName: '我的安全保管库',
                      kdfProfileId: DEFAULT_KDF_PROFILE_ID,
                    }}
                    onValuesChange={(changed) => {
                      if ('password' in changed) setCreatePassword(changed.password ?? '');
                      if ('kdfProfileId' in changed) setCreateKdf(changed.kdfProfileId);
                    }}
                    onFinish={() => void handleCreate()}
                  >
                    <Form.Item
                      name="displayName"
                      label="显示名称"
                      rules={[{ required: true, message: '请输入显示名称' }]}
                    >
                      <Input size="large" placeholder="例如：课程项目保管库" maxLength={64} />
                    </Form.Item>
                    <Form.Item
                      name="password"
                      label="主口令"
                      rules={[{ required: true, message: '请输入主口令' }]}
                      extra="至少 8 位（建议 12+），口令不落盘。"
                    >
                      <Input.Password
                        size="large"
                        placeholder="设置主口令"
                        prefix={<LockOutlined />}
                        autoComplete="new-password"
                      />
                    </Form.Item>
                    <PasswordStrength value={createPassword} />
                    <Form.Item
                      name="confirm"
                      label="确认主口令"
                      dependencies={['password']}
                      rules={[
                        { required: true, message: '请再次输入主口令' },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue('password') === value) {
                              return Promise.resolve();
                            }
                            return Promise.reject(new Error('两次输入的口令不一致'));
                          },
                        }),
                      ]}
                    >
                      <Input.Password
                        size="large"
                        placeholder="再次输入主口令"
                        autoComplete="new-password"
                      />
                    </Form.Item>
                    <Form.Item name="kdfProfileId" label="密钥派生档位">
                      <Select size="large" options={KDF_OPTIONS} />
                    </Form.Item>
                    <KdfHint value={createKdf} />
                    <Form.Item
                      name="acknowledge"
                      valuePropName="checked"
                      rules={[
                        {
                          validator: (_, value) =>
                            value
                              ? Promise.resolve()
                              : Promise.reject(new Error('请确认已了解口令风险')),
                        },
                      ]}
                    >
                      <Checkbox>我明白：口令无法找回，需备份恢复。</Checkbox>
                    </Form.Item>
                    <Button
                      type="primary"
                      size="large"
                      htmlType="submit"
                      block
                      loading={loading}
                      icon={<ThunderboltOutlined />}
                    >
                      创建并生成 RSA 密钥
                    </Button>
                    <div className="form-footnote">
                      生成 RSA-3072 密钥与证书（约 1–3 秒）。
                    </div>
                  </Form>
                ),
              },
              {
                key: 'restore',
                label: '从备份恢复',
                children: (
                  <Form
                    form={restoreForm}
                    name="restore-vault-form"
                    layout="vertical"
                    initialValues={{
                      displayName: '恢复的安全保管库',
                      kdfProfileId: DEFAULT_KDF_PROFILE_ID,
                    }}
                    onValuesChange={(changed) => {
                      if ('password' in changed) setRestorePassword(changed.password ?? '');
                      if ('kdfProfileId' in changed) setRestoreKdf(changed.kdfProfileId);
                    }}
                    onFinish={() => void handleRestore()}
                  >
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="备份不含文件内容"
                      description="文件请用 .sfv 导出。"
                    />
                    <Form.Item label="备份文件 (.sfbackup)" required>
                      <div className="file-picker">
                        <input
                          type="file"
                          accept=".sfbackup,application/json"
                          onChange={(event) => {
                            setBackupFile(event.target.files?.[0] ?? null);
                            setError(undefined);
                          }}
                        />
                        <span className="file-picker-name">
                          {backupFile ? backupFile.name : '选择 .sfbackup 文件'}
                        </span>
                      </div>
                    </Form.Item>
                    <Form.Item
                      name="backupPassphrase"
                      label="备份口令"
                      rules={[{ required: true, message: '请输入备份口令' }]}
                    >
                      <Input.Password
                        size="large"
                        placeholder="创建备份时设置的口令"
                        prefix={<KeyOutlined />}
                      />
                    </Form.Item>
                    <Divider plain>新保管库</Divider>
                    <Form.Item
                      name="displayName"
                      label="显示名称"
                      rules={[{ required: true, message: '请输入显示名称' }]}
                    >
                      <Input size="large" maxLength={64} />
                    </Form.Item>
                    <Form.Item
                      name="password"
                      label="新主口令"
                      rules={[{ required: true, message: '请输入新主口令' }]}
                      extra="用新口令重包私钥，与备份口令无关。"
                    >
                      <Input.Password size="large" placeholder="设置新主口令" />
                    </Form.Item>
                    <PasswordStrength value={restorePassword} />
                    <Form.Item
                      name="confirm"
                      label="确认新主口令"
                      dependencies={['password']}
                      rules={[
                        { required: true, message: '请再次输入新主口令' },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue('password') === value) {
                              return Promise.resolve();
                            }
                            return Promise.reject(new Error('两次输入的口令不一致'));
                          },
                        }),
                      ]}
                    >
                      <Input.Password size="large" placeholder="再次输入新主口令" />
                    </Form.Item>
                    <Form.Item name="kdfProfileId" label="新保管库 KDF 档位">
                      <Select size="large" options={KDF_OPTIONS} />
                    </Form.Item>
                    <KdfHint value={restoreKdf} />
                    <Button
                      type="primary"
                      size="large"
                      htmlType="submit"
                      block
                      loading={loading}
                      icon={<CloudUploadOutlined />}
                    >
                      解密备份并建立保管库
                    </Button>
                  </Form>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
