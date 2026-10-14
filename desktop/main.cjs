const { app, BrowserWindow, Menu, protocol, net, session, ipcMain, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { assetPath, CSP } = require('./protocol.cjs');
const { createUpdates } = require('./updates.cjs');

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
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
    const { autoUpdater } = require('electron-updater');
    const updates = createUpdates({
      updater: autoUpdater,
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      notify: (state) =>
        BrowserWindow.getAllWindows().forEach((window) =>
          window.webContents.send('mvcad:update-status', state),
        ),
      openDownload: () =>
        shell.openExternal('https://github.com/Mithun-1/MVCAD/releases/latest/download/MVCAD-arm64.dmg'),
      install: () => {
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
      },
    });
    for (const [channel, handler] of Object.entries({
      'mvcad:update-state': updates.state,
      'mvcad:update-check': updates.check,
      'mvcad:update-download': updates.download,
      'mvcad:update-install': updates.install,
    }))
      ipcMain.handle(channel, (event) => {
        if (
          event.senderFrame !== event.sender.mainFrame ||
          !['mvcad://app/', 'mvcad://app/index.html'].includes(event.senderFrame.url)
        )
          throw new Error('Untrusted update request.');
        return handler();
      });
    // Check quietly; never download or restart without the user's button click.
    if (app.isPackaged) {
      const timer = setTimeout(() => updates.check(), 15000);
      timer.unref();
      const interval = setInterval(() => updates.check(), 4 * 60 * 60 * 1000);
      interval.unref();
    }
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
        // Emscripten's Embind generates JS bindings in the isolated CAD workers.
        // Permit that only for worker scripts; the UI retains its stricter CSP.
        headers.set(
          'Content-Security-Policy',
          /\.worker-[^/]+\.js$/.test(file)
            ? CSP.replace("'wasm-unsafe-eval'", "'wasm-unsafe-eval' 'unsafe-eval'")
            : CSP,
        );
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
