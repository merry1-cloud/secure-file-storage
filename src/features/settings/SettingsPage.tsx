import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  DatabaseOutlined,
  LockOutlined,
  SettingOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatBytes, kdfLabel } from '@/lib/format';

const { Text, Title, Paragraph } = Typography;

export function SettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const keyring = useSessionStore((state) => state.keyring);
  const storagePersisted = useSessionStore((state) => state.storagePersisted);
  const requestPersistence = useSessionStore((state) => state.requestPersistence);
  const autoLockMinutes = useSettingsStore((state) => state.autoLockMinutes);
  const setAutoLockMinutes = useSettingsStore((state) => state.setAutoLockMinutes);
  const remember = useSettingsStore((state) => state.rememberPasswordInSession);
  const setRemember = useSettingsStore((state) => state.setRememberPasswordInSession);
  const defaultCipher = useSettingsStore((state) => state.defaultCipher);
  const setDefaultCipher = useSettingsStore((state) => state.setDefaultCipher);
  const defaultHash = useSettingsStore((state) => state.defaultHashAlg);
  const setDefaultHash = useSettingsStore((state) => state.setDefaultHashAlg);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({});

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        if (navigator.storage?.estimate) {
          const estimate = await navigator.storage.estimate();
          setStorage({ usage: estimate.usage, quota: estimate.quota });
        }
      } catch {
        setStorage({});
      }
    };
    void load();
  }, []);

  const secure = typeof window === 'undefined' ? true : window.isSecureContext;
  const webCrypto = Boolean(globalThis.crypto?.subtle);

  return (
    <div className="page-stack">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card
            className="settings-card"
            bordered={false}
            title={
              <Space>
                <SettingOutlined />
                <span>交互与默认值</span>
              </Space>
            }
          >
            <Space direction="vertical" size={20} style={{ width: '100%' }}>
              <div className="setting-row">
                <div>
                  <Text strong>自动锁定</Text>
                  <div className="setting-help">超时清除内存密钥；0 为关闭。</div>
                </div>
                <InputNumber
                  min={0}
                  max={120}
                  value={autoLockMinutes}
                  onChange={(value) => setAutoLockMinutes(Number(value ?? 0))}
                  addonAfter="分钟"
                  style={{ width: 150 }}
                />
              </div>
              <Divider style={{ margin: 0 }} />
              <div className="setting-row">
                <div>
                  <Text strong>本次会话默认记住解密口令</Text>
                  <div className="setting-help">仅演示用，会降低安全性。</div>
                </div>
                <Switch checked={remember} onChange={setRemember} />
              </div>
              <Divider style={{ margin: 0 }} />
              <div className="setting-row">
                <div>
                  <Text strong>默认对称算法</Text>
                  <div className="setting-help">新建加密任务时的默认值，仍可逐次修改。</div>
                </div>
                <Select
                  value={defaultCipher}
                  style={{ width: 190 }}
                  onChange={setDefaultCipher}
                  options={[
                    { value: 'AES-256-GCM', label: 'AES-256-GCM' },
                    { value: 'AES-128-GCM', label: 'AES-128-GCM' },
                  ]}
                />
              </div>
              <Divider style={{ margin: 0 }} />
              <div className="setting-row">
                <div>
                  <Text strong>默认完整性哈希</Text>
                  <div className="setting-help">SHA-1 仅演示。</div>
                </div>
                <Select
                  value={defaultHash}
                  style={{ width: 190 }}
                  onChange={setDefaultHash}
                  options={[
                    { value: 'SHA-256', label: 'SHA-256（推荐）' },
                    { value: 'SHA-1', label: 'SHA-1（弱）' },
                  ]}
                />
              </div>
              {defaultHash === 'SHA-1' && (
                <Alert
                  type="warning"
                  showIcon
                  message="SHA-1 仅演示；签名摘要始终为 SHA-256。"
                />
              )}
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card
            className="settings-card"
            bordered={false}
            title={
              <Space>
                <LockOutlined />
                <span>保管库安全参数</span>
              </Space>
            }
            extra={
              <Button type="link" onClick={() => navigate('/keys')}>
                前往密钥管理修改
              </Button>
            }
          >
            {keyring ? (
              <Descriptions
                column={1}
                size="small"
                items={[
                  { key: 'name', label: '保管库', children: keyring.displayName },
                  { key: 'kdf', label: 'KDF', children: kdfLabel(keyring.kdfParams) },
                  { key: 'cipher', label: '内容加密', children: 'AES-GCM · 4 MiB 分块 · 96 位 IV' },
                  { key: 'sig', label: '签名', children: 'RSA-3072 · RSASSA-PKCS1-v1_5 · SHA-256' },
                  { key: 'hash', label: '完整性', children: 'SHA-256 默认，SHA-1 可选演示' },
                  { key: 'cert', label: '证书', children: '自签名 X.509 · SHA-256 指纹固定' },
                ]}
              />
            ) : (
              <Text type="secondary">未加载到密钥环信息</Text>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card
            className="settings-card"
            bordered={false}
            title={
              <Space>
                <DatabaseOutlined />
                <span>本地存储状态</span>
              </Space>
            }
          >
            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: 'persist',
                  label: '持久化存储',
                  children: storagePersisted ? (
                    <Tag color="success">已授权</Tag>
                  ) : (
                    <Space>
                      <Tag>未授权</Tag>
                      <Button
                        size="small"
                        icon={<SyncOutlined />}
                        onClick={() => void requestPersistence()}
                      >
                        请求授权
                      </Button>
                    </Space>
                  ),
                },
                {
                  key: 'usage',
                  label: '已用 / 配额',
                  children:
                    storage.usage !== undefined && storage.quota !== undefined
                      ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`
                      : '浏览器未提供',
                },
                {
                  key: 'secure',
                  label: '安全上下文',
                  children: secure ? (
                    <Tag color="success">是（HTTPS/localhost）</Tag>
                  ) : (
                    <Tag color="error">否，WebCrypto 可能不可用</Tag>
                  ),
                },
                {
                  key: 'webcrypto',
                  label: 'WebCrypto',
                  children: webCrypto ? (
                    <Tag color="success">可用</Tag>
                  ) : (
                    <Tag color="error">不可用</Tag>
                  ),
                },
              ]}
            />
            <Paragraph type="secondary" className="small-paragraph" style={{ marginTop: 12 }}>
              清理浏览器数据会丢失保管库，请定期备份。
            </Paragraph>
          </Card>
        </Col>
      </Row>

      <Card className="settings-card" bordered={false} title="关于">
        <Space split={<span className="dot-divider" />} wrap>
          <Text>SecureFile Vault · 课程项目 3</Text>
          <Text type="secondary">纯前端 · IndexedDB · WebCrypto · React + TypeScript + Vite</Text>
          <Tag>AES-GCM</Tag>
          <Tag>PBKDF2</Tag>
          <Tag>scrypt</Tag>
          <Tag>RSA-3072</Tag>
          <Tag>X.509</Tag>
        </Space>
      </Card>
    </div>
  );
}
