import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('skip points previews, preserves picking IDs and curve references, and supports cancel/undo/reload', async ({
  page,
}) => {
  const doc = newDocument();
  doc.pointSets = [
    {
      id: 'cloud',
      name: 'Cloud',
      visible: true,
      sourceFiles: [],
      points: Array.from({ length: 9 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        x: -80 + i * 20,
        y: 40,
        z: 0,
      })),
    },
  ];
  doc.curves = [
    {
      id: 'curve',
      name: 'Curve',
      visible: true,
      nodes: [1, 5].map((i) => ({
        id: `n${i}`,
        point: { setId: 'cloud', pointId: `p${i}` },
        connection: 'line',
      })),
    },
  ];
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('mvcad.document.v1'))
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
  }, doc);
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const canvas = page.locator('.canvas-host canvas');
  const readDoc = () => page.evaluate(() => JSON.parse(localStorage.getItem('mvcad.document.v1')!));
  const edit = async () => {
    await page.getByRole('treeitem', { name: 'Cloud', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  };
  const hover = async (i: number) => {
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(
      box.x + box.width / 2 + ((-80 + i * 20) * box.height) / 360,
      box.y + box.height / 2 - (40 * box.height) / 360,
    );
  };
  await hover(1);
  await expect(canvas).toHaveAttribute('data-hover-point', 'p1');
  await edit();
  const skip = page.getByRole('spinbutton', { name: 'Skip points', exact: true });
  await expect(skip).toHaveValue('0');
  await expect(page.getByText('9 of 9 points shown', { exact: true })).toBeVisible();
  await page.mouse.move(10, 10);
  const before = await canvas.screenshot();
  await skip.fill('2');
  await expect(page.getByText('3 of 9 points shown', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeEnabled();
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.screenshot({ path: 'test-results/point-skipping.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await readDoc()).pointSets[0].skipPoints).toBeUndefined();
  await hover(1);
  await expect(canvas).toHaveAttribute('data-hover-point', 'p1');
  await edit();
  await skip.fill('2');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('.point-editor')).toHaveCount(0);
  expect((await readDoc()).pointSets[0].points).toEqual(doc.pointSets[0].points);
  expect((await readDoc()).curves).toEqual(doc.curves);
  await hover(1);
  await expect(canvas).not.toHaveAttribute('data-hover-point');
  await hover(6);
  await expect(canvas).toHaveAttribute('data-hover-point', 'p6');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await hover(1);
  await expect(canvas).toHaveAttribute('data-hover-point', 'p1');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await readDoc()).pointSets[0].skipPoints).toBe(2);
  await page.reload();
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await edit();
  await expect(skip).toHaveValue('2');
  await skip.fill('-1');
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeDisabled();
  await skip.fill('0');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('.point-editor')).toHaveCount(0);
  expect((await readDoc()).pointSets[0].points).toEqual(doc.pointSets[0].points);
});
