'use strict';

const { app, BrowserWindow, Menu, dialog, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_SCHEME = 'app';
const APP_HOST = 'secure-file-vault';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

app.setName('SecureFile Vault');
// 固定数据目录，避免 portable 解压路径变化导致 IndexedDB 看起来“丢数据”。
// 测试时可用 SFV_USER_DATA 指向临时目录，避免污染真实数据。
app.setPath(
  'userData',
  process.env.SFV_USER_DATA
    ? path.resolve(process.env.SFV_USER_DATA)
    : path.join(app.getPath('appData'), 'SecureFileVault'),
);
app.setAppUserModelId('com.pcd.securefilevault');

let mainWindow = null;

function safeFilePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname);
  } catch {
    return null;
  }
  if (!pathname || pathname === '/') pathname = '/index.html';
  const candidate = path.normalize(path.join(DIST_DIR, pathname));
  if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + path.sep)) {
    return null;
  }
  return candidate;
}

function uniqueDownloadPath(filename) {
  const downloads = app.getPath('downloads');
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(downloads, filename);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(downloads, `${base} (${index})${ext}`);
    index += 1;
  }
  return candidate;
}

function installMenu() {
  const template = [
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(app.isPackaged
          ? []
          : [
            { type: 'separator' },
            { role: 'toggleDevTools', label: '开发者工具' },
          ]),
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 SecureFile Vault',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于 SecureFile Vault',
              message: 'SecureFile Vault',
              detail:
                `版本：${app.getVersion()}\n` +
                '安全文件存储系统 ·  3\n\n' +
                `本地数据目录：\n${app.getPath('userData')}\n\n`,
              buttons: ['确定'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: 'SecureFile Vault',
    backgroundColor: '#f3f6fc',
    autoHideMenuBar: true,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    protocol.handle(APP_SCHEME, async (request) => {
      const filePath = safeFilePath(request.url);
      if (!filePath) {
        return new Response('Not found', { status: 404 });
      }
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          return new Response('Not found', { status: 404 });
        }
        const ext = path.extname(filePath).toLowerCase();
        const headers = {
          'content-type': MIME_TYPES[ext] || 'application/octet-stream',
          'cache-control':
            ext === '.html'
              ? 'no-cache, no-store, must-revalidate'
              : 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        };
        if (ext === '.html') {
          headers['content-security-policy'] = CSP;
        }
        const data = fs.readFileSync(filePath);
        return new Response(data, { headers });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });

    session.defaultSession.on('will-download', (_event, item) => {
      try {
        item.setSavePath(uniqueDownloadPath(item.getFilename()));
      } catch {
        // 保底：不设置路径，让 Chromium 使用默认下载行为。
      }
    });

    installMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
