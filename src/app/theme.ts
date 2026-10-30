import type { ThemeConfig } from 'antd';

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#2563eb',
    colorInfo: '#2563eb',
    colorSuccess: '#0f9f6e',
    colorWarning: '#d97706',
    colorError: '#dc2626',
    borderRadius: 10,
    colorBgLayout: '#f3f6fc',
    colorTextBase: '#0f172a',
    fontFamily:
      '"Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Layout: {
      siderBg: '#0b1220',
      triggerBg: '#111a2e',
      headerBg: 'rgba(255,255,255,0.86)',
      bodyBg: '#f3f6fc',
    },
    Menu: {
      darkItemBg: '#0b1220',
      darkSubMenuItemBg: '#0b1220',
      darkItemSelectedBg: '#1d4ed8',
      darkItemHoverBg: '#172136',
      darkItemColor: '#aebbd1',
      darkItemSelectedColor: '#ffffff',
    },
    Card: {
      borderRadiusLG: 14,
    },
    Button: {
      borderRadius: 9,
    },
    Modal: {
      borderRadiusLG: 14,
    },
    Table: {
      headerBg: '#f8fafc',
    },
  },
};
