/* Estimation 101 — desktop shell (Electron).
 *
 * A thin native window around the deployed web app. The app already talks to
 * the serverless extract function over HTTPS, so loading the live site keeps
 * the AI-extracts / key-stays-server-side model intact with zero duplication —
 * the desktop build never contains the Anthropic key, and updates to the site
 * reach desktop users without a re-install.
 *
 * Override the URL with ESTIMATION101_URL (e.g. a staging deploy).
 */
const { app, BrowserWindow, shell, Menu } = require('electron');

const APP_URL = process.env.ESTIMATION101_URL || 'https://estimationtoolz.netlify.app/';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0f1419',
    title: 'Estimation 101 — Electrical Document Intelligence',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // no preload bridge needed: the app is self-contained and only talks to
      // its own HTTPS endpoints. Keep the renderer sandboxed.
      sandbox: true,
    },
  });

  win.loadURL(APP_URL);

  // Open target=_blank / external links in the user's real browser, not a
  // second app window (e.g. the Netlify/help links).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  // A minimal, platform-appropriate menu (reload, zoom, devtools, quit).
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
        { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
