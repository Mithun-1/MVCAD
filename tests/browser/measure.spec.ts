import { test, expect, type Page } from '@playwright/test';
import { newDocument } from '../../src/model';

async function pick(page: Page, x: number, y: number, shift = false) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const canvas = page.locator('.canvas-host canvas');
  const b = (await canvas.boundingBox())!;
  await canvas.click({
    position: { x: b.width / 2 + (x * b.height) / 360, y: b.height / 2 - (y * b.height) / 360 },
    modifiers: shift ? ['Shift'] : [],
  });
}

test('Measure shows precise points, Shift-click distance, CAD face measurements and clears stale selections', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const doc = newDocument();
  doc.baseVisibility = { front: false, top: false, right: false };
  doc.pointSets = [
    {
      id: 'points',
      name: 'Points',
      visible: true,
      sourceFiles: [],
      points: [
        { id: 'a', name: 'A', x: 50, y: 60, z: 1.123456789012345 },
        { id: 'b', name: 'B', x: 53, y: 64, z: 1.123456789012345 },
        { id: 'c', name: 'C', x: -60, y: -30, z: 0 },
        { id: 'd', name: 'D', x: 60, y: -30, z: 0 },
        { id: 'e', name: 'E', x: -60, y: 30, z: 0 },
        { id: 'f', name: 'F', x: 60, y: 30, z: 0 },
      ],
    },
  ];
  doc.curves = [
    ['c', 'd'],
    ['e', 'f'],
  ].map(([a, b], i) => ({
    id: 'curve' + i,
    name: 'Vessel ' + i,
    visible: false,
    nodes: [
      { id: a, point: { setId: 'points', pointId: a }, connection: 'line' as const },
      { id: b, point: { setId: 'points', pointId: b }, connection: 'line' as const, diameter: 20 },
    ],
  }));
  await page.addInitScript((doc) => localStorage.setItem('mvcad.document.v1', JSON.stringify(doc)), doc);
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const measure = page
    .getByRole('group', { name: 'View', exact: true })
    .getByRole('button', { name: 'Measure', exact: true });
  await measure.click();
  await pick(page, 50, 60);
  await expect(page.getByTestId('measure-0-z')).toHaveText('1.123456789012345');
  await expect(page.getByRole('toolbar', { name: 'Point shortcuts' })).toHaveCount(0);
  await pick(page, 53, 64, true);
  await expect(page.getByTestId('measure-distance')).toHaveText('5');
  await expect(page.locator('[data-measure-point]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.screenshot({ path: 'test-results/measure-points-dark.png' });
  await page.getByRole('button', { name: 'Close Measure' }).click();
  await page.getByRole('button', { name: 'Auto Sweep', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeEnabled({ timeout: 20000 });
  await measure.click();
  await pick(page, 0, -25);
  await expect(page.getByTestId('measure-diameter-0')).toHaveText('20');
  expect(Number(await page.getByTestId('measure-area-0').textContent())).toBeCloseTo(
    2 * Math.PI * 10 * 120,
    5,
  );
  await pick(page, 0, 25, true);
  await expect(page.getByText('Minimum distance', { exact: true })).toBeVisible();
  await expect(page.getByTestId('measure-distance')).toHaveText('40');
  await page.screenshot({ path: 'test-results/measure-faces-dark.png' });
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.screenshot({ path: 'test-results/measure-faces-light.png' });
  await page.getByRole('button', { name: 'Clear measurement' }).click();
  await expect(page.getByTestId('measure-distance')).toHaveCount(0);
  await expect(page.locator('[data-measure-point]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await pick(page, 4, -30);
  await expect(page.getByTestId('measure-diameter-0')).toHaveText('20');
  expect(Number(await page.getByTestId('measure-area-0').textContent())).toBeCloseTo(Math.PI * 100, 6);
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(page.locator('[data-measure-point]')).toHaveCount(0);
  await expect(page.getByTestId('measure-area-0')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(measure).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
