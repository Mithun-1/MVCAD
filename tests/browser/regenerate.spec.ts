import { readSavedDocument } from '../../scripts/read-saved-document.mjs';
import { test, expect } from '@playwright/test';
import { newDocument } from '../../src/model';

test('regeneration shows centered progress on reload and manually rebuilds solid and shell', async ({
  page,
}) => {
  const doc = newDocument();
  doc.autoSweep = true;
  doc.pointSets = [
    {
      id: 'points',
      name: 'Points',
      visible: false,
      sourceFiles: [],
      points: [
        { id: 'a', name: 'A', x: 0, y: 0, z: 0 },
        { id: 'b', name: 'B', x: 20, y: 30, z: 0 },
        { id: 'c', name: 'C', x: 0, y: 60, z: 0 },
      ],
    },
  ];
  doc.curves = [
    {
      id: 'vessel',
      name: 'Vessel',
      visible: false,
      nodes: ['a', 'b', 'c'].map((id) => ({
        id,
        point: { setId: 'points', pointId: id },
        connection: 'spline',
        diameter: 8,
      })),
    },
  ];
  await page.addInitScript((doc) => {
    if (!localStorage.getItem('mvcad.document.v1'))
      localStorage.setItem('mvcad.document.v1', JSON.stringify(doc));
    const state = { appearances: 0, chunkUpdates: 0 };
    Object.assign(window, { regenerationTest: state });
    let visible = false;
    new MutationObserver(() => {
      const next = !!document.querySelector('[role="progressbar"][aria-label="Regenerating"]');
      if (next && !visible) state.appearances++;
      visible = next;
    }).observe(document, { childList: true, subtree: true });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event) => {
          if (event.data.progress > 10) state.chunkUpdates++;
        });
      }
    };
  }, doc);
  let release!: () => void;
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*replicad*.wasm*', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const progress = page.getByRole('progressbar', { name: 'Regenerating' });
  const regenerate = page.getByRole('button', { name: 'Regenerate', exact: true });
  const remove = page.getByRole('button', { name: 'Remove', exact: true });
  await expect(progress).toBeVisible();
  await expect(progress.locator('img')).toHaveJSProperty('complete', true);
  await expect(progress.locator('img')).toHaveJSProperty('naturalWidth', 640);
  const frame = await progress.locator('img').evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      cornerAlpha: rgba[3],
      opaquePixels: rgba.filter((v, i) => i % 4 === 3 && v > 240).length,
    };
  });
  expect(frame.cornerAlpha).toBe(0);
  expect(frame.opaquePixels).toBeGreaterThan(1000);
  await expect(regenerate).toBeDisabled();
  const workspace = (await page.getByRole('region', { name: 'Model workspace' }).boundingBox())!;
  const card = (await page.locator('.regeneration-card').boundingBox())!;
  expect(Math.abs(card.x + card.width / 2 - workspace.x - workspace.width / 2)).toBeLessThan(2);
  expect(Math.abs(card.y + card.height / 2 - workspace.y - workspace.height / 2)).toBeLessThan(2);
  await page.screenshot({ path: 'test-results/regenerating-light.png' });
  release();
  await expect(progress).toBeHidden();
  await expect(regenerate).toBeEnabled();
  const rb = (await regenerate.boundingBox())!,
    mb = (await remove.boundingBox())!;
  expect(rb.y).toBeGreaterThanOrEqual(mb.y + mb.height);
  expect(Math.abs(rb.x - mb.x)).toBeLessThan(2);
  const saved = await readSavedDocument(page).then((doc) => JSON.stringify(doc));
  const counts = () =>
    page.evaluate(
      () =>
        (window as unknown as { regenerationTest: { appearances: number; chunkUpdates: number } })
          .regenerationTest,
    );
  const before = await counts();
  await regenerate.click();
  await expect.poll(async () => (await counts()).appearances).toBeGreaterThan(before.appearances);
  await expect(regenerate).toBeEnabled();
  expect((await counts()).chunkUpdates).toBeGreaterThan(before.chunkUpdates);
  expect(await readSavedDocument(page).then((doc) => JSON.stringify(doc))).toEqual(saved);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await remove.click();
  await expect(regenerate).toBeEnabled();
  await regenerate.click();
  await expect(regenerate).toBeEnabled();
  await page.getByRole('treeitem', { name: 'Body 1', exact: true }).click();
  await expect(page.getByTestId('selected-body')).toHaveAttribute('data-body-kind', 'surface');
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(progress).toBeVisible();
  await expect(progress.locator('img')).toHaveJSProperty('naturalWidth', 640);
  await expect(page.locator('.regeneration-card')).toHaveCSS('background-color', 'rgb(12, 12, 12)');
  await page.screenshot({ path: 'test-results/regenerating-dark.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => progress.locator('img').evaluate((img: HTMLImageElement) => img.currentSrc))
    .toContain('regenerating-rbc-still');
  release();
  await expect(progress).toBeHidden();
  await expect(regenerate).toBeEnabled();
  await expect(remove).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Auto Sweep', exact: true }).click();
  await expect(regenerate).toBeDisabled();
  await expect(progress).toBeHidden();
});
