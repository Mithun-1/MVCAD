import { test, expect, type Page } from '@playwright/test';

async function rightClickPlane(page: Page) {
  const canvas = page.locator('.canvas-host canvas');
  const bounds = (await canvas.boundingBox())!;
  // In front view, this point is inside the plane, away from the origin and axes.
  await canvas.click({ button: 'right', position: { x: bounds.width / 2 + 40, y: bounds.height / 2 - 40 } });
}

test('viewport plane menu supports rename, reference editing, and normal view without disrupting pan', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  for (const name of ['Top Plane', 'Right Plane']) {
    await page.getByRole('treeitem', { name, exact: true }).click();
    await page.getByRole('button', { name: `Hide ${name}`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await rightClickPlane(page);
  await expect(page.getByRole('menu', { name: 'Front Plane actions' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit feature', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'View normal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Front', exact: true })).toHaveClass('active');
  await rightClickPlane(page);
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('textbox', { name: 'Rename plane', exact: true });
  await rename.fill('Elevation');
  await rename.press('Enter');
  await expect(page.getByRole('treeitem', { name: 'Elevation', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Reference plane', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Mount');
  await page.getByRole('button', { name: 'Create plane', exact: true }).click();
  await page.getByRole('treeitem', { name: 'Elevation', exact: true }).click();
  await page.getByRole('button', { name: 'Hide Elevation', exact: true }).click();
  await rightClickPlane(page);
  await expect(page.getByRole('menu', { name: 'Mount actions' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  await expect(page.getByLabel('Offset distance')).toHaveValue('25');
  await page.getByLabel('Offset distance').fill('60');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByTestId('selected-position')).toHaveText('0, 0, 60');
  await rightClickPlane(page);
  await page.getByRole('menuitem', { name: 'View normal', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await rightClickPlane(page);
  await page.screenshot({ path: 'test-results/viewport-plane-menu.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas-host canvas')).toBeFocused();

  const canvas = page.locator('.canvas-host canvas');
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width / 2 + 40;
  const y = bounds.y + bounds.height / 2 - 40;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 50, y + 20, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await canvas.click({ button: 'right', position: { x: 30, y: bounds.height - 100 } });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'View normal to plane', exact: true }).click();
  await rightClickPlane(page);
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: /^Mount/ })).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
});
