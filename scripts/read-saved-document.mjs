import { expect } from '@playwright/test';

// Test helper: read committed IndexedDB state, including separately stored binary references.
export async function readSavedDocument(page) {
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mvcad-workspace', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'assets'], 'readonly');
      let project;
      const assets = new Map();
      const request = tx.objectStore('projects').get('current');
      request.onsuccess = () => {
        project = request.result;
        for (const ref of project?.references ?? []) {
          const r = tx.objectStore('assets').get(ref.assetId);
          r.onsuccess = () => assets.set(ref.assetId, r.result);
        }
      };
      tx.oncomplete = () => resolve({ project, assets });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    const { project, assets } = records;
    for (const ref of project?.references ?? []) {
      const asset = assets.get(ref.assetId);
      delete ref.assetId;
      if (ref.kind === 'stl') {
        const buffer = await asset.data.arrayBuffer();
        ref.positions = Array.from(
          asset.encoding === 'f32' ? new Float32Array(buffer) : new Float64Array(buffer),
        );
      } else {
        ref.dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(asset.data);
        });
      }
    }
    return project;
  });
}
