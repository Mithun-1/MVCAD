import { test, expect, type Page } from '@playwright/test';

const readSet = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('mvcad.document.v1')!).pointSets[0]);
async function edit(page: Page) {
  await page.getByRole('treeitem', { name: 'Point set 1', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
}

test('coordinate swaps cover every page and preserve identities through save, cancel and undo', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Offset Coordinate System', exact: true }).click();
  await page.getByLabel('Import point file').setInputFiles({
    name: 'axes.pts',
    mimeType: 'text/plain',
    buffer: Buffer.from(Array.from({ length: 51 }, (_, i) => `${i} ${i + 100} ${-i - 200}`).join('\n')),
  });
  await expect(page.getByRole('status')).toContainText('Imported 51 points');
  await page.getByRole('button', { name: 'Swap Y and Z', exact: true }).click();
  await expect(page.getByLabel('Point 1 Y', { exact: true })).toHaveValue('-200');
  await expect(page.getByLabel('Point 1 Z', { exact: true })).toHaveValue('100');
  await page.getByRole('button', { name: 'Next points', exact: true }).click();
  await expect(page.getByLabel('Point 51 Y', { exact: true })).toHaveValue('-250');
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  await expect(page.locator('.point-editor')).toHaveCount(0);
  const original = await readSet(page);
  expect(original.points.map((p: { x: number; y: number; z: number }) => [p.x, p.y, p.z])).toEqual(
    Array.from({ length: 51 }, (_, i) => [i, -i - 200, i + 100]),
  );
  expect(original.sourceFiles).toEqual(['axes.pts']);

  await edit(page);
  await page.getByRole('button', { name: 'Swap X and Y', exact: true }).click();
  await expect(page.getByLabel('Point 1 X', { exact: true })).toHaveValue('-200');
  await expect(page.getByLabel('Point 1 Y', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Swap X and Z', exact: true }).click();
  await expect(page.getByLabel('Point 1 X', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('Point 1 Z', { exact: true })).toHaveValue('-200');
  await page.screenshot({ path: 'test-results/point-coordinate-swaps.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await readSet(page)).toEqual(original);

  await edit(page);
  await page.getByRole('button', { name: 'Swap X and Z', exact: true }).click();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('.point-editor')).toHaveCount(0);
  const swapped = await readSet(page);
  expect(swapped).toEqual({
    ...original,
    points: original.points.map((p: { x: number; z: number }) => ({ ...p, x: p.z, z: p.x })),
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => readSet(page)).toEqual(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => readSet(page)).toEqual(swapped);
  await page.reload();
  await edit(page);
  await expect(page.getByLabel('Point 1 X', { exact: true })).toHaveValue('100');
  expect(await readSet(page)).toEqual(swapped);
});
