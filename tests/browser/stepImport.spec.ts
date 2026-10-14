import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

test('imports the STEP sample, exposes connected subcurves, supports undo and saves assigned diameters', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const choose = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Curve options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import Curves', exact: true }).click();
  const chooser = await choose;
  await chooser.setFiles({ name: 'curves.iges', mimeType: 'text/plain', buffer: Buffer.from('unsupported') });
  await expect(page.getByText('Only STEP files are supported as of now.', { exact: true })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Curve 1', exact: true })).toHaveCount(0);
  await page.getByLabel('Open or import file').setInputFiles(resolve('SampleFiles/Geom2_Centerline.STEP'));
  await expect(page.getByRole('treeitem', { name: 'Curve 33', exact: true })).toBeAttached();
  await expect(
    page.getByText('Imported 33 STEP curves with 33 subcurves (mm). Undo removes the import.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'Curve 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const children = page.getByRole('group', { name: 'Curve 1 subcurves', exact: true });
  await children.getByRole('treeitem', { name: 'Subcurve 1', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Diameter', exact: true }).fill('8');
  await page.getByRole('button', { name: 'Assign diameter', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rounding diameter', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.keyboard.press('f');
  await page.screenshot({ path: 'test-results/step-import.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Auto Sweep', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'Body 1', exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Auto Sweep', exact: true }).click();
  await page.reload();
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: 'Curve 1', exact: true }).click();
  await children.getByRole('treeitem', { name: 'Subcurve 1', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Diameter', exact: true })).toHaveValue('8');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mvcad.document.v1')!));
  expect(saved.curves).toHaveLength(33);
  await page
    .getByLabel('Open or import file')
    .setInputFiles({ name: 'bad.stp', mimeType: 'text/plain', buffer: Buffer.from('invalid STEP') });
  await expect(page.getByText('This is not a complete STEP Part 21 file.', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('mvcad.document.v1')!).curves.length),
  ).toBe(33);
  expect(errors).toEqual([]);
});
