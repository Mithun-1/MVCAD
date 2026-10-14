import { test, expect, type Page } from '@playwright/test';
import { newDocument } from '../../src/model';

async function pixelChange(page: Page, before: Buffer, after: Buffer) {
  return page.evaluate(
    async (images) => {
      const pixels = await Promise.all(
        images.map(async (data) => {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        }),
      );
      let largest = 0;
      for (let i = 0; i < pixels[0].length; i++) {
        largest = Math.max(largest, Math.abs(pixels[0][i] - pixels[1][i]));
      }
      return largest;
    },
    [before.toString('base64'), after.toString('base64')],
  );
}

async function moveTo(page: Page, x: number, y: number) {
  const box = (await page.locator('.canvas-host canvas').boundingBox())!;
  await page.mouse.move(
    box.x + box.width / 2 + (x * box.height) / 360,
    box.y + box.height / 2 - (y * box.height) / 360,
  );
}

for (const theme of ['light', 'dark']) {
  test(`hover previews exact click targets without labels in ${theme} mode`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const doc = newDocument();
    doc.baseVisibility = { front: true, top: false, right: false };
    doc.pointSets = [
      {
        id: 'cloud',
        name: 'Source points',
        visible: true,
        sourceFiles: [],
        points: [
          { id: 'a', name: 'First', x: -60, y: 30, z: 0 },
          { id: 'b', name: 'Nearby', x: -58, y: 30, z: 20 },
          { id: 'c', name: 'Last', x: 60, y: 30, z: 0 },
          { id: 'd', name: 'Bottom', x: 0, y: -60, z: 0 },
        ],
      },
    ];
    doc.curves = [
      {
        id: 'curve',
        name: 'Test curve',
        visible: true,
        nodes: [
          { id: 'n1', point: { setId: 'cloud', pointId: 'a' }, connection: 'spline' },
          { id: 'n2', point: { setId: 'cloud', pointId: 'c' }, connection: 'line' },
        ],
      },
    ];
    await page.addInitScript(
      ({ doc, theme }) => {
        localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
        localStorage.setItem('mvcad.theme', theme);
      },
      { doc, theme },
    );
    await page.goto('/');
    await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Front', exact: true }).click();
    const canvas = page.locator('.canvas-host canvas');
    // Wait for the document's worker-evaluated geometry before taking a baseline.
    await moveTo(page, 60, 30);
    await expect(canvas).toHaveAttribute('data-hover-point', 'c');
    await page.mouse.move(10, 10);
    const baseline = await canvas.screenshot({ path: `test-results/baseline-${theme}.png` });
    for (const [x, y, id] of [
      [20, -20, 'front'],
      [0, 30, 'subcurve:["curve","n1","n2"]'],
      [0, 0, 'origin'],
    ] as const) {
      await moveTo(page, x, y);
      await expect(canvas).toHaveAttribute('data-hover-feature', id);
      expect(await pixelChange(page, baseline, await canvas.screenshot())).toBeGreaterThan(10);
      await page.mouse.move(10, 10);
      await expect(canvas).not.toHaveAttribute('data-hover-feature');
      // The browser compositor can round the background gradient by one color level.
      expect(await pixelChange(page, baseline, await canvas.screenshot())).toBeLessThanOrEqual(2);
    }
    // Both points are inside the pick radius: the closest screen position wins,
    // even when its neighbor is closer to the camera.
    await moveTo(page, -60, 30);
    await expect(canvas).toHaveAttribute('data-hover-point', 'a');
    await moveTo(page, -58, 30);
    await expect(canvas).toHaveAttribute('data-hover-point', 'b');
    await expect(canvas).not.toHaveAttribute('title');
    await page.screenshot({ path: `test-results/hover-${theme}.png` });
    await page.mouse.down({ button: 'right' });
    await expect(canvas).not.toHaveAttribute('data-hover-point');
    await page.mouse.move(700, 500, { steps: 4 });
    await expect(canvas).not.toHaveAttribute('data-hover-feature');
    await page.mouse.up({ button: 'right' });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'Front', exact: true }).click();
    await moveTo(page, -58, 30);
    await expect(canvas).toHaveAttribute('data-hover-point', 'b');
    await page.mouse.down();
    await page.mouse.up();
    await page
      .getByRole('toolbar', { name: 'Point shortcuts' })
      .getByRole('button', { name: 'Curve through points' })
      .click();
    await expect(page.getByRole('option').first()).toContainText('Nearby');
    // Opening the editor resizes the canvas; wait for layout and its ResizeObserver
    // before calculating a screen coordinate from the new viewport bounds.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await moveTo(page, 60, 30);
    await expect(canvas).toHaveAttribute('data-hover-point', 'c');
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByRole('option')).toHaveCount(2);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('treeitem', { name: /^Source points/ }).click();
    await page.getByRole('button', { name: 'Hide Source points', exact: true }).click();
    await moveTo(page, -58, 30);
    await expect(canvas).not.toHaveAttribute('data-hover-point');
    expect(errors).toEqual([]);
  });
}
