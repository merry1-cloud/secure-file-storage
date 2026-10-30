import { useEffect } from 'react';
import { Button, Result, Spin } from 'antd';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSessionStore } from './store/sessionStore';
import { useAutoLock } from './hooks/useAutoLock';
import { AppLayout } from './components/layout/AppLayout';
import { VaultGate } from './features/keys/VaultGate';
import { VaultPage } from './features/vault/VaultPage';
import { KeysPage } from './features/keys/KeysPage';
import { TamperLabPage } from './features/lab/TamperLabPage';
import { BenchmarkPage } from './features/lab/BenchmarkPage';
import { AuditPage } from './features/audit/AuditPage';
import { SettingsPage } from './features/settings/SettingsPage';

function SplashScreen(): JSX.Element {
  return (
    <div className="splash-screen">
      <div className="splash-mark">SFV</div>
      <Spin size="large" />
      <div className="splash-text">正在初始化本地加密保险箱…</div>
    </div>
  );
}

export default function App(): JSX.Element {
  const status = useSessionStore((state) => state.status);
  const bootstrap = useSessionStore((state) => state.bootstrap);
  const retryBootstrap = useSessionStore((state) => state.retryBootstrap);
  const bootstrapError = useSessionStore((state) => state.bootstrapError);
  useAutoLock();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'booting') return <SplashScreen />;

  if (status === 'error') {
    return (
      <div className="gate-page">
        <Result
          status="error"
          title="本地存储初始化失败"
          subTitle={bootstrapError ?? '无法访问 IndexedDB，请检查浏览器隐私设置。'}
          extra={
            <Button type="primary" onClick={() => void retryBootstrap()}>
              重试初始化
            </Button>
          }
        />
      </div>
    );
  }

  if (status === 'no-vault' || status === 'locked') {
    return <VaultGate />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<VaultPage />} />
        <Route path="keys" element={<KeysPage />} />
        <Route path="lab/tamper" element={<TamperLabPage />} />
        <Route path="lab/benchmark" element={<BenchmarkPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
