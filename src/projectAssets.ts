import { validateDocument, type Document } from './model.ts';
import type { ReferenceAsset } from './references.ts';

export type AssetData = { id: string; encoding: 'f32' | 'f64' | 'image'; data: Blob };
type StoredReference = Omit<ReferenceAsset, 'positions' | 'dataUrl'> & { assetId: string };
export type StoredProject = Omit<Document, 'references'> & { references?: StoredReference[] };
const geometryCache = new WeakMap<object, AssetData>();
const imageCache = new Map<string, AssetData>();

export async function packProject(doc: Document): Promise<{ project: StoredProject; assets: AssetData[] }> {
  const assets: AssetData[] = [];
  const references: StoredReference[] = [];
  const currentImages = new Set(doc.references?.flatMap((a) => (a.kind === 'image' ? [a.dataUrl] : [])));
  for (const key of imageCache.keys()) if (!currentImages.has(key)) imageCache.delete(key);
  for (const reference of doc.references ?? []) {
    if (reference.kind === 'stl') {
      const { positions, ...metadata } = reference;
      let asset = geometryCache.get(positions);
      if (!asset) {
        const values = Array.isArray(positions) ? new Float64Array(positions) : positions;
        asset = {
          id: crypto.randomUUID(),
          encoding: values instanceof Float32Array ? 'f32' : 'f64',
          data: new Blob([values as Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer>]),
        };
        geometryCache.set(positions, asset);
      }
      assets.push(asset);
      references.push({ ...metadata, assetId: asset.id });
    } else {
      const { dataUrl, ...metadata } = reference;
      let asset = imageCache.get(dataUrl);
      if (!asset) {
        asset = { id: crypto.randomUUID(), encoding: 'image', data: await (await fetch(dataUrl)).blob() };
        imageCache.set(dataUrl, asset);
      }
      assets.push(asset);
      references.push({ ...metadata, assetId: asset.id });
    }
  }
  return {
    project: { ...doc, ...(doc.references ? { references } : {}) } as StoredProject,
    assets: [...new Map(assets.map((asset) => [asset.id, asset])).values()],
  };
}

export async function unpackProject(
  project: StoredProject,
  assets: Map<string, AssetData>,
): Promise<Document> {
  const references: ReferenceAsset[] = [];
  for (const reference of project.references ?? []) {
    const asset = assets.get(reference.assetId);
    if (!asset || !(asset.data instanceof Blob)) throw new Error('A saved reference asset is missing.');
    const { assetId: _, ...metadata } = reference;
    if (reference.kind === 'stl' && (asset.encoding === 'f32' || asset.encoding === 'f64')) {
      // Bound allocations before reading an untrusted project asset.
      if (asset.data.size > 1.6 * 1024 ** 3 || asset.data.size % (asset.encoding === 'f32' ? 4 : 8))
        throw new Error('Invalid reference geometry size.');
      const buffer = await asset.data.arrayBuffer();
      const positions = asset.encoding === 'f32' ? new Float32Array(buffer) : new Float64Array(buffer);
      geometryCache.set(positions, asset);
      references.push({ ...metadata, kind: 'stl', positions });
    } else if (reference.kind === 'image' && asset.encoding === 'image') {
      if (asset.data.size > 1024 ** 3) throw new Error('Invalid reference image size.');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not restore the reference image.'));
        reader.readAsDataURL(asset.data);
      });
      references.push({ ...metadata, kind: 'image', dataUrl } as ReferenceAsset);
      imageCache.set(dataUrl, asset);
    } else throw new Error('Invalid reference asset type.');
  }
  return validateDocument({ ...project, ...(project.references ? { references } : {}) });
}
