import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('Auto Sweep joins assigned vessels, updates diameter edits, skips unassigned paths, and persists toggle state', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const doc = newDocument();
  doc.baseVisibility = { front: false, top: false, right: false };
  doc.pointSets = [
    {
      id: 'points',
      name: 'Vessel points',
      visible: true,
      sourceFiles: [],
      points: [
        { id: 'a', name: 'A', x: 0, y: -75, z: 0 },
        { id: 'b', name: 'B', x: 0, y: -25, z: 0 },
        { id: 'c', name: 'C', x: 0, y: 25, z: 0 },
        { id: 'd', name: 'D', x: 0, y: 75, z: 0 },
        { id: 'e', name: 'E', x: 40, y: 0, z: 0 },
        { id: 'f', name: 'F', x: -30, y: -75, z: 0 },
        { id: 'g', name: 'G', x: -30, y: 75, z: 0 },
      ],
    },
  ];
  const node = (id: string, diameter?: number) => ({
    id,
    point: { setId: 'points', pointId: id },
    connection: 'spline' as const,
    ...(diameter ? { diameter } : {}),
  });
  doc.curves = [
    {
      id: 'main',
      name: 'Main vessel',
      visible: true,
      nodes: [node('a'), node('b', 8), node('c', 6), node('d', 9)],
    },
    { id: 'branch', name: 'Branch', visible: true, nodes: [node('b'), node('e', 7), node('c', 7)] },
    { id: 'unassigned', name: 'Unassigned', visible: true, nodes: [node('f'), node('g')] },
  ];
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('mvcad.document.v1'))
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
  }, doc);
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Auto Sweep', exact: true });
  await expect(
    page.getByRole('group', { name: 'Features', exact: true }).getByRole('button', { name: 'Auto Sweep' }),
  ).toBeVisible();
  const mainSections = page.getByRole('group', { name: 'Main vessel subcurves' });
  await page.getByRole('treeitem', { name: /^Main vessel/ }).click();
  await mainSections.getByRole('treeitem', { name: 'Subcurve 1', exact: true }).click();
  const startCutoff = page.getByRole('spinbutton', { name: 'Start cutoff (%)', exact: true });
  const endCutoff = page.getByRole('spinbutton', { name: 'End cutoff (%)', exact: true });
  const rounding = page.getByRole('spinbutton', { name: 'Rounding diameter', exact: true });
  await expect(startCutoff).toHaveValue('10');
  await expect(startCutoff).toBeDisabled();
  await expect(endCutoff).toBeEnabled();
  await expect(rounding).toHaveCount(0);
  await endCutoff.fill('51');
  await expect(page.getByRole('button', { name: 'Apply end cutoff', exact: true })).toBeDisabled();
  await expect(page.getByText('Enter a percentage from 0 to 50.', { exact: true })).toBeVisible();
  await endCutoff.fill('20');
  await page.getByRole('button', { name: 'Apply end cutoff', exact: true }).click();
  await mainSections.getByRole('treeitem', { name: 'Subcurve 2', exact: true }).click();
  await expect(startCutoff).toBeEnabled();
  await expect(endCutoff).toBeEnabled();
  await expect(rounding).toHaveCount(0);
  await expect(rounding).toHaveCount(0);
  await startCutoff.fill('0');
  await page.getByRole('button', { name: 'Apply start cutoff', exact: true }).click();
  await endCutoff.fill('50');
  await page.getByRole('button', { name: 'Apply end cutoff', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(endCutoff).toHaveValue('10');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(endCutoff).toHaveValue('50');
  await page.screenshot({ path: 'test-results/subcurve-sweep-settings.png' });
  await mainSections.getByRole('treeitem', { name: 'Subcurve 3', exact: true }).click();
  await expect(startCutoff).toBeEnabled();
  await expect(endCutoff).toBeDisabled();
  await expect(rounding).toHaveCount(0);
  await page.getByRole('treeitem', { name: /^Branch/ }).click();
  await page.getByRole('group', { name: 'Branch subcurves' }).getByRole('treeitem').click();
  await expect(startCutoff).toBeEnabled();
  await expect(endCutoff).toBeEnabled();
  await expect(rounding).toHaveCount(0);
  await expect(rounding).toHaveCount(0);
  await page.getByRole('treeitem', { name: /^Unassigned/ }).click();
  await page.getByRole('group', { name: 'Unassigned subcurves' }).getByRole('treeitem').click();
  await expect(startCutoff).toBeDisabled();
  await expect(endCutoff).toBeDisabled();
  await expect(rounding).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: /^Main vessel/ }).click();
  await mainSections.getByRole('treeitem', { name: 'Subcurve 2', exact: true }).click();
  await expect(startCutoff).toHaveValue('0');
  await expect(endCutoff).toHaveValue('50');
  await expect(rounding).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const solid = page
    .getByRole('tree', { name: 'Active bodies', exact: true })
    .getByRole('treeitem', { name: 'Body 1', exact: true });
  await expect(solid).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('treeitem', { name: /^Auto Sweep/ })).toHaveCount(0);
  await solid.click();
  await expect(page.getByTestId('sweep-body-count')).toHaveText('1');
  const triangleCount = await page.getByTestId('selected-body').getAttribute('data-triangles');
  expect(Number(triangleCount)).toBeGreaterThan(1000);
  await expect(page.locator('.properties-sidebar')).toContainText('Unassigned sections1');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await page.getByRole('button', { name: 'Fit all geometry', exact: true }).click();
  await page.screenshot({ path: 'test-results/auto-sweep.png' });
  await page.mouse.move(705, 545);
  await page.mouse.wheel(0, -1600);
  await page.screenshot({ path: 'test-results/rounded-junction-closeup.png' });
  await page.getByRole('button', { name: 'Fit all geometry', exact: true }).click();
  if (!(await mainSections.isVisible())) await page.getByRole('treeitem', { name: /^Main vessel/ }).click();
  await page
    .getByRole('group', { name: 'Main vessel subcurves' })
    .getByRole('treeitem', { name: 'Subcurve 1', exact: true })
    .click();
  await page.getByRole('spinbutton', { name: 'Diameter', exact: true }).fill('12');
  await page.getByRole('button', { name: 'Assign diameter', exact: true }).click();
  await solid.click();
  await expect(page.getByTestId('selected-body')).not.toHaveAttribute('data-triangles', triangleCount!, {
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.screenshot({ path: 'test-results/auto-sweep-dark.png' });
  await toggle.click();
  await expect(solid).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(solid).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(solid).toBeVisible({ timeout: 20000 });
  if (!(await page.getByRole('group', { name: 'Unassigned subcurves' }).isVisible()))
    await page.getByRole('treeitem', { name: /^Unassigned/ }).click();
  await page
    .getByRole('group', { name: 'Unassigned subcurves' })
    .getByRole('treeitem', { name: 'Subcurve 1', exact: true })
    .click();
  await page.getByRole('spinbutton', { name: 'Diameter', exact: true }).fill('6');
  await page.getByRole('button', { name: 'Assign diameter', exact: true }).click();
  const second = page.getByRole('treeitem', { name: 'Body 2', exact: true });
  await expect(second).toBeVisible({ timeout: 20000 });
  await second.click();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(solid).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('selected-body')).toHaveText('Body 2');
  await expect(page.getByTestId('sweep-body-count')).toHaveText('2');
  const bodySection = page.getByRole('region', { name: 'Active bodies', exact: true });
  await bodySection.getByRole('button', { name: 'Active bodies', exact: true }).click();
  await expect(second).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: /^Main vessel/ })).toBeVisible();
  await bodySection.getByRole('button', { name: 'Active bodies', exact: true }).click();
  await expect(second).toBeVisible();
  expect(errors).toEqual([]);
});
