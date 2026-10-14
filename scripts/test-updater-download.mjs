// Exercise the real updater transport against a local release feed. Never execute
// the installer: quitAndInstall is intercepted inside this isolated test process.
import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { dump } from 'js-yaml';

const profile = await mkdtemp(path.join(tmpdir(), 'mvcad-update-test-'));
const installer = path.resolve('release/MVCAD.exe');
const hash = crypto.createHash('sha512');
for await (const chunk of createReadStream(installer)) hash.update(chunk);
const sha512 = hash.digest('base64');
const size = (await stat(installer)).size;
const current = JSON.parse(await readFile('package.json', 'utf8')).version;
const [major, minor, patch] = current.split('.').map(Number);
const newer = `${major}.${minor}.${patch + 1}`;
const metadata = dump({
  version: newer,
  files: [{ url: 'MVCAD.exe', sha512, size }],
  path: 'MVCAD.exe',
  sha512,
});
let downloads = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/latest.yml') {
    res.end(metadata);
    return;
  }
  if (url.pathname === '/MVCAD.exe') {
    downloads++;
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': 'application/octet-stream' });
    createReadStream(installer).pipe(res);
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, MVCAD_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  desktop = await electron.launch({
    executablePath: path.resolve('release/win-unpacked/MVCAD.exe'),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    env,
  });
  const page = await desktop.firstWindow();
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible({ timeout: 60000 });
  await desktop.evaluate(
    async ({ app }, { url, profile }) => {
      const { createRequire } = process.getBuiltinModule('module');
      const { autoUpdater } = createRequire(app.getAppPath() + '/package.json')('electron-updater');
      Object.defineProperty(autoUpdater.app, 'baseCachePath', { value: profile });
      autoUpdater.disableDifferentialDownload = true;
      autoUpdater.setFeedURL({ provider: 'generic', url });
      globalThis.mvcadTestInstall = false;
      autoUpdater.quitAndInstall = () => {
        globalThis.mvcadTestInstall = true;
      };
    },
    { url: `http://127.0.0.1:${server.address().port}/`, profile },
  );
  await page.getByRole('button', { name: 'Check app updates', exact: true }).click();
  await expect(page.getByRole('region', { name: 'App updates', exact: true })).toContainText(
    `Version ${newer} is available.`,
  );
  expect(downloads).toBe(0);
  await page.getByRole('button', { name: 'Download update', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restart and update', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  expect(downloads).toBe(1);
  expect(await desktop.evaluate(() => globalThis.mvcadTestInstall)).toBe(false);
  await page.getByRole('button', { name: 'Restart and update', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => globalThis.mvcadTestInstall)).toBe(true);
  console.log(
    'Real Windows updater passed: newer-version discovery, explicit download, checksum validation, ready state, explicit install dispatch. Installer execution intercepted.',
  );
} finally {
  await desktop?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
