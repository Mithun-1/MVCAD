import { test, expect, type Page } from '@playwright/test';

async function plane(page: Page, name: string) {
  await page.getByRole('button', { name: 'Reference plane', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create plane', exact: true }).click();
}

test('Delete menus and Del remove custom features with undo, while protecting defaults, dependents and drafts', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const front = page.getByRole('treeitem', { name: 'Front Plane', exact: true });
  await front.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect(front).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect(front).toBeVisible();

  await plane(page, 'Parent');
  await plane(page, 'Child');
  const parent = page.getByRole('treeitem', { name: /^Parent/ });
  const child = page.getByRole('treeitem', { name: /^Child/ });
  await parent.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
  await page.keyboard.press('Delete');
  await expect(parent).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('alert')).toContainText('dependent planes first');
  await child.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(child).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(child).toBeVisible();
  await child.click({ button: 'right' });
  await page.keyboard.press('Delete');
  await expect(child).toHaveCount(0);
  await parent.click();
  await page.keyboard.press('Delete');
  await expect(parent).toHaveCount(0);

  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Offset Coordinate System', exact: true }).click();
  await page.getByLabel('Feature name', { exact: true }).fill('Samples');
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  const points = page.getByRole('treeitem', { name: /^Samples/ });
  await points.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(points).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await points.click();
  await page.keyboard.press('F2');
  const rename = page.getByLabel('Rename point set', { exact: true });
  await rename.press('Delete');
  await expect(rename).toHaveValue('');
  await rename.press('Escape');
  await expect(points).toBeVisible();
  await page.getByRole('button', { name: 'Reference plane', exact: true }).click();
  await points.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'New reference plane', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(points).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await points.click();
  await page.keyboard.press('Delete');
  await expect(points).toHaveCount(0);
  await page.reload();
  await expect(points).toHaveCount(0);
});
