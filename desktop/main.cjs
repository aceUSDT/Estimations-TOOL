/* Estimation Tools desktop shell.
 *
 * The complete web application is packaged with Electron and served through a
 * stable private protocol. IndexedDB therefore stays inside this OS user's
 * Electron profile and remains available without a network connection.
 */
const { app, BrowserWindow, Menu, protocol, shell, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const APP_SCHEME = 'estimation';
const APP_ORIGIN = `${APP_SCHEME}://app`;
function localDevelopmentUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) ? url.href : '';
  } catch {
    return '';
  }
}
const DEV_URL = localDevelopmentUrl(process.env.ESTIMATION_DEV_URL);
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gz': 'application/gzip',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    codeCache: true,
  },
}]);

app.setName('Estimation Tools');

function webRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(__dirname, '..');
}

function safeAssetPath(requestUrl) {
  const url = new URL(requestUrl);
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== 'app') return null;
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const root = webRoot();
  const candidate = path.resolve(root, `.${requested}`);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

async function handleAppRequest(request) {
  const assetPath = safeAssetPath(request.url);
  if (!assetPath) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.readFile(assetPath);
    const headers = {
      'content-type': MIME_TYPES[path.extname(assetPath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    };
    if (path.extname(assetPath).toLowerCase() === '.html') {
      headers['content-security-policy'] = [
        "default-src 'self' data: blob:",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "worker-src 'self' blob:",
        "connect-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; ');
    }
    return new Response(body, { status: 200, headers });
  } catch (error) {
    return new Response(error && error.code === 'ENOENT' ? 'Not found' : 'Could not read application asset', {
      status: error && error.code === 'ENOENT' ? 404 : 500,
    });
  }
}

function allowedNavigation(url) {
  try {
    const target = new URL(url);
    if (target.protocol === `${APP_SCHEME}:` && target.hostname === 'app') return true;
  } catch {
    return false;
  }
  if (!DEV_URL) return false;
  try {
    const dev = new URL(DEV_URL);
    const target = new URL(url);
    return ['127.0.0.1', 'localhost', '::1'].includes(dev.hostname) && target.origin === dev.origin;
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f3f5f7',
    title: 'Estimation Tools',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(DEV_URL || `${APP_ORIGIN}/index.html`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') return { action: 'allow' };
    if (allowedNavigation(url)) return { action: 'allow' };
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (allowedNavigation(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.hager.estimationtools');
  await protocol.handle(APP_SCHEME, handleAppRequest);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
