import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('pinned section sliders combine cuts, stay usable while editing, and remove independently', async ({
  page,
}) => {
  const doc = newDocument();
  doc.baseVisibility = { front: false, top: false, right: false };
  doc.pointSets = [
    {
      id: 'pts',
      name: 'Quadrants',
      visible: true,
      sourceFiles: [],
      points: [
        [-60, -60],
        [-60, 60],
        [60, -60],
        [60, 60],
      ].map(([x, y], i) => ({ id: `p${i}`, name: `P${i}`, x, y, z: 0 })),
    },
  ];
  await page.addInitScript((doc) => localStorage.setItem('mvcad.document.v1', JSON.stringify(doc)), doc);
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const canvas = page.locator('.canvas-host canvas');
  const bounds = (await canvas.boundingBox())!;
  const hover = async (index: number, visible: boolean) => {
    const point = doc.pointSets[0].points[index];
    await page.mouse.move(
      bounds.x + bounds.width / 2 + (point.x * bounds.height) / 360,
      bounds.y + bounds.height / 2 - (point.y * bounds.height) / 360,
    );
    if (visible) await expect(canvas).toHaveAttribute('data-hover-point', point.id);
    else await expect(canvas).not.toHaveAttribute('data-hover-point', point.id);
  };
  await page.getByRole('button', { name: 'Section View', exact: true }).click();
  await page.getByLabel('Section plane', { exact: true }).selectOption('right');
  await page.getByRole('button', { name: 'Add section view', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Section sliders', exact: true }).getByRole('slider'),
  ).toHaveCount(1);
  await page.getByLabel('Section plane', { exact: true }).selectOption('top');
  await page.getByRole('button', { name: 'Keep slider in view', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Section View', exact: true })).toHaveCount(0);
  const dock = page.getByRole('region', { name: 'Section sliders', exact: true });
  await expect(dock.getByRole('slider')).toHaveCount(2);
  for (let i = 0; i < 4; i++) await hover(i, i === 3);
  const right = dock.getByRole('group', { name: 'Right Plane section slider', exact: true });
  await right.getByRole('slider').focus();
  await page.keyboard.press('Home');
  await hover(1, true);
  await hover(0, false);
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Offset Coordinate System', exact: true }).click();
  await expect(dock.getByRole('slider')).toHaveCount(2);
  await right.getByRole('slider').press('ArrowRight');
  await expect(right.getByRole('slider')).not.toHaveValue('-60');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.screenshot({ path: 'test-results/multiple-section-sliders.png' });
  await dock
    .getByRole('group', { name: 'Top Plane section slider', exact: true })
    .getByRole('button', { name: 'Remove section view' })
    .click();
  await hover(2, true);
  await hover(0, false);
  await right.getByRole('button', { name: 'Edit section view' }).click();
  await expect(page.getByLabel('Section plane', { exact: true })).toHaveValue('right');
  await page.getByRole('button', { name: 'Close Section View', exact: true }).click();
  await expect(dock).toHaveCount(0);
  await hover(0, true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mvcad.document.v1')!));
  expect(saved.pointSets).toEqual(doc.pointSets);
});
