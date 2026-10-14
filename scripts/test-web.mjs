import { readSavedDocument } from './read-saved-document.mjs';
import { chromium, webkit, expect } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, readFile } from 'node:fs/promises';
import { newDocument } from '../src/model.ts';

// Exercise the same subdirectory URLs as GitHub Pages, including worker/Wasm assets.
const server = process.env.WEB_TEST_URL
  ? null
  : await preview({
      base: '/MVCAD/',
      build: { outDir: 'dist-web' },
      preview: { host: '127.0.0.1', port: 4175, strictPort: true },
    });
const url = process.env.WEB_TEST_URL || 'http://127.0.0.1:4175/MVCAD/';
await mkdir('test-results/web', { recursive: true });
try {
  for (const name of (process.env.WEB_TEST_BROWSERS || 'chromium,webkit').split(',')) {
    const browser = await { chromium, webkit }[name].launch({
      ...(name === 'chromium'
        ? {
            ...(process.env.WEB_TEST_CHANNEL ? { channel: process.env.WEB_TEST_CHANNEL } : {}),
            args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
          }
        : {}),
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(url);
      await expect(page.getByText('Engine ready', { exact: true })).toBeVisible({ timeout: 60000 });
      await expect(page.locator('.canvas-host canvas')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Check app updates', exact: true })).toHaveCount(0);
      const doc = newDocument();
      doc.name = 'Browser smoke test';
      doc.references = [
        {
          id: 'guide',
          name: 'Guide',
          kind: 'stl',
          visible: false,
          opacity: 0.6,
          positions: [0, 0, 0, 10, 0, 0, 0, 10, 0],
        },
      ];
      doc.references.push({
        id: 'image',
        name: 'Image guide',
        kind: 'image',
        visible: false,
        opacity: 0.5,
        dataUrl: await page.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 4;
          canvas.getContext('2d').fillRect(0, 0, 4, 4);
          return canvas.toDataURL();
        }),
        planeId: 'front',
        width: 20,
        height: 20,
        centerU: 0,
        centerV: 0,
      });
      doc.autoSweep = true;
      doc.pointSets = [
        {
          id: 'points',
          name: 'Points',
          visible: false,
          sourceFiles: [],
          points: [
            [0, 0, 0],
            [0, 30, 0],
            [0, 60, 0],
            [30, 30, 0],
          ].map(([x, y, z], i) => ({
            id: String(i),
            name: `P${i}`,
            x,
            y,
            z,
          })),
        },
      ];
      const node = (i, diameter) => ({
        id: `n${i}`,
        point: { setId: 'points', pointId: String(i) },
        connection: 'line',
        diameter,
      });
      doc.curves = [
        { id: 'main', name: 'Main', visible: true, nodes: [node(0), node(1, 8), node(2, 8)] },
        { id: 'branch', name: 'Branch', visible: true, nodes: [node(1), node(3, 6)] },
      ];
      await page.getByLabel('Open or import file').setInputFiles({
        name: 'browser.mvcad',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(doc)),
      });
      await expect(page.getByRole('treeitem', { name: 'Body 1', exact: true })).toBeVisible({
        timeout: 60000,
      });
      await page.getByRole('button', { name: 'Show Edges', exact: true }).click();
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('step');
      const download = page.waitForEvent('download', { timeout: 60000 });
      await page.getByRole('button', { name: 'Export STEP', exact: true }).click();
      expect(await readFile(await (await download).path(), 'utf8')).toContain('MANIFOLD_SOLID_BREP');
      await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('treeitem', { name: 'Body 1', exact: true })).toBeVisible({
        timeout: 60000,
      });
      expect(await readSavedDocument(page).then((doc) => doc.name)).toBe(doc.name);
      expect(await readSavedDocument(page).then((saved) => saved.references)).toEqual(doc.references);
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('mvcad');
      const compactDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export MVCAD', exact: true }).click();
      const compact = await readFile(await (await compactDownload).path());
      expect(compact.subarray(0, 8).toString()).toBe('MVCAD2\r\n');
      await page.getByLabel('Open or import file').setInputFiles({
        name: 'compact.mvcad',
        mimeType: 'application/octet-stream',
        buffer: compact,
      });
      await expect(page.getByText('Document opened. Undo restores the previous document.')).toBeVisible();
      expect(await readSavedDocument(page).then((saved) => saved.references)).toEqual(doc.references);
      await page.screenshot({ path: `test-results/web/${name}.png` });
      expect(errors).toEqual([]);
      console.log(
        `${name}: startup, CAD union, STEP export, binary reference persistence and compact project roundtrip passed at ${url}`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
