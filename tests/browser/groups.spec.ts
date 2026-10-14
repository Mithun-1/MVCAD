import { readSavedDocument } from '../../scripts/read-saved-document.mjs';
import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('multi-select, group, rename, collapse, visibility, history and document roundtrip', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const doc = newDocument();
  doc.baseVisibility = { front: false, top: false, right: false };
  doc.planes = [
    { id: 'p1', name: 'Offset A', parentId: 'front', offset: 10, visible: true },
    { id: 'p2', name: 'Offset B', parentId: 'front', offset: 20, visible: false },
  ];
  doc.pointSets = [
    {
      id: 'set',
      name: 'Points',
      visible: true,
      sourceFiles: [],
      points: [
        { id: 'a', name: 'A', x: 0, y: 0, z: 0 },
        { id: 'b', name: 'B', x: 30, y: 30, z: 0 },
      ],
    },
  ];
  doc.curves = [
    {
      id: 'curve',
      name: 'Vessel',
      visible: true,
      nodes: ['a', 'b'].map((id) => ({
        id,
        point: { setId: 'set', pointId: id },
        connection: 'line',
        diameter: 8,
      })),
    },
  ];
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('mvcad.document.v1'))
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
  }, doc);
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const tree = page.getByRole('tree', { name: 'Design tree', exact: true });
  const row = (name: string) => tree.getByRole('treeitem', { name, exact: true });
  await row('Offset A').click();
  await row('Points').click({ modifiers: ['Control'] });
  await expect(row('Offset A')).toHaveAttribute('aria-selected', 'true');
  await expect(row('Points')).toHaveAttribute('aria-selected', 'true');
  await row('Points').click({ modifiers: ['Control'] });
  await expect(row('Points')).toHaveAttribute('aria-selected', 'false');
  await row('Offset A').click();
  await row('Vessel').click({ modifiers: ['Shift'] });
  await expect(tree.getByRole('treeitem', { selected: true })).toHaveCount(4);
  await row('Points').click({ button: 'right' });
  await expect(page.getByRole('menu', { name: '4 selected actions' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Group selected', exact: true }).click();
  const group = row('Group 1');
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('group', { name: 'Group 1 members', exact: true }).getByRole('treeitem'),
  ).toHaveCount(4);
  await group.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rename group' }).fill('Vessel setup');
  await page.getByRole('textbox', { name: 'Rename group' }).press('Enter');
  await row('Vessel setup').click();
  await expect(row('Offset A')).toHaveCount(0);
  await row('Vessel setup').click();
  await expect(row('Offset A')).toBeVisible();
  await row('Vessel setup').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide group', exact: true }).click();
  await expect(tree.getByRole('button', { name: 'Show Offset A', exact: true })).toBeDisabled();
  await expect(tree.getByRole('button', { name: 'Show Points', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.screenshot({ path: 'test-results/groups-dark.png', animations: 'disabled' });
  await tree.getByRole('button', { name: 'Show Vessel setup', exact: true }).click();
  await expect(tree.getByRole('button', { name: 'Hide Offset A', exact: true })).toBeEnabled();
  await expect(tree.getByRole('button', { name: 'Show Offset B', exact: true })).toBeEnabled();
  const saved = await readSavedDocument(page);
  expect(saved.groups[0]).toMatchObject({
    name: 'Vessel setup',
    members: ['p1', 'p2', 'set', 'curve'],
    visible: true,
  });
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(row('Vessel setup')).toBeVisible();
  await row('Vessel setup').click();
  await row('Vessel').click();
  await expect(page.getByRole('group', { name: 'Vessel subcurves', exact: true })).toBeVisible();
  await row('Vessel setup').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ungroup', exact: true }).click();
  await expect(row('Vessel setup')).toHaveCount(0);
  await expect(row('Points')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row('Vessel setup')).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(row('Vessel setup')).toHaveCount(0);
  expect(errors).toEqual([]);
});
