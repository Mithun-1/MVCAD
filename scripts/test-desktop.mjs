import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newDocument } from '../src/model.ts';

const profile = await mkdtemp(path.join(tmpdir(), 'mvcad-desktop-test-'));
const output = path.resolve('test-results/desktop');
await mkdir(output, { recursive: true });
const options = {
  ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE } : {}),
  args: [
    ...(process.env.DESKTOP_EXECUTABLE ? [] : ['.']),
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  env: { ...process.env, MVCAD_USER_DATA: profile, ELECTRON_ENABLE_LOGGING: '1' },
};
delete options.env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  desktop = await electron.launch(options);
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible({ timeout: 60000 });
  expect(page.url()).toBe('mvcad://app/');
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  expect(await page.evaluate(() => typeof window.mvcadDesktop?.checkForUpdates)).toBe('function');
  await expect(page.getByRole('button', { name: 'Check app updates', exact: true })).toBeVisible();
  await desktop.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('mvcad:update-status', {
      status: 'available',
      currentVersion: '0.1.1',
      version: '0.2.0',
      percent: 0,
      manual: process.platform === 'darwin',
      message: '',
    });
  });
  await page.getByRole('button', { name: 'App update available', exact: true }).click();
  await expect(page.getByRole('region', { name: 'App updates', exact: true })).toContainText(
    'Version 0.2.0 is available.',
  );
  await page.getByRole('button', { name: 'Close app updates', exact: true }).click();
  const doc = newDocument();
  doc.name = 'Desktop smoke test';
  doc.autoSweep = true;
  doc.pointSets = [
    {
      id: 'points',
      name: 'Points',
      visible: false,
      sourceFiles: [],
      points: [0, 30].map((y, i) => ({ id: 'p' + i, name: 'P' + i, x: 0, y, z: 0 })),
    },
  ];
  doc.curves = [
    {
      id: 'curve',
      name: 'Vessel',
      visible: true,
      nodes: [0, 1].map((i) => ({
        id: 'n' + i,
        point: { setId: 'points', pointId: 'p' + i },
        connection: 'line',
        diameter: 6,
      })),
    },
  ];
  await page.getByLabel('Open or import file').setInputFiles({
    name: 'desktop.mvcad',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page.getByRole('treeitem', { name: 'Body 1', exact: true })).toBeVisible({ timeout: 60000 });
  const file = path.join(output, 'desktop.step');
  await desktop.evaluate(({ session }, file) => {
    globalThis.mvcadTestDownload = 'pending';
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSavePath(file);
      item.once('done', (_event, state) => {
        globalThis.mvcadTestDownload = state;
      });
    });
  }, file);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('step');
  await page.getByRole('button', { name: 'Export STEP', exact: true }).click();
  await expect
    .poll(() => desktop.evaluate(() => globalThis.mvcadTestDownload), { timeout: 60000 })
    .toBe('completed');
  expect(await readFile(file, 'utf8')).toContain('MANIFOLD_SOLID_BREP');
  await page.screenshot({ path: path.join(output, 'desktop.png') });
  expect(errors).toEqual([]);
  await desktop.close();
  desktop = await electron.launch(options);
  const reopened = await desktop.firstWindow();
  await expect(reopened.getByRole('treeitem', { name: 'Body 1', exact: true })).toBeVisible({
    timeout: 60000,
  });
  expect(await reopened.evaluate(() => JSON.parse(localStorage.getItem('mvcad.document.v1')).name)).toBe(
    'Desktop smoke test',
  );
  console.log(
    'Desktop smoke passed: isolated renderer, offline CAD generation, file import, STEP export, persisted document after restart.',
  );
} finally {
  await desktop?.close();
}
