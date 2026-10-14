import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importProjectFile } from '../../src/projectFile';

test('STL references select in the viewport, preview opacity, persist and stay outside body export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reference', exact: true })).toBeEnabled();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'vessel-reference.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(
      'solid vessel\nfacet normal 0 0 1\nouter loop\nvertex -40 -30 10\nvertex 40 -30 10\nvertex 0 40 10\nendloop\nendfacet\nendsolid vessel',
    ),
  });
  await expect(page.getByRole('heading', { name: 'Reference STL' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply reference' }).click();
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const canvas = page.locator('.canvas-host canvas'),
    b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2 - (10 * b.height) / 360);
  const opacity = page.getByRole('slider', { name: 'Reference opacity' });
  await expect(opacity).toHaveValue('60');
  await opacity.focus();
  await opacity.press('End');
  await opacity.press('ArrowLeft');
  await expect(opacity).toHaveValue('99');
  await page.getByRole('button', { name: 'Apply reference' }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('treeitem', { name: 'vessel-reference', exact: true }).click();
  await expect(opacity).toHaveValue('99');
  await page.getByRole('button', { name: 'Cancel reference' }).click();
  await page.getByRole('button', { name: 'Hide vessel-reference' }).click();
  await expect(page.getByRole('treeitem', { name: 'vessel-reference' }).locator('..')).toHaveClass(
    /hidden-plane/,
  );
  await page.getByRole('button', { name: 'Show vessel-reference' }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('combobox', { name: 'Export format' }).selectOption('step');
  await expect(page.getByRole('button', { name: 'Export STEP' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Export format' }).selectOption('mvcad');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MVCAD' }).click();
  const doc = await importProjectFile(new Blob([await readFile((await (await downloading).path())!)]));
  expect(doc.references[0].positions).toHaveLength(9);
  expect(doc.references[0].opacity).toBe(0.99);
  await page.getByRole('button', { name: 'Delete vessel-reference' }).click();
  await expect(page.getByRole('treeitem', { name: 'vessel-reference' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'vessel-reference' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('reference image supports plane attachment, numeric placement, mouse sizing, cancel and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 894, height: 884 });
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const g = c.getContext('2d')!;
    g.fillStyle = '#36b6db';
    g.fillRect(0, 0, 200, 100);
    g.fillStyle = '#b82738';
    g.fillRect(25, 35, 150, 30);
    return c.toDataURL().split(',')[1];
  });
  await page
    .getByLabel('Import reference file')
    .setInputFiles({ name: 'guide.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('spinbutton', { name: 'Image width' })).toHaveValue('100');
  await page.getByRole('combobox', { name: 'Image reference plane' }).selectOption('top');
  for (const [key, value] of [
    ['width', '80'],
    ['height', '40'],
    ['centerU', '15'],
    ['centerV', '20'],
  ])
    await page.getByRole('spinbutton', { name: 'Image ' + key }).fill(value);
  await page.getByRole('button', { name: 'Apply reference' }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('treeitem', { name: 'guide', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Image reference plane' })).toHaveValue('top');
  await expect(page.getByRole('spinbutton', { name: 'Image centerU' })).toHaveValue('15');
  await page.getByRole('combobox', { name: 'Image reference plane' }).selectOption('front');
  await page.getByRole('button', { name: 'Drag to size image' }).click();
  const canvas = page.locator('.canvas-host canvas'),
    b = (await canvas.boundingBox())!;
  const point = (x: number, y: number) => [
    b.x + b.width / 2 + (x * b.height) / 360,
    b.y + b.height / 2 - (y * b.height) / 360,
  ];
  const a = point(-50, -20),
    z = point(70, 40);
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(z[0], z[1], { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByRole('spinbutton', { name: 'Image width' }).inputValue()))
    .toBeCloseTo(120, 1);
  await expect
    .poll(async () => Number(await page.getByRole('spinbutton', { name: 'Image height' }).inputValue()))
    .toBeCloseTo(60, 1);
  await page.screenshot({ path: 'test-results/reference-image-placement.png' });
  await page.getByRole('button', { name: 'Cancel reference' }).click();
  await page.getByRole('treeitem', { name: 'guide', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Image width' })).toHaveValue('80');
  await expect(page.getByRole('combobox', { name: 'Image reference plane' })).toHaveValue('top');
  expect(errors).toEqual([]);
});
