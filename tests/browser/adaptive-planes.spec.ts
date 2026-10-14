import { test, expect } from '@playwright/test';

test('CSV point extents resize plane rendering and picking, and hiding the set restores default size', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  for (const name of ['Top Plane', 'Right Plane']) {
    await page.getByRole('treeitem', { name, exact: true }).click();
    await page.getByRole('button', { name: `Hide ${name}`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Offset Coordinate System', exact: true }).click();
  await page.getByLabel('Feature name', { exact: true }).fill('Wide cloud');
  await page.getByLabel('Import point file').setInputFiles({
    name: 'wide.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('x,y,z\n-400,-200,-50\n400,200,50\n300,-100,20'),
  });
  await expect(page.getByRole('status')).toContainText('Imported 3 points');
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: /^Wide cloud/ })).toHaveText('Wide cloud');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await page.getByRole('button', { name: 'Fit all geometry', exact: true }).click();
  const canvas = page.locator('.canvas-host canvas');
  const bounds = (await canvas.boundingBox())!;
  const position = { x: bounds.width / 2 + bounds.height * 0.2, y: bounds.height / 2 - bounds.height * 0.05 };
  await canvas.click({ button: 'right', position });
  await expect(page.getByRole('menu', { name: 'Front Plane actions' })).toBeVisible();
  await expect(page.getByTestId('selected-position')).toHaveText('0, 0, 0');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/adaptive-plane-range.png' });
  await page.getByRole('treeitem', { name: /^Wide cloud/ }).click();
  await page.getByRole('button', { name: 'Hide Wide cloud', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show Wide cloud', exact: true })).toBeVisible();
  await canvas.click({ button: 'right', position });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show Wide cloud', exact: true }).click();
  await canvas.click({ button: 'right', position });
  await expect(page.getByRole('menu', { name: 'Front Plane actions' })).toBeVisible();
});
