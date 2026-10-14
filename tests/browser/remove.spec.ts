import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('Remove opens all vessel ends, restores solids, and supports history and reload', async ({ page }) => {
  const doc = newDocument();
  doc.baseVisibility = { front: false, top: false, right: false };
  doc.pointSets = [
    {
      id: 'points',
      name: 'Points',
      visible: false,
      sourceFiles: [],
      points: [
        { id: 'a', name: 'A', x: 0, y: -30, z: 0 },
        { id: 'b', name: 'B', x: 0, y: 30, z: 0 },
      ],
    },
  ];
  doc.curves = [
    {
      id: 'vessel',
      name: 'Vessel',
      visible: false,
      nodes: [
        { id: 'a', point: { setId: 'points', pointId: 'a' }, connection: 'line' },
        { id: 'b', point: { setId: 'points', pointId: 'b' }, connection: 'line', diameter: 18 },
      ],
    },
  ];
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('mvcad.document.v1'))
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
  }, doc);
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const features = page.getByRole('group', { name: 'Features', exact: true });
  const remove = features.getByRole('button', { name: 'Remove', exact: true });
  const auto = features.getByRole('button', { name: 'Auto Sweep', exact: true });
  await expect(remove).toBeDisabled();
  const a = (await auto.boundingBox())!,
    r = (await remove.boundingBox())!;
  expect(r.x).toBeGreaterThan(a.x + a.width);
  expect(Math.abs(r.y - a.y)).toBeLessThan(5);
  await auto.click();
  await expect(remove).toBeEnabled({ timeout: 20000 });
  await page.getByRole('treeitem', { name: 'Body 1', exact: true }).click();
  const body = page.getByTestId('selected-body');
  await expect(body).toHaveAttribute('data-body-kind', 'solid');
  const solidTriangles = Number(await body.getAttribute('data-triangles'));
  await page.getByRole('button', { name: 'Fit all geometry', exact: true }).click();
  await page.screenshot({ path: 'test-results/remove-sharp-solid.png' });
  await remove.click();
  await expect(body).toHaveAttribute('data-body-kind', 'surface', { timeout: 20000 });
  expect(Number(await body.getAttribute('data-triangles'))).toBeLessThan(solidTriangles);
  await expect(remove).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Fit all geometry', exact: true }).click();
  await page.screenshot({ path: 'test-results/remove-surface-shell.png' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body).toHaveAttribute('data-body-kind', 'solid', { timeout: 20000 });
  await expect(body).toHaveAttribute('data-triangles', String(solidTriangles));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(body).toHaveAttribute('data-body-kind', 'surface', { timeout: 20000 });
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(remove).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('treeitem', { name: 'Body 1', exact: true }).click();
  await expect(body).toHaveAttribute('data-body-kind', 'surface', { timeout: 20000 });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(body).toHaveAttribute('data-body-kind', 'solid', { timeout: 20000 });
  await expect(body).toHaveAttribute('data-triangles', String(solidTriangles));
});
