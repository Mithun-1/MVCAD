import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('STL transform previews, selects at transformed location, cancels, resets, undoes and persists', async ({
  page,
}) => {
  const doc = newDocument();
  doc.references = [
    {
      id: 'stl',
      name: 'Guide',
      kind: 'stl',
      visible: true,
      opacity: 0.6,
      positions: [10, 10, 0, 50, 10, 0, 10, 70, 0],
    },
  ];
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('mvcad.document.v1'))
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
  }, doc);
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('mvcad.document.v1')!).references[0]);
  const edit = () => page.getByRole('treeitem', { name: 'Guide', exact: true }).click();
  const place = async () => {
    await page.getByRole('button', { name: 'Swap reference X and Y' }).click();
    await page.getByLabel('Reference rotation Z', { exact: true }).fill('90');
    await page.getByLabel('Reference translation X', { exact: true }).fill('80');
    await page.getByLabel('Reference translation Y', { exact: true }).fill('-20');
    await page.getByLabel('Reference translation Z', { exact: true }).fill('5');
  };
  await page.goto('/');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await edit();
  await page.mouse.move(10, 10);
  const canvas = page.locator('.canvas-host canvas');
  const before = await canvas.screenshot();
  await place();
  await expect(page.getByText('Imported axes: X ← Y, Y ← X, Z ← Z', { exact: true })).toBeVisible();
  await page.mouse.move(10, 10);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('button', { name: 'Cancel reference' }).click();
  expect(await saved()).toEqual(doc.references[0]);
  await edit();
  await place();
  await page.getByLabel('Reference rotation X', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'Apply reference', exact: true })).toBeDisabled();
  await page.getByLabel('Reference rotation X', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Apply reference', exact: true }).click();
  const transformed = {
    ...doc.references[0],
    transform: { axes: [1, 0, 2], rotation: [0, 0, 90], translation: [80, -20, 5] },
  };
  expect(await saved()).toEqual(transformed);
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(
    b.x + b.width / 2 + (56.6667 * b.height) / 360,
    b.y + b.height / 2 - (10 * b.height) / 360,
  );
  await expect(canvas).toHaveAttribute('data-hover-feature', 'stl');
  await page.mouse.click(
    b.x + b.width / 2 + (56.6667 * b.height) / 360,
    b.y + b.height / 2 - (10 * b.height) / 360,
  );
  await expect(page.getByRole('heading', { name: 'Reference STL' })).toBeVisible();
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.screenshot({ path: 'test-results/reference-transforms-dark.png' });
  await page.getByRole('button', { name: 'Cancel reference' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(saved).toEqual(doc.references[0]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(saved).toEqual(transformed);
  await page.reload();
  await edit();
  await expect(page.getByLabel('Reference translation X', { exact: true })).toHaveValue('80');
  await page.getByRole('button', { name: 'Reset placement', exact: true }).click();
  await expect(page.getByLabel('Reference rotation Z', { exact: true })).toHaveValue('0');
  await expect(page.getByText('Imported axes: X ← X, Y ← Y, Z ← Z', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply reference', exact: true }).click();
  expect((await saved()).positions).toEqual(doc.references[0].positions);
  expect((await saved()).transform.translation).toEqual([0, 0, 0]);
});
