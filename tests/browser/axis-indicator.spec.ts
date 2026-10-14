import { test, expect } from '@playwright/test';

test('axis indicator follows standard views and orbit but stays fixed during pan and zoom', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await expect(page.getByText('Y UP', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dark mode', exact: true })).toBeVisible();
  const axis = (name: string) => page.locator(`.axis-key [data-axis="${name}"]`);
  const endpoint = async (name: string, coordinate: string) =>
    Number(await axis(name).locator('line').getAttribute(coordinate));
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await expect.poll(() => endpoint('X', 'x2')).toBeCloseTo(64, 1);
  await expect.poll(() => endpoint('Y', 'y2')).toBeCloseTo(16, 1);
  await expect(axis('Z').locator('title')).toHaveText('Positive Z toward viewer');
  await page.screenshot({ path: 'test-results/axis-front.png' });
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await expect.poll(() => endpoint('Z', 'x2')).toBeCloseTo(16, 1);
  await expect.poll(() => endpoint('Y', 'y2')).toBeCloseTo(16, 1);
  await expect(axis('X').locator('title')).toHaveText('Positive X toward viewer');
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await expect(axis('Y').locator('title')).toHaveText('Positive Y toward viewer');
  await page.getByRole('button', { name: 'Isometric view', exact: true }).click();
  await expect.poll(() => endpoint('X', 'x2')).toBeGreaterThan(50);
  const snapshot = () =>
    page.locator('.axis-key').evaluate((svg) =>
      ['X', 'Y', 'Z'].map((name) => {
        const line = svg.querySelector(`[data-axis="${name}"] line`)!;
        return [Number(line.getAttribute('x2')).toFixed(3), Number(line.getAttribute('y2')).toFixed(3)];
      }),
    );
  const initial = await snapshot();
  const canvas = page.locator('.canvas-host canvas');
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 110, y + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(snapshot).not.toEqual(initial);
  const rotated = await snapshot();
  await page.screenshot({ path: 'test-results/axis-orbit.png' });
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 155, y + 55, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, -120);
  await page.getByRole('button', { name: 'Fit all geometry', exact: true }).click();
  await expect.poll(snapshot).toEqual(rotated);
  await page.getByRole('treeitem', { name: 'Front Plane', exact: true }).dblclick();
  await expect(axis('Z').locator('title')).toHaveText('Positive Z toward viewer');
  await expect.poll(() => endpoint('X', 'x2')).toBeCloseTo(64, 1);
});
