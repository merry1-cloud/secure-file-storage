import { useMemo, useState } from 'react';
import {
  Button,
  Grid,
  Layout,
  Menu,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AuditOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  KeyOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSessionStore } from '@/store/sessionStore';
import { kdfShortLabel, shortFingerprint } from '@/lib/format';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const MENU_ITEMS = [
  { key: '/', icon: <FolderOpenOutlined />, label: '文件库' },
  { key: '/keys', icon: <KeyOutlined />, label: '密钥管理' },
  { key: '/lab/tamper', icon: <ExperimentOutlined />, label: '篡改实验室' },
  { key: '/lab/benchmark', icon: <DashboardOutlined />, label: '性能测试' },
  { key: '/audit', icon: <AuditOutlined />, label: '审计日志' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/': { title: '加密文件库', subtitle: '拖拽加密、签名与入库' },
  '/keys': { title: '密钥管理', subtitle: '密钥、证书与备份' },
  '/lab/tamper': { title: '篡改实验室', subtitle: '一键复现密文/签名/证书篡改' },
  '/lab/benchmark': { title: '性能测试', subtitle: 'KDF、AES、哈希、RSA 与端到端耗时' },
  '/audit': { title: '审计日志', subtitle: '仅记录操作元数据' },
  '/settings': { title: '设置', subtitle: '自动锁定、默认算法与存储状态' },
};

export function AppLayout(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);
  const session = useSessionStore((state) => state.session);
  const keyring = useSessionStore((state) => state.keyring);
  const lock = useSessionStore((state) => state.lock);

  const selectedKey = useMemo(() => {
    if (location.pathname === '/') return '/';
    const match = MENU_ITEMS.find(
      (item) => item.key !== '/' && location.pathname.startsWith(item.key),
    );
    return match?.key ?? '/';
  }, [location.pathname]);

  const page = PAGE_TITLES[selectedKey] ?? PAGE_TITLES['/'];
  const mobileCollapsed = screens.lg === false;

  return (
    <Layout className="app-shell">
      <Sider
        className="app-sider"
        width={236}
        collapsedWidth={76}
        collapsed={collapsed || mobileCollapsed}
        trigger={null}
      >
        <div className="brand">
          <div className="brand-mark">
            <SafetyCertificateOutlined />
          </div>
          {!(collapsed || mobileCollapsed) && (
            <div className="brand-text">
              <div className="brand-title">SecureFile Vault</div>
              <div className="brand-subtitle">PCD · 安全文件存储</div>
            </div>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => navigate(key)}
          className="app-menu"
        />
        <div className="sider-footer">
          {!(collapsed || mobileCollapsed) ? (
            <>
              <div className="sider-status-label">当前状态</div>
              <div className="sider-status-value">
                <span className="status-dot status-dot-online" />
                已解锁 · {session?.displayName ?? 'Vault User'}
              </div>
              <div className="sider-hint">
                {keyring ? kdfShortLabel(keyring.kdfParams) : '—'} · RSA-3072
              </div>
            </>
          ) : (
            <Tooltip title="锁定保管库">
              <Button
                type="text"
                icon={<LockOutlined />}
                onClick={lock}
                className="sider-lock-icon"
              />
            </Tooltip>
          )}
        </div>
      </Sider>
      <Layout>
        <Header className="app-header">
          <div className="header-left">
            <Button
              type="text"
              className="collapse-button"
              icon={collapsed || mobileCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
            <div>
              <div className="header-title">{page.title}</div>
              <div className="header-subtitle">{page.subtitle}</div>
            </div>
          </div>
          <div className="header-actions">
            <Tooltip title="当前签名证书 SHA-256 指纹">
              <Tag className="header-tag mono" icon={<FileSearchOutlined />}>
                {keyring ? shortFingerprint(keyring.cert.fingerprint) : '—'}
              </Tag>
            </Tooltip>
            <Tag color="blue" className="header-tag">
              {keyring ? kdfShortLabel(keyring.kdfParams) : '—'}
            </Tag>
            <Button icon={<LockOutlined />} onClick={lock}>
              锁定
            </Button>
          </div>
        </Header>
        <Content className="app-content">
          <div className="page-container">
            <Outlet />
          </div>
          <footer className="app-footer">
            <Text type="secondary">密钥仅存本机，请定期备份。</Text>
          </footer>
        </Content>
      </Layout>
    </Layout>
  );
}
