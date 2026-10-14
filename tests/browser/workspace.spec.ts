import { test, expect, type Page } from '@playwright/test';

test('plane context menu uses the clicked reference and supports keyboard dismissal', async ({ page }) => {
  await ready(page);
  await page.getByRole('treeitem', { name: 'Front Plane', exact: true }).click();
  for (const [name, id] of [
    ['Top Plane', 'top'],
    ['Right Plane', 'right'],
    ['Front Plane', 'front'],
  ]) {
    const row = page.getByRole('treeitem', { name, exact: true });
    await row.click({ button: 'right' });
    await expect(page.getByRole('menu', { name: `${name} actions` })).toBeVisible();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('menuitem', { name: 'Create reference plane', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Reference plane', exact: true })).toHaveValue(id);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await create(page, 'Top Plane', '25', 'Mount');
  await page.getByRole('treeitem', { name: /^Mount/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create reference plane', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Reference plane', exact: true }).locator('option:checked'),
  ).toHaveText('Mount');
  await page.getByLabel('Name', { exact: true }).fill('Child');
  await page.getByRole('button', { name: 'Create plane', exact: true }).click();
  await expect(page.getByTestId('selected-position')).toHaveText('0, 50, 0');

  const front = page.getByRole('treeitem', { name: 'Front Plane', exact: true });
  await front.focus();
  await front.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Create reference plane', exact: true })).toBeFocused();
  await page.screenshot({ path: 'test-results/plane-context-menu.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(front).toBeFocused();
  await front.click({ button: 'right' });
  await page.getByRole('heading', { name: 'Design tree', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);

  await page.getByRole('button', { name: 'Reference plane', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unfinished');
  await front.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Create reference plane', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unfinished');
});

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
}
async function create(page: Page, parent: string, offset: string, name: string) {
  await page.getByRole('button', { name: 'Reference plane', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('combobox', { name: 'Reference plane', exact: true }).selectOption({ label: parent });
  await page.getByLabel('Offset distance').fill(offset);
  await expect(page.getByLabel('Reference plane preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create plane', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create plane', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('F2 renames a reference plane with validation, cancellation, history and persistence', async ({
  page,
}) => {
  await ready(page);
  await create(page, 'Top Plane', '25', 'Plane 1');
  await create(page, 'Plane 1', '10', 'Child');
  const original = page.getByRole('treeitem', { name: /^Plane 1/ });
  await original.click();
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: 'Rename plane', exact: true });
  await expect(input).toBeFocused();
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(7);
  await input.fill('Top Plane');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toContainText('already exists');
  await input.fill('   ');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Enter a name');
  await input.fill('Cancelled');
  await input.press('Escape');
  await expect(original).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Plane 1', exact: true })).toBeVisible();
  await page.keyboard.press('F2');
  await input.fill('  Mounting plane  ');
  await input.press('Enter');
  const renamed = page.getByRole('treeitem', { name: /^Mounting plane/ });
  await expect(renamed).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Mounting plane', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select Mounting plane in viewport' })).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(original).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(renamed).toBeVisible();
  await page.getByRole('treeitem', { name: /^Child/ }).click();
  await expect(page.locator('dd').filter({ hasText: /^Mounting plane$/ })).toBeVisible();
  await expect(page.getByTestId('selected-position')).toHaveText('0, 35, 0');
  await renamed.click();
  await page.keyboard.press('F2');
  await input.fill('Support');
  await page.getByRole('heading', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: /^Support/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('treeitem', { name: /^Support/ })).toBeVisible();
  await page.getByRole('treeitem', { name: 'Origin', exact: true }).click();
  await page.keyboard.press('F2');
  await expect(input).toHaveCount(0);
});

test('default planes and custom planes can be renamed from the menu without breaking references', async ({
  page,
}) => {
  await page.setViewportSize({ width: 894, height: 828 });
  await ready(page);
  await create(page, 'Top Plane', '25', 'Offset');
  const input = page.getByRole('textbox', { name: 'Rename plane', exact: true });
  for (const [original, renamed] of [
    ['Front Plane', 'Elevation'],
    ['Top Plane', 'Datum'],
    ['Right Plane', 'Side'],
  ]) {
    await page.getByRole('treeitem', { name: original, exact: true }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    await input.fill(renamed);
    await input.press('Enter');
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Select ${renamed} in viewport`, exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId('selected-position')).toHaveText('0, 0, 0');
  }
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('treeitem', { name: 'Right Plane', exact: true })).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('treeitem', { name: 'Side', exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: 'Datum', exact: true }).click();
  await page.keyboard.press('F2');
  await input.fill('Offset');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('Origin');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('Ground');
  await input.press('Enter');
  await page.getByRole('treeitem', { name: /^Offset/ }).click();
  await expect(page.locator('dd').filter({ hasText: /^Ground$/ })).toBeVisible();
  await expect(page.getByTestId('selected-position')).toHaveText('0, 25, 0');
  await page.getByRole('treeitem', { name: /^Offset/ }).click({ button: 'right' });
  await page.screenshot({ path: 'test-results/rename-context-menu.png' });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await input.fill('Upper');
  await input.press('Enter');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('mvcad');
  await page.getByRole('button', { name: 'Export MVCAD', exact: true }).click();
  const path = await (await downloadPromise).path();
  await page.reload();
  await expect(page.getByRole('treeitem', { name: 'Ground', exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.getByRole('treeitem', { name: 'Elevation', exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: 'Ground', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create reference plane', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Reference plane', exact: true })).toHaveValue('top');
  await expect(
    page.getByRole('combobox', { name: 'Reference plane', exact: true }).locator('option:checked'),
  ).toHaveText('Ground');
});

test('initial workspace has principal planes, selectable origin, and no browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  for (const name of ['Front Plane', 'Top Plane', 'Right Plane', 'Origin'])
    await expect(page.getByRole('treeitem', { name, exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace.png' });
  await page.getByRole('treeitem', { name: 'Top Plane', exact: true }).click();
  await expect(page.getByText('XZ', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View normal to plane' }).click();
  await page.getByRole('button', { name: 'Hide Top Plane', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show Top Plane', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hide Top Plane', exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: 'Origin', exact: true }).click();
  await expect(page.getByText('Coordinate system', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('chained offsets update after parent edit, persist, and support undo / redo', async ({ page }) => {
  await ready(page);
  await create(page, 'Top Plane', '25', 'Deck');
  await expect(page.getByTestId('selected-position')).toHaveText('0, 25, 0');
  await create(page, 'Deck', '-10', 'Lower deck');
  await expect(page.getByTestId('selected-position')).toHaveText('0, 15, 0');
  await page.screenshot({ path: 'test-results/reference-planes.png' });
  await page.getByRole('treeitem', { name: /^Deck/ }).click();
  await expect(page.getByRole('button', { name: 'Delete plane', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit plane', exact: true }).click();
  await page.getByLabel('Offset distance').fill('50');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await page.getByRole('treeitem', { name: /^Lower deck/ }).click();
  await expect(page.getByTestId('selected-position')).toHaveText('0, 40, 0');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('selected-position')).toHaveText('0, 15, 0');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByTestId('selected-position')).toHaveText('0, 40, 0');
  await page.reload();
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: /^Lower deck/ }).click();
  await expect(page.getByTestId('selected-position')).toHaveText('0, 40, 0');
  await page.getByRole('button', { name: 'Delete plane', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: /^Lower deck/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: /^Lower deck/ })).toBeVisible();
});

test('invalid input is blocked and cancel leaves no feature behind', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Reference plane', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Top Plane');
  await expect(page.getByRole('button', { name: 'Create plane', exact: true })).toBeDisabled();
  await page.getByLabel('Name', { exact: true }).fill('Offset');
  await page.getByLabel('Offset distance').fill('');
  await expect(page.getByRole('button', { name: 'Create plane', exact: true })).toBeDisabled();
  await page.getByLabel('Offset distance').fill('1000001');
  await expect(page.getByRole('button', { name: 'Create plane', exact: true })).toBeDisabled();
  await page.getByLabel('Offset distance').fill('20');
  await page.getByRole('button', { name: 'Flip direction' }).click();
  await expect(page.getByLabel('Offset distance')).toHaveValue('-20');
  await page.screenshot({ path: 'test-results/plane-preview.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Reference plane preview')).toHaveCount(0);
  await expect(page.getByRole('treeitem')).toHaveCount(4);
});

test('download roundtrip and invalid import preserve the working document', async ({ page }) => {
  await ready(page);
  await create(page, 'Right Plane', '12.5', 'Section');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('mvcad');
  await page.getByRole('button', { name: 'Export MVCAD', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  await page.getByRole('button', { name: 'Delete plane', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.getByRole('treeitem', { name: /^Section/ })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid or unsupported');
  await expect(page.getByRole('treeitem', { name: /^Section/ })).toBeVisible();
});

test('smaller desktop viewport keeps controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await ready(page);
  await create(page, 'Front Plane', '0', 'Coincident plane');
  await expect(page.getByTestId('selected-position')).toHaveText('0, 0, 0');
  await page.screenshot({ path: 'test-results/workspace-small.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
