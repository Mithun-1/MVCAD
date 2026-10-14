import { test, expect, type Page } from '@playwright/test';
import { newDocument } from '../../src/model';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('mvcad-workspace');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const result = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(['projects', 'assets'], 'readonly');
      const p = tx.objectStore('projects').get('current');
      const a = tx.objectStore('assets').getAll();
      tx.oncomplete = () =>
        resolve({
          project: p.result,
          assets: a.result.map((v: any) => ({
            id: v.id,
            size: v.data instanceof Blob ? v.data.size : v.data.byteLength,
            encoding: v.encoding,
          })),
        });
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return result;
  });
}
const saved = (page: Page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

test('legacy autosave migrates references to binary assets without losing edits on reload', async ({
  page,
}) => {
  const doc = {
    ...newDocument(),
    name: 'Migrated part',
    references: [
      {
        id: 'guide',
        name: 'Guide',
        kind: 'stl',
        visible: true,
        opacity: 0.6,
        positions: [0, 0, 0, 40, 0, 0, 0, 40, 0],
      },
    ],
  };
  await page.addInitScript((doc) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
      sessionStorage.setItem('seeded', 'yes');
    }
  }, doc);
  await page.goto('/');
  await saved(page);
  expect(await page.evaluate(() => localStorage.getItem('mvcad.document.v1'))).toBeNull();
  const first = await snapshot(page);
  expect(first.assets).toHaveLength(1);
  expect(first.assets[0]).toMatchObject({ encoding: 'f64', size: 72 });
  expect(first.project.references[0].positions).toBeUndefined();
  await page.getByRole('button', { name: 'Hide Guide' }).click();
  await expect(page.getByRole('button', { name: 'Show Guide' })).toBeVisible();
  await saved(page);
  expect((await snapshot(page)).project.references[0].visible).toBe(false);
  expect((await snapshot(page)).assets).toEqual(first.assets);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Rename part' })).toContainText('Migrated part');
  await expect(page.getByRole('button', { name: 'Show Guide' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Guide' }).click();
  await saved(page);
  expect((await snapshot(page)).assets).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect((await snapshot(page)).assets).toEqual(first.assets);
});

test('large STL persists beyond localStorage capacity and survives reload', async ({ page }) => {
  test.setTimeout(90_000);
  const triangles = 210000;
  const bytes = Buffer.alloc(84 + triangles * 50);
  bytes.writeUInt32LE(triangles, 80);
  for (let i = 0; i < triangles; i++) {
    const x = (i % 500) * 0.1 - 25,
      y = Math.floor(i / 500) * 0.1 - 21;
    [x, y, 0, x + 0.09, y, 0, x, y + 0.09, 0].forEach((v, j) => bytes.writeFloatLE(v, 96 + i * 50 + j * 4));
  }
  await page.goto('/');
  await page
    .getByLabel('Import reference file')
    .setInputFiles({ name: 'large.stl', mimeType: 'model/stl', buffer: bytes });
  await page.getByRole('button', { name: 'Apply reference' }).click();
  await saved(page);
  const first = await snapshot(page);
  expect(first.assets[0].size).toBe(triangles * 9 * 4);
  expect(first.assets[0].size).toBeGreaterThan(5 * 1024 ** 2);
  expect(JSON.stringify(first.project).length).toBeLessThan(5000);
  await page.reload();
  await page.getByRole('treeitem', { name: 'large', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Reference opacity' })).toHaveValue('60');
  await page.getByRole('slider', { name: 'Reference opacity' }).fill('30');
  await page.getByRole('button', { name: 'Apply reference' }).click();
  await saved(page);
  expect((await snapshot(page)).assets).toEqual(first.assets);
});

test('failed save is atomic, retry recovers, and persistence denial is explained', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { value: async () => false });
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => false });
  });
  await page.goto('/');
  await saved(page);
  const first = await snapshot(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'projects') {
        IDBObjectStore.prototype.put = original;
        throw new DOMException('Simulated full disk', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Rename part' }).click();
  await page.getByRole('textbox', { name: 'Part name' }).fill('Unsaved change');
  await page.getByRole('textbox', { name: 'Part name' }).press('Enter');
  await expect(page.getByText('Not saved', { exact: true })).toBeVisible();
  expect(await snapshot(page)).toEqual(first);
  await page.getByRole('button', { name: 'Browser storage', exact: true }).click();
  await page.getByRole('button', { name: 'Keep data on this device' }).click();
  await expect(page.getByText(/The browser did not grant persistence/)).toBeVisible();
  await page.screenshot({ path: 'test-results/browser-storage.png' });
  await page.getByRole('button', { name: 'Retry save' }).click();
  await saved(page);
  expect((await snapshot(page)).project.name).toBe('Unsaved change');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Rename part' })).toContainText('Unsaved change');
});

test('failed migration preserves the old save and succeeds after storage becomes available', async ({
  page,
}) => {
  const doc = {
    ...newDocument(),
    name: 'Recover me',
    references: [
      {
        id: 'ref',
        name: 'Guide',
        kind: 'stl',
        visible: false,
        opacity: 0.6,
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      },
    ],
  };
  await page.addInitScript((doc) => {
    localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'projects') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('Simulated full disk', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  }, doc);
  await page.goto('/');
  await expect(page.getByText('Restore failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename part' })).toContainText('Recover me');
  expect(await page.evaluate(() => localStorage.getItem('mvcad.document.v1'))).toBe(JSON.stringify(doc));
  expect((await snapshot(page)).assets).toHaveLength(0);
  await page.getByRole('button', { name: 'Browser storage', exact: true }).click();
  await page.getByRole('button', { name: 'Retry save' }).click();
  await saved(page);
  expect(await page.evaluate(() => localStorage.getItem('mvcad.document.v1'))).toBeNull();
  const recovered = await snapshot(page);
  expect(recovered.project.name).toBe('Recover me');
  expect(recovered.assets).toHaveLength(1);
});
