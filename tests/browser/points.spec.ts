import { readSavedDocument } from '../../scripts/read-saved-document.mjs';
import { test, expect, type Page } from '@playwright/test';

async function savedPoints(page: Page, name: string, count: number) {
  await expect(page.getByRole('treeitem', { name, exact: true })).toHaveText(name);
  await expect
    .poll(() =>
      readSavedDocument(page).then(
        (doc) => doc.pointSets.find((set: { name: string }) => set.name === name)?.points.length,
      ),
    )
    .toBe(count);
}

async function start(page: Page, name: string) {
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Point', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Offset Coordinate System', exact: true }).click();
  await page.getByLabel('Feature name', { exact: true }).fill(name);
}
async function importCsv(page: Page, filename: string, text: string) {
  await page
    .getByLabel('Import point file')
    .setInputFiles({ name: filename, mimeType: 'text/csv', buffer: Buffer.from(text) });
}
async function editSet(page: Page, name: string) {
  await page.getByRole('treeitem', { name: new RegExp(`^${name}`) }).click({ button: 'right' });
  await expect(page.locator('.properties-sidebar')).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
}
async function coordinate(page: Page, name: string, axis: string, value: string) {
  await editSet(page, name);
  await expect(page.getByLabel(`Point 1 ${axis}`, { exact: true })).toHaveValue(value);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.properties-sidebar')).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
});

test('manual point set previews, saves, and edits through the feature context menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1304, height: 828 });
  await expect(page.getByRole('group', { name: 'Datum', exact: true })).toBeVisible();
  await start(page, 'Manual points');
  await page.getByLabel('Point 1 X', { exact: true }).fill('25.5');
  await page.getByLabel('Point 1 Y', { exact: true }).fill('40');
  await page.getByLabel('Point 1 Z', { exact: true }).fill('-15');
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.getByLabel('Point 2 X', { exact: true }).fill('-60');
  await page.getByLabel('Point 2 Y', { exact: true }).fill('30');
  await page.getByLabel('Point 2 Z', { exact: true }).fill('50');
  await expect(page.getByRole('button', { name: 'Point set preview', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/point-editor.png' });
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  await savedPoints(page, 'Manual points', 2);
  await expect(page.locator('.properties-sidebar')).toHaveCount(0);
  await page.getByRole('treeitem', { name: /^Manual points/ }).dblclick();
  await expect(page.locator('.properties-sidebar')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Select Manual points in viewport', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('treeitem', { name: /^Manual points/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  await expect(page.getByLabel('Point 1 X', { exact: true })).toHaveValue('25.5');
  await page.getByLabel('Point 1 X', { exact: true }).fill('75');
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.getByLabel('Point 3 Z', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await savedPoints(page, 'Manual points', 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await savedPoints(page, 'Manual points', 2);
  await coordinate(page, 'Manual points', 'X', '25.5');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await savedPoints(page, 'Manual points', 3);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('treeitem', { name: /^Manual points/ }).click();
  await coordinate(page, 'Manual points', 'X', '75');
  await page.getByRole('button', { name: 'Hide Manual points', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show Manual points', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show Manual points', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hide Manual points', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('multiple CSV imports become independent editable sets and later imports append', async ({ page }) => {
  await start(page, 'Survey A');
  await importCsv(page, 'a.csv', 'x,y,z\n10,20,30\n40,50,60');
  await expect(page.getByRole('status')).toContainText('Imported 2 points');
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  await start(page, 'Survey B');
  await importCsv(page, 'b.csv', 'name,x,y,z\nB1,-10,-20,-30');
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: /^Survey A/ })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /^Survey B/ })).toBeVisible();
  await page.getByRole('treeitem', { name: /^Survey A/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  await importCsv(page, 'append.csv', '70,80,90');
  await expect(page.getByLabel('Point 3 X', { exact: true })).toHaveValue('70');
  await expect(page.getByLabel('Point 3 name', { exact: true })).toHaveValue('P1_2');
  await page.getByLabel('Point 1 Y', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await savedPoints(page, 'Survey A', 4);
  expect(await readSavedDocument(page).then((doc) => doc.pointSets[0].sourceFiles)).toEqual([
    'a.csv',
    'append.csv',
  ]);
  await page.getByRole('treeitem', { name: /^Survey B/ }).click();
  await savedPoints(page, 'Survey B', 1);
  await coordinate(page, 'Survey B', 'Y', '-20');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption('mvcad');
  await page.getByRole('button', { name: 'Export MVCAD', exact: true }).click();
  const file = await (await downloading).path();
  await page.getByRole('treeitem', { name: /^Survey B/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: /^Survey B/ })).toHaveCount(0);
  await page.getByLabel('Open or import file').setInputFiles(file!);
  await expect(page.getByRole('treeitem', { name: /^Survey B/ })).toBeVisible();
});

test('invalid CSV and coordinates preserve drafts, cancel restores a saved set, and large tables paginate', async ({
  page,
}) => {
  await page.setViewportSize({ width: 894, height: 828 });
  await start(page, 'Coordinates');
  await page.getByLabel('Point 1 X', { exact: true }).fill('12');
  await importCsv(page, 'bad.csv', 'x,y,z\n1,2,3\n4,no,6');
  await expect(page.getByRole('alert')).toContainText('Line 3');
  await expect(page.getByLabel('Point 1 X', { exact: true })).toHaveValue('12');
  await expect(page.getByLabel('Point 2 X', { exact: true })).toHaveCount(0);
  await page.getByLabel('Point 1 X', { exact: true }).fill('Infinity');
  await expect(page.getByRole('button', { name: 'Create points', exact: true })).toBeDisabled();
  await page.getByLabel('Point 1 X', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  await editSet(page, 'Coordinates');
  await page.getByLabel('Point 1 X', { exact: true }).fill('99');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await coordinate(page, 'Coordinates', 'X', '12');
  await start(page, 'Large set');
  await importCsv(
    page,
    'large.csv',
    'x,y,z\n' + Array.from({ length: 125 }, (_, i) => `${i},${i * 2},${i * 3}`).join('\n'),
  );
  await expect(page.getByRole('status')).toContainText('Imported 125 points');
  await expect(page.getByLabel('Point 50 X', { exact: true })).toHaveValue('49');
  await page.getByRole('button', { name: 'Next points', exact: true }).click();
  await expect(page.getByLabel('Point 51 X', { exact: true })).toHaveValue('50');
  await page.getByRole('button', { name: 'Next points', exact: true }).click();
  await expect(page.getByLabel('Point 125 Z', { exact: true })).toHaveValue('372');
  await page.screenshot({ path: 'test-results/point-editor-small.png' });
  await page.getByRole('button', { name: 'Create points', exact: true }).click();
  await savedPoints(page, 'Large set', 125);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
