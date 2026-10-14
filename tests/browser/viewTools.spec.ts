import { readSavedDocument } from '../../scripts/read-saved-document.mjs';
import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('bounding box persists, spacing measures a vessel, and section clipping hides points from picking', async ({
  page,
}) => {
  const doc = newDocument();
  doc.autoSweep = true;
  doc.pointSets = [
    {
      id: 'pts',
      name: 'Vessel points',
      visible: true,
      sourceFiles: [],
      points: [
        { id: 'a', name: 'A', x: 20, y: 20, z: 20 },
        { id: 'b', name: 'B', x: 80, y: 20, z: 80 },
      ],
    },
  ];
  doc.curves = [
    {
      id: 'curve',
      name: 'Vessel',
      visible: true,
      nodes: [
        { id: 'n1', point: { setId: 'pts', pointId: 'a' }, connection: 'line' },
        { id: 'n2', point: { setId: 'pts', pointId: 'b' }, connection: 'line', diameter: 8 },
      ],
    },
  ];
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('mvcad.document.v1'))
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
  }, doc);
  await page.goto('/');
  await expect(page.getByRole('treeitem', { name: 'Body 1', exact: true })).toBeVisible();
  const view = page.getByRole('group', { name: 'View', exact: true });
  await view.getByRole('button', { name: 'Bounding Box', exact: true }).click();
  for (const label of ['Lx', 'Ly', 'Lz'])
    await page.getByRole('spinbutton', { name: label, exact: true }).fill('100');
  await page.getByRole('button', { name: 'Apply bounding box', exact: true }).click();
  const tree = page.getByRole('tree', { name: 'Design tree', exact: true });
  await expect(tree.getByRole('treeitem').first()).toHaveText('Computational Domain');
  const domain = page.getByRole('group', { name: 'Computational Domain members', exact: true });
  await expect(domain.getByRole('treeitem')).toHaveCount(6);
  for (const label of ['Lx_0', 'Ly_0', 'Lz_0'])
    await expect(domain.getByRole('treeitem', { name: label, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide Computational Domain', exact: true }).click();
  await expect(domain.locator('.tree-row.hidden-plane')).toHaveCount(6);
  await page.getByRole('button', { name: 'Show Computational Domain', exact: true }).click();
  await expect(domain.locator('.tree-row.hidden-plane')).toHaveCount(0);
  for (const label of ['Lx', 'Ly', 'Lz'])
    await expect(page.getByRole('treeitem', { name: label, exact: true })).toBeVisible();
  await view.getByRole('button', { name: 'Check Spacing', exact: true }).click();
  await expect
    .poll(async () => Math.abs(Number(await page.getByTestId('box-spacing').textContent()) - 16))
    .toBeLessThan(0.02);
  await expect(page.locator('.spacing-dimension')).toBeVisible();
  await page.getByRole('button', { name: 'Fit all geometry', exact: true }).click();
  await page.screenshot({ path: 'test-results/view-spacing.png', animations: 'disabled' });
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('treeitem', { name: 'Computational Domain', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'Lx', exact: true })).toBeVisible();
  await view.getByRole('button', { name: 'Section View', exact: true }).click();
  await page.getByRole('combobox', { name: 'Section plane', exact: true }).selectOption('front');
  await page.getByRole('spinbutton', { name: 'Section offset', exact: true }).fill('50');
  await expect(page.getByRole('slider', { name: 'Section position', exact: true })).toHaveValue('50');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const canvas = page.locator('.canvas-host canvas');
  const bounds = (await canvas.boundingBox())!;
  const move = async (x: number, y: number) =>
    page.mouse.move(
      bounds.x + bounds.width / 2 + (x * bounds.height) / 360,
      bounds.y + bounds.height / 2 - (y * bounds.height) / 360,
    );
  await move(20, 20);
  await expect(canvas).not.toHaveAttribute('data-hover-point', 'a');
  await move(80, 20);
  await expect(canvas).toHaveAttribute('data-hover-point', 'b');
  await page.getByRole('combobox', { name: 'Section keep side', exact: true }).selectOption('below');
  await move(80, 20);
  await expect(canvas).not.toHaveAttribute('data-hover-point', 'b');
  await move(20, 20);
  await expect(canvas).toHaveAttribute('data-hover-point', 'a');
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.screenshot({ path: 'test-results/view-section-dark.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Close Section View', exact: true }).click();
  await move(80, 20);
  await expect(canvas).toHaveAttribute('data-hover-point', 'b');
  const saved = await readSavedDocument(page);
  expect(saved.curves).toEqual(doc.curves);
  expect(saved.pointSets).toEqual(doc.pointSets);
  expect(saved.planes).toHaveLength(3);
});
