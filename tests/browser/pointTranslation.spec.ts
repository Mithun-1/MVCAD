import { readSavedDocument } from '../../scripts/read-saved-document.mjs';
import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('translation moves all pages and skipped points atomically with cancel, undo, and persistence', async ({
  page,
}) => {
  const doc = newDocument();
  doc.pointSets = [
    {
      id: 'cloud',
      name: 'Cloud',
      visible: true,
      sourceFiles: ['source.pts'],
      skipPoints: 3,
      points: Array.from({ length: 51 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        x: i,
        y: i + 100,
        z: 0 - i,
      })),
    },
  ];
  doc.curves = [
    {
      id: 'curve',
      name: 'Curve',
      visible: true,
      nodes: [1, 50].map((i) => ({
        id: `n${i}`,
        point: { setId: 'cloud', pointId: `p${i}` },
        connection: 'line',
      })),
    },
  ];
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('mvcad.document.v1'))
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
  }, doc);
  const readDoc = () => readSavedDocument(page);
  const edit = async () => {
    await page.getByRole('treeitem', { name: 'Cloud', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  };
  const translate = async () => {
    await page.getByLabel('Translate X', { exact: true }).fill('10.5');
    await page.getByLabel('Translate Y', { exact: true }).fill('-20');
    await page.getByLabel('Translate Z', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Translate', exact: true }).click();
  };
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await edit();
  await translate();
  await expect(page.getByLabel('Point 1 X', { exact: true })).toHaveValue('10.5');
  await expect(page.getByLabel('Point 1 Y', { exact: true })).toHaveValue('80');
  await expect(page.getByLabel('Point 1 Z', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Translate X', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Next points', exact: true }).click();
  await expect(page.getByLabel('Point 51 X', { exact: true })).toHaveValue('60.5');
  await expect(page.getByLabel('Point 51 Y', { exact: true })).toHaveValue('130');
  await expect(page.getByLabel('Point 51 Z', { exact: true })).toHaveValue('-47');
  await page.screenshot({ path: 'test-results/point-translation.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await readDoc()).pointSets).toEqual(doc.pointSets);
  await edit();
  await page.getByLabel('Translate X', { exact: true }).fill('999999');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Point 3:');
  await expect(page.getByLabel('Point 1 X', { exact: true })).toHaveValue('0');
  await page.getByLabel('Translate X', { exact: true }).fill('invalid');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a numeric coordinate');
  await translate();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('.point-editor')).toHaveCount(0);
  const translated = {
    ...doc.pointSets[0],
    points: doc.pointSets[0].points.map((p) => ({
      ...p,
      x: p.x + 10.5,
      y: p.y - 20,
      z: p.z + 3,
    })),
  };
  expect((await readDoc()).pointSets[0]).toEqual(translated);
  expect((await readDoc()).curves).toEqual(doc.curves);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await readDoc()).pointSets).toEqual(doc.pointSets);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await readDoc()).pointSets[0]).toEqual(translated);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await edit();
  await expect(page.getByLabel('Translate X', { exact: true })).toHaveValue('0');
  expect((await readDoc()).pointSets[0]).toEqual(translated);
});
