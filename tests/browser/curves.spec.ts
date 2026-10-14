import { readSavedDocument } from '../../scripts/read-saved-document.mjs';
import { test, expect, type Page } from '@playwright/test';

const positions = [
  [-60, 0],
  [-20, 30],
  [20, -25],
  [60, 0],
  [45, 55],
];
async function pick(page: Page, index: number) {
  // The editor changes the viewport width; let its resize update the camera first.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const canvas = page.locator('.canvas-host canvas');
  const bounds = (await canvas.boundingBox())!;
  const [x, y] = positions[index];
  await canvas.click({
    position: {
      x: bounds.width / 2 + (x * bounds.height) / 360,
      y: bounds.height / 2 - (y * bounds.height) / 360,
    },
  });
}
async function setup(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Offset Coordinate System', exact: true }).click();
  await page.getByLabel('Feature name', { exact: true }).fill('Source points');
  await page.getByLabel('Import point file').setInputFiles({
    name: 'curve.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,x,y,z\n' + positions.map(([x, y], i) => `P${i + 1},${x},${y},0`).join('\n')),
  });
  await expect(page.getByRole('status')).toContainText('Imported 5 points');
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  await page.getByRole('button', { name: 'Front', exact: true }).click();
}
test('Curve button below Point starts an empty curve', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Curve through points', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const point = (await page.getByRole('button', { name: 'Point', exact: true }).boundingBox())!;
  const curve = page.getByRole('button', { name: 'Curve', exact: true });
  const bounds = (await curve.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(point.y + point.height);
  expect(bounds.x).toBe(point.x);
  await curve.click();
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create curve', exact: true })).toBeDisabled();
  await pick(page, 0);
  await pick(page, 1);
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Create curve', exact: true }).click();
  await expect(page.getByTestId('curve-point-count')).toHaveText('2');
});
test('point shortcuts create mixed curves, insert and reorder references, edit sources, suppress and resume', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await pick(page, 0);
  const shortcuts = page.getByRole('toolbar', { name: 'Point shortcuts' });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts.getByRole('button')).toHaveCount(3);
  await expect(shortcuts).toHaveText('');
  await page.screenshot({ path: 'test-results/point-shortcuts.png' });
  await shortcuts.getByRole('button', { name: 'Curve through points' }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  for (const index of [1, 2, 3]) await pick(page, index);
  await expect(page.getByRole('option')).toHaveCount(4);
  await page.getByRole('radio', { name: 'Straight line', exact: true }).check();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Move point up' }).click();
  await expect(page.getByRole('option').first()).toContainText('P2');
  await page.getByRole('button', { name: 'Move point down' }).click();
  await page.getByRole('option').nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Insert point above' }).click();
  await expect(page.getByRole('option').nth(2)).toContainText('Select point');
  await expect(page.getByRole('button', { name: 'Create curve', exact: true })).toBeDisabled();
  await pick(page, 4);
  await expect(page.getByRole('option').nth(2)).toContainText('P5');
  await page.getByRole('option').nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByRole('option').nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Insert point below' }).click();
  await pick(page, 4);
  await page.screenshot({ path: 'test-results/curve-editor.png' });
  await page.getByRole('button', { name: 'Create curve', exact: true }).click();
  await expect(page.getByTestId('curve-point-count')).toHaveText('5');
  const curve = page.getByRole('treeitem', { name: /^Curve 1/ });
  const source = page.getByRole('treeitem', { name: /^Source points/ });
  const saved = await readSavedDocument(page);
  expect(saved.curves[0].nodes.at(-1).connection).toBe('line');
  expect(saved.curves[0].nodes.map((n: any) => n.point.pointId)).toEqual(
    [0, 1, 4, 2, 3].map((i) => saved.pointSets[0].points[i].id),
  );
  await curve.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('radio', { name: 'Straight line', exact: true }).check();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await source.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  await page.getByLabel('Point 1 X', { exact: true }).fill('-75');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await source.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Suppress', exact: true }).click();
  await expect(source.locator('..')).toHaveClass(/suppressed-feature/);
  await expect(curve.locator('..')).toHaveClass(/suppressed-feature/);
  await source.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Resume', exact: true }).click();
  await expect(curve.locator('..')).not.toHaveClass(/suppressed-feature/);
  await curve.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Suppress', exact: true }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(curve.locator('..')).toHaveClass(/suppressed-feature/);
  await curve.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Resume', exact: true }).click();
  await curve.click();
  await page.keyboard.press('Delete');
  await expect(curve).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(curve).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('mvcad');
  await page.getByRole('button', { name: 'Export MVCAD', exact: true }).click();
  const path = await (await downloaded).path();
  await page.getByLabel('Open or import file').setInputFiles(path!);
  await curve.click();
  await expect(page.getByTestId('curve-point-count')).toHaveText('5');
  await source.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  await page.getByRole('button', { name: 'Remove point 1', exact: true }).click();
  await expect(page.locator('.point-editor').getByRole('alert')).toContainText('referenced by a curve');
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(errors).toEqual([]);
});

