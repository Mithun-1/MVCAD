import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('dragging from an off-center point rotates around that point without a snap', async ({ page }) => {
  const doc = newDocument();
  doc.baseVisibility = { front: false, top: false, right: false };
  doc.pointSets = [
    {
      id: 'points',
      name: 'Points',
      visible: true,
      sourceFiles: [],
      points: [
        { id: 'pivot', name: 'Pivot', x: 65, y: 35, z: 20 },
        { id: 'other', name: 'Other', x: -50, y: -40, z: -30 },
      ],
    },
  ];
  await page.addInitScript((doc) => localStorage.setItem('mvcad.document.v1', JSON.stringify(doc)), doc);
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const canvas = page.locator('.canvas-host canvas');
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2 + (65 * box.height) / 360;
  const y = box.y + box.height / 2 - (35 * box.height) / 360;
  const axis = () => page.locator('.axis-key').innerHTML();
  await page.mouse.move(x, y);
  await expect(canvas).toHaveAttribute('data-hover-point', 'pivot');
  const before = await axis();
  await page.mouse.down();
  await expect.poll(axis).toEqual(before);
  await page.mouse.move(x + 130, y + 45, { steps: 10 });
  await page.mouse.up();
  await expect.poll(axis).not.toEqual(before);
  await page.mouse.move(x, y);
  await expect(canvas).toHaveAttribute('data-hover-point', 'pivot');
  // A second orbit should continue to use the mouse anchor, not a stale center.
  await page.mouse.down();
  await page.mouse.move(x - 70, y + 80, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(x, y);
  await expect(canvas).toHaveAttribute('data-hover-point', 'pivot');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await page.mouse.move(x, y);
  await expect(canvas).toHaveAttribute('data-hover-point', 'pivot');
  await page.screenshot({ path: 'test-results/cursor-orbit.png' });
});
