import { test, expect } from '@playwright/test';

test('PTS imports through the point editor, invalid rows preserve the draft, and points persist', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Offset Coordinate System' }).click();
  const upload = page.getByLabel('Import point file');
  await expect(upload).toHaveAttribute('accept', /\.pts/);
  await upload.setInputFiles({
    name: 'centerline.pts',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '0.000000 21.000000 73.500000\n0.000000 22.500000 73.500000\n397.500000 319.500000 48.000000\n',
    ),
  });
  await expect(page.getByRole('status')).toContainText('Imported 3 points from centerline.pts.');
  await expect(page.getByLabel('Point 1 Y', { exact: true })).toHaveValue('21');
  await expect(page.getByLabel('Point 3 X', { exact: true })).toHaveValue('397.5');
  await upload.setInputFiles({
    name: 'bad.pts',
    mimeType: 'text/plain',
    buffer: Buffer.from('1 2 3\n4 bad 6'),
  });
  await expect(page.locator('.point-editor').getByRole('alert')).toContainText('Line 2');
  await expect(page.getByLabel('Point 3 X', { exact: true })).toHaveValue('397.5');
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  await expect(page.locator('.point-editor')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('treeitem', { name: 'Point set 1', exact: true })).toBeVisible();
  const doc = await page.evaluate(() => JSON.parse(localStorage.getItem('mvcad.document.v1')!));
  expect(doc.pointSets[0].sourceFiles).toEqual(['centerline.pts']);
  expect(doc.pointSets[0].points.map((p: { x: number; y: number; z: number }) => [p.x, p.y, p.z])).toEqual([
    [0, 21, 73.5],
    [0, 22.5, 73.5],
    [397.5, 319.5, 48],
  ]);
});