test('selecting a curve row replaces only that point on the next viewport pick', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Curve', exact: true }).click();
  for (const index of [0, 1, 2]) await pick(page, index);
  await page.getByRole('button', { name: 'Create curve', exact: true }).click();
  const before = await readSavedDocument(page);
  await page.getByRole('treeitem', { name: 'Curve 1', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  await page.getByRole('option').nth(1).click();
  await expect(page.locator('.curve-pick-hint')).toHaveText('Click a point in the workspace for row 2.');
  await pick(page, 4);
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.getByRole('option').nth(1)).toContainText('P5');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const after = await readSavedDocument(page);
  expect(after.curves[0].nodes).toEqual(
    before.curves[0].nodes.map((node: any, index: number) =>
      index === 1
        ? { ...node, point: { setId: before.pointSets[0].id, pointId: before.pointSets[0].points[4].id } }
        : node,
    ),
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(() => readSavedDocument(page).then((doc) => doc.curves[0].nodes))
    .toEqual(before.curves[0].nodes);
});

test('curve rows move the visible selection target even with the source point set hidden', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Curve', exact: true }).click();
  for (const index of [0, 1, 2]) await pick(page, index);
  await page.getByRole('button', { name: 'Create curve', exact: true }).click();
  await page.getByRole('button', { name: 'Hide Source points', exact: true }).click();
  await page.getByRole('treeitem', { name: 'Curve 1', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  const targets = async () => {
    const screenshot = await page.locator('.canvas-host canvas').screenshot();
    return page.evaluate(
      async ({ png, positions }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return positions.slice(0, 2).map(([x, y]) => {
          const pixels = context.getImageData(
            Math.round(image.width / 2 + (x * image.height) / 360) - 26,
            Math.round(image.height / 2 - (y * image.height) / 360) - 26,
            52,
            52,
          ).data;
          let orange = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (
              (pixels[i] > 140 && pixels[i + 1] > 50 && pixels[i + 1] < 115 && pixels[i + 2] < 35) ||
              (pixels[i] > 230 && pixels[i + 1] > 150 && pixels[i + 1] < 190 && pixels[i + 2] < 85)
            )
              orange++;
          return orange;
        });
      },
      { png: screenshot.toString('base64'), positions },
    );
  };
  for (const dark of [false, true]) {
    if (dark) await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
    await page.getByRole('option').nth(0).click();
    await expect.poll(targets).toEqual([expect.any(Number), 0]);
    expect((await targets())[0]).toBeGreaterThan(20);
    await page.getByRole('option').nth(1).click();
    await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(targets).toEqual([0, expect.any(Number)]);
    expect((await targets())[1]).toBeGreaterThan(20);
  }
  await page.screenshot({ path: 'test-results/curve-row-selection.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(targets).toEqual([0, 0]);
  expect((await readSavedDocument(page)).pointSets[0].visible).toBe(false);
});

test('point shortcut edit and suppress work and cancel leaves no curve', async ({ page }) => {
  await page.setViewportSize({ width: 894, height: 884 });
  await setup(page);
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(page.locator('.properties-sidebar')).toHaveCount(0);
  const workspaceWidth = (await page.locator('.canvas-host canvas').boundingBox())!.width;
  await pick(page, 1);
  await expect(page.locator('.properties-sidebar')).toHaveCount(0);
  expect((await page.locator('.canvas-host canvas').boundingBox())!.width).toBe(workspaceWidth);
  await page
    .getByRole('toolbar', { name: 'Point shortcuts' })
    .getByRole('button', { name: 'Edit feature' })
    .click();
  await expect(page.getByLabel('Point 2 X', { exact: true })).toHaveValue('-20');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.properties-sidebar')).toHaveCount(0);
  // A point selection closes an existing plane inspector and shows only shortcuts.
  await page.getByRole('treeitem', { name: 'Front Plane', exact: true }).click();
  await expect(page.locator('.properties-sidebar')).toBeVisible();
  await pick(page, 1);
  await expect(page.locator('.properties-sidebar')).toHaveCount(0);
  await page
    .getByRole('toolbar', { name: 'Point shortcuts' })
    .getByRole('button', { name: 'Curve through points' })
    .click();
  await pick(page, 2);
  await page.screenshot({ path: 'test-results/curve-editor-dark.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: /^Curve/ })).toHaveCount(0);
  await pick(page, 1);
  await page
    .getByRole('toolbar', { name: 'Point shortcuts' })
    .getByRole('button', { name: 'Suppress', exact: true })
    .click();
  await expect(page.getByRole('treeitem', { name: /^Source points/ }).locator('..')).toHaveClass(
    /suppressed-feature/,
  );
});
