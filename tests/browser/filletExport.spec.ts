import { readSavedDocument } from '../../scripts/read-saved-document.mjs';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newDocument } from '../../src/model';

test('Features fillet selects real edges, persists, edits, suppresses, and exports native solid/shell STEP', async ({
  page,
}) => {
  test.setTimeout(90000);
  const doc = newDocument();
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
      ].map(([x, y, z], i) => ({ id: String(i), name: `P${i}`, x, y, z })),
    },
  ];
  const node = (i: number, diameter?: number) => ({
    id: `n${i}`,
    point: { setId: 'points', pointId: String(i) },
    connection: 'line' as const,
    diameter,
  });
  doc.curves = [
    { id: 'main', name: 'Main', visible: true, nodes: [node(0), node(1, 8), node(2, 8)] },
    { id: 'branch', name: 'Branch', visible: true, nodes: [node(1), node(3, 6)] },
  ];
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('mvcad.document.v1'))
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
  }, doc);
  await page.goto('/');
  await expect(page.getByRole('treeitem', { name: 'Body 1', exact: true })).toBeVisible();
  const showEdges = page.getByRole('button', { name: 'Show Edges', exact: true });
  const spacing = (await page.getByRole('button', { name: 'Check Spacing', exact: true }).boundingBox())!;
  const edgesBounds = (await showEdges.boundingBox())!;
  expect(edgesBounds.x).toBeGreaterThanOrEqual(spacing.x + spacing.width);
  expect(Math.abs(edgesBounds.y - spacing.y)).toBeLessThan(2);
  await expect(showEdges).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(10, 10);
  const withoutEdges = await page.locator('.canvas-host canvas').screenshot();
  await showEdges.click();
  await page.mouse.move(10, 10);
  await expect(showEdges).toHaveAttribute('aria-pressed', 'true');
  const withEdges = await page.locator('.canvas-host canvas').screenshot();
  expect(withEdges.equals(withoutEdges)).toBe(false);
  await showEdges.click();
  await expect(showEdges).toHaveAttribute('aria-pressed', 'false');
  const features = page.getByRole('group', { name: 'Features', exact: true });
  await features.getByRole('button', { name: 'Rounding', exact: true }).click();
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const canvas = page.locator('.canvas-host canvas');
  const bounds = (await canvas.boundingBox())!;
  // Front orthographic view: select the two distinct junction arcs.
  for (const y of [27, 33]) {
    await page.mouse.move(
      bounds.x + bounds.width / 2 + (4 * bounds.height) / 360,
      bounds.y + bounds.height / 2 - (y * bounds.height) / 360,
    );
    await expect(canvas).toHaveAttribute('data-hover-feature', /^__edge__:BSPLINE_CURVE:/);
    await page.mouse.down();
    await page.mouse.up();
  }
  await expect(page.getByRole('heading', { name: 'Selected edges (2)', exact: true })).toBeVisible();
  const preview = page.getByRole('status').filter({ hasText: 'Rounding preview — Apply' });
  await expect(preview).toBeVisible();
  expect(await readSavedDocument(page).then((doc) => doc.fillets ?? [])).toEqual([]);
  await page.mouse.move(10, 10);
  const radius15 = await canvas.screenshot();
  await page.getByRole('spinbutton', { name: 'Fillet radius', exact: true }).fill('0.5');
  await expect(preview).toBeVisible();
  const radius05 = await canvas.screenshot();
  expect(radius05.equals(radius15)).toBe(false);
  await page.getByRole('spinbutton', { name: 'Fillet radius', exact: true }).fill('1000000');
  await expect(page.getByRole('status').filter({ hasText: 'Preview unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply fillet', exact: true })).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Fillet radius', exact: true }).fill('1.5');
  await expect(preview).toBeVisible();
  // Original edge references remain removable after their geometry is rounded.
  await page.getByRole('button', { name: 'Remove fillet edge 2', exact: true }).click();
  await expect(preview).toBeVisible();
  await page.mouse.click(
    bounds.x + bounds.width / 2 + (4 * bounds.height) / 360,
    bounds.y + bounds.height / 2 - (33 * bounds.height) / 360,
  );
  await expect(page.getByRole('heading', { name: 'Selected edges (2)', exact: true })).toBeVisible();
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: 'Apply fillet', exact: true }).click();
  const fillet = page.getByRole('treeitem', { name: 'Fillet 1', exact: true });
  await expect(fillet).toBeVisible();
  await expect(features.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit feature', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply fillet', exact: true })).toBeEnabled();
  await page.getByRole('spinbutton', { name: 'Fillet radius', exact: true }).fill('0.5');
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: 'Cancel fillet', exact: true }).click();
  await expect(features.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  await expect(page.locator('.properties-body')).toContainText('Radius: 1.5');
  expect(await readSavedDocument(page).then((doc) => doc.fillets[0].radius)).toBe(1.5);
  await page.getByRole('button', { name: 'Edit feature', exact: true }).click();
  await expect(preview).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Fillet radius', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply fillet', exact: true }).click();
  await expect(features.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Suppress', exact: true }).click();
  await expect(fillet.locator('..')).toHaveClass(/suppressed-feature/);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(features.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(fillet).toBeVisible();
  await fillet.click();
  await expect(page.locator('.properties-body')).toContainText('Radius: 1');
  const downloadStep = async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('step');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export STEP', exact: true }).click();
    return readFile((await (await download).path())!, 'utf8');
  };
  const solid = await downloadStep();
  expect(solid).toContain('MANIFOLD_SOLID_BREP');
  expect(solid).toContain('ADVANCED_FACE');
  expect(solid).not.toMatch(/FACETED_BREP|POLY_LOOP|TRIANGULATED_FACE/);
  await features.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(features.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  const shell = await downloadStep();
  expect(shell).toContain('OPEN_SHELL');
  expect(shell).not.toContain('MANIFOLD_SOLID_BREP');
  await page.screenshot({ path: 'test-results/fillet-native.png' });
});
