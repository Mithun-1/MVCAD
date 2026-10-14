import { test, expect, type Page } from '@playwright/test';
import { newDocument } from '../../src/model';

async function move(page: Page, x: number, y: number, click = false) {
  const box = (await page.locator('.canvas-host canvas').boundingBox())!;
  await page.mouse.move(
    box.x + box.width / 2 + (x * box.height) / 360,
    box.y + box.height / 2 - (y * box.height) / 360,
  );
  if (click) {
    await page.mouse.down();
    await page.mouse.up();
  }
}

test('shared-point branches split master curves into expandable, individually selectable subcurves', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const doc = newDocument();
  doc.baseVisibility = { front: false, top: false, right: false };
  doc.pointSets = [
    {
      id: 'points',
      name: 'Centerline points',
      visible: true,
      sourceFiles: [],
      points: [
        { id: 'bottom', name: 'Bottom', x: 0, y: -60, z: 0 },
        { id: 'join', name: 'Junction', x: 0, y: 0, z: 0 },
        { id: 'top', name: 'Top', x: 0, y: 60, z: 0 },
        { id: 'end', name: 'Branch end', x: 60, y: 0, z: 0 },
      ],
    },
  ];
  doc.curves = [
    {
      id: 'master',
      name: 'Curve 1',
      visible: true,
      nodes: ['bottom', 'join', 'top'].map((pointId) => ({
        id: pointId,
        point: { setId: 'points', pointId },
        connection: 'spline',
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
  const master = page.getByRole('treeitem', { name: /^Curve 1/ });
  const children = page.getByRole('group', { name: 'Curve 1 subcurves' });
  await master.click();
  await expect(children.getByRole('treeitem')).toHaveCount(1);
  await expect(children.getByRole('img', { name: /^Connected:/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Curve', exact: true }).click();
  await move(page, 60, 0, true);
  await move(page, 0, 0, true);
  await page.getByRole('button', { name: 'Create curve', exact: true }).click();
  await expect(children.getByRole('treeitem')).toHaveCount(2);
  const chain = children.getByRole('img', { name: /^Connected:/ });
  await expect(chain).toHaveCount(1);
  await expect(chain).toHaveAttribute(
    'aria-label',
    'Connected: Curve 1 / Subcurve 1; Curve 1 / Subcurve 2; Curve 2 / Subcurve 1',
  );
  const firstBounds = (await children.getByRole('treeitem').nth(0).boundingBox())!;
  const lastBounds = (await children.getByRole('treeitem').nth(1).boundingBox())!;
  const chainBounds = (await chain.boundingBox())!;
  expect(chainBounds.y).toBeGreaterThanOrEqual(firstBounds.y + firstBounds.height);
  expect(chainBounds.y + chainBounds.height).toBeLessThanOrEqual(lastBounds.y);
  const branch = page.getByRole('treeitem', { name: /^Curve 2/ });
  await branch.click();
  await expect(page.getByRole('group', { name: 'Curve 2 subcurves' }).getByRole('treeitem')).toHaveCount(1);
  await expect(
    page.getByRole('group', { name: 'Curve 2 subcurves' }).getByRole('img', { name: /^Connected:/ }),
  ).toHaveCount(0);
  await move(page, 0, -30);
  await expect(canvas).toHaveAttribute('data-hover-feature', 'subcurve:["master","bottom","join"]');
  await move(page, 0, -30, true);
  await expect(children.getByRole('treeitem', { name: 'Subcurve 1', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'Subcurve 1', exact: true })).toBeVisible();
  await expect(page.locator('.properties-sidebar dt')).toHaveCount(0);
  const diameter = page.getByRole('spinbutton', { name: 'Diameter', exact: true });
  const assign = page.getByRole('button', { name: 'Assign diameter', exact: true });
  await expect(diameter).toHaveValue('');
  await diameter.fill('0');
  await expect(assign).toBeDisabled();
  await diameter.fill('-3');
  await expect(assign).toBeDisabled();
  await diameter.fill('2.5');
  await assign.click();
  await expect(assign).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(diameter).toHaveValue('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(diameter).toHaveValue('2.5');
  await page.keyboard.press('Delete');
  await expect(master).toBeVisible();
  await move(page, 0, 30);
  await expect(canvas).toHaveAttribute('data-hover-feature', 'subcurve:["master","join","top"]');
  await move(page, 0, 30, true);
  await expect(children.getByRole('treeitem', { name: 'Subcurve 2', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(diameter).toHaveValue('');
  await diameter.fill('4');
  await assign.click();
  await page.screenshot({ path: 'test-results/subcurves.png' });
  await master.click();
  await expect(children).toHaveCount(0);
  await master.press('ArrowRight');
  await expect(children.getByRole('treeitem')).toHaveCount(2);
  // Move the branch connection from an interior point to a master endpoint.
  await branch.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit feature', exact: true }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Select point', exact: true }).click();
  await move(page, 0, 60, true);
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(children.getByRole('treeitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(children.getByRole('treeitem')).toHaveCount(2);
  await branch.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Suppress', exact: true }).click();
  await expect(children.getByRole('treeitem')).toHaveCount(1);
  await expect(chain).toHaveCount(0);
  await branch.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Resume', exact: true }).click();
  await expect(children.getByRole('treeitem')).toHaveCount(2);
  await expect(chain).toHaveCount(1);
  await page.getByRole('button', { name: 'Hide Curve 2', exact: true }).click();
  await expect(children.getByRole('treeitem')).toHaveCount(2);
  await expect(chain).toHaveCount(1);
  await branch.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(children.getByRole('treeitem')).toHaveCount(1);
  await expect(chain).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(children.getByRole('treeitem')).toHaveCount(2);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await master.click();
  await expect(children.getByRole('treeitem')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/subcurves-dark.png' });
  await children.getByRole('treeitem', { name: 'Subcurve 1', exact: true }).click();
  await expect(diameter).toHaveValue('2.5');
  await children.getByRole('treeitem', { name: 'Subcurve 2', exact: true }).click();
  await expect(diameter).toHaveValue('4');
  expect(errors).toEqual([]);
});
