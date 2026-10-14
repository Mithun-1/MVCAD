const { app, BrowserWindow, Menu, protocol, net, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { assetPath, CSP } = require('./protocol.cjs');

app.setName('MVCAD');
if (process.env.MVCAD_USER_DATA) app.setPath('userData', path.resolve(process.env.MVCAD_USER_DATA));
protocol.registerSchemesAsPrivileged([
  { scheme: 'mvcad', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    title: 'MVCAD',
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../build/icon.png'),
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== 'mvcad://app/' && url !== 'mvcad://app/index.html') event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.loadURL('mvcad://app/');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.mithun.mvcad');
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle('mvcad', async (request) => {
      const file = assetPath(path.join(app.getAppPath(), 'dist'), request.url);
      if (!file || !['GET', 'HEAD'].includes(request.method))
        return new Response('Not found', { status: 404 });
      try {
        const response = await net.fetch(pathToFileURL(file).href);
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', CSP);
        headers.set('X-Content-Type-Options', 'nosniff');
        if (file.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
        return new Response(response.body, { status: response.status, headers });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({
        title: 'Export from MVCAD',
        defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())),
      });
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
        { label: 'File', submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit' }] },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
        },
        { role: 'windowMenu' },
      ]),
    );
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
