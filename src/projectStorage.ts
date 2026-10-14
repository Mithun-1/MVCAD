import { newDocument, STORAGE_KEY, validateDocument, type Document } from './model.ts';
import { packProject, unpackProject, type AssetData, type StoredProject } from './projectAssets.ts';

export const DATABASE_NAME = 'mvcad-workspace';
export type InitialWorkspace = { doc: Document; warning: string };
let connection: Promise<IDBDatabase> | undefined;
let writes: Promise<unknown> = Promise.resolve();

function database(): Promise<IDBDatabase> {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects');
      request.result.createObjectStore('assets', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other MVCAD tabs to finish opening storage.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = undefined;
      };
      resolve(request.result);
    };
  }).catch((error) => {
    connection = undefined;
    throw error;
  }));
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Project save was interrupted.'));
    tx.onerror = (event) =>
      reject((event.target as IDBRequest)?.error ?? tx.error ?? new Error('Browser storage failed.'));
  });
}
export function saveProject(doc: Document): Promise<void> {
  const operation = writes
    .catch(() => {})
    .then(async () => {
      const { project, assets } = await packProject(doc);
      const db = await database();
      const tx = db.transaction(['projects', 'assets'], 'readwrite');
      const completed = done(tx);
      const store = tx.objectStore('assets');
      const used = new Set(assets.map((asset) => asset.id));
      try {
        for (const asset of assets) {
          const existing = store.getKey(asset.id);
          existing.onsuccess = () => {
            try {
              if (existing.result === undefined) store.put(asset);
            } catch {
              tx.abort();
            }
          };
        }
        // Cleanup and project replacement are atomic: a failed save preserves the last good project.
        const cursor = store.openKeyCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          if (!used.has(String(item.key))) store.delete(item.key);
          item.continue();
        };
        tx.objectStore('projects').put(project, 'current');
      } catch (error) {
        tx.abort();
        await completed.catch(() => {});
        throw error;
      }
      await completed;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* IndexedDB save already succeeded. */
      }
    });
  writes = operation;
  return operation;
}
export async function loadProject(): Promise<InitialWorkspace> {
  try {
    const db = await database();
    const tx = db.transaction(['projects', 'assets'], 'readonly');
    const completed = done(tx);
    let project: StoredProject | undefined;
    const assets = new Map<string, AssetData>();
    const request = tx.objectStore('projects').get('current');
    request.onsuccess = () => {
      project = request.result;
      for (const reference of project?.references ?? []) {
        const asset = tx.objectStore('assets').get(reference.assetId);
        asset.onsuccess = () => {
          if (asset.result) assets.set(reference.assetId, asset.result);
        };
      }
    };
    await completed;
    if (project) return { doc: await unpackProject(project, assets), warning: '' };
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      const doc = validateDocument(JSON.parse(legacy));
      try {
        await saveProject(doc);
        return { doc, warning: '' };
      } catch {
        return {
          doc,
          warning:
            'The previous project was restored, but migration could not be saved. Its old save is preserved. Export a backup and retry saving.',
        };
      }
    }
    return { doc: newDocument(), warning: '' };
  } catch {
    // Never overwrite an unreadable save during startup.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw)
        return {
          doc: validateDocument(JSON.parse(raw)),
          warning:
            'Browser storage is unavailable. The previous save was restored; export a backup before closing.',
        };
    } catch {
      /* Retain the original stored data for recovery. */
    }
    return {
      doc: newDocument(),
      warning:
        'The saved project could not be restored. Existing saved data is preserved until you edit or explicitly retry saving.',
    };
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
