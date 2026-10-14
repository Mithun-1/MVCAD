import { test, expect } from '@playwright/test';
import { newDocument, STORAGE_KEY } from '../../src/model';

test('New part is left of Open, clears the workspace, and preserves the previous part through undo', async ({
  page,
}) => {
  const original = newDocument();
  original.name = 'Existing vessel part';
  original.planes = [{ id: 'offset', name: 'Offset plane', parentId: 'front', offset: 30, visible: true }];
  original.baseVisibility.top = false;
  await page.addInitScript(
    ({ key, doc }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(doc));
    },
    { key: STORAGE_KEY, doc: original },
  );
  await page.goto('/');
  await expect(page.getByRole('treeitem', { name: 'Offset plane', exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: 'Offset plane', exact: true }).click();
  const button = page.getByRole('button', { name: 'New part', exact: true });
  const position = (await button.boundingBox())!;
  const open = (await page.getByRole('button', { name: 'Open document', exact: true }).boundingBox())!;
  expect(position.x + position.width).toBeLessThanOrEqual(open.x);
  await button.click();
  await expect(page.getByRole('treeitem', { name: 'Offset plane', exact: true })).toHaveCount(0);
  await expect(page.locator('.properties-sidebar')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY))
    .toEqual(newDocument());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'Offset plane', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY))
    .toEqual(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('treeitem', { name: 'Offset plane', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rename part', exact: true })).toContainText('Untitled part');
});
