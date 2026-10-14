import { validateDocument, type Document } from './model.ts';
import type { ReferenceAsset } from './references.ts';

export type AssetData = {
  id: string;
  encoding: 'f32' | 'f64' | 'image';
  data: ArrayBuffer | Blob;
  mimeType?: string;
};
export const assetSize = (asset: AssetData) =>
  asset.data instanceof Blob ? asset.data.size : asset.data.byteLength;
export const assetType = (asset: AssetData) =>
  asset.data instanceof Blob ? asset.data.type : (asset.mimeType ?? '');
type StoredReference = Omit<ReferenceAsset, 'positions' | 'dataUrl'> & { assetId: string };
export type StoredProject = Omit<Document, 'references'> & { references?: StoredReference[] };
const geometryCache = new WeakMap<object, AssetData>();
const imageCache = new Map<string, AssetData>();

// Store buffers: WebKit can reject Blob records in IndexedDB. Blob input remains
// supported when opening compact files or restoring an earlier save.
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
          data:
            values.byteOffset === 0 && values.byteLength === values.buffer.byteLength
              ? (values.buffer as ArrayBuffer)
              : (values.buffer.slice(
                  values.byteOffset,
                  values.byteOffset + values.byteLength,
                ) as ArrayBuffer),
        };
        geometryCache.set(positions, asset);
      }
      assets.push(asset);
      references.push({ ...metadata, assetId: asset.id });
    } else {
      const { dataUrl, ...metadata } = reference;
      let asset = imageCache.get(dataUrl);
      if (!asset) {
        const image = await (await fetch(dataUrl)).blob();
        asset = {
          id: crypto.randomUUID(),
          encoding: 'image',
          data: await image.arrayBuffer(),
          mimeType: image.type,
        };
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
    if (!asset || !(asset.data instanceof Blob || asset.data instanceof ArrayBuffer))
      throw new Error('A saved reference asset is missing.');
    const { assetId: _, ...metadata } = reference;
    if (reference.kind === 'stl' && (asset.encoding === 'f32' || asset.encoding === 'f64')) {
      // Bound allocations before reading an untrusted project asset.
      if (assetSize(asset) > 1.6 * 1024 ** 3 || assetSize(asset) % (asset.encoding === 'f32' ? 4 : 8))
        throw new Error('Invalid reference geometry size.');
      const buffer = asset.data instanceof Blob ? await asset.data.arrayBuffer() : asset.data;
      const positions = asset.encoding === 'f32' ? new Float32Array(buffer) : new Float64Array(buffer);
      geometryCache.set(positions, asset.data === buffer ? asset : { ...asset, data: buffer });
      references.push({ ...metadata, kind: 'stl', positions });
    } else if (reference.kind === 'image' && asset.encoding === 'image') {
      if (assetSize(asset) > 1024 ** 3) throw new Error('Invalid reference image size.');
      const buffer = asset.data instanceof Blob ? await asset.data.arrayBuffer() : asset.data;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not restore the reference image.'));
        reader.readAsDataURL(new Blob([buffer], { type: assetType(asset) }));
      });
      references.push({ ...metadata, kind: 'image', dataUrl } as ReferenceAsset);
      imageCache.set(dataUrl, { ...asset, data: buffer, mimeType: assetType(asset) });
    } else throw new Error('Invalid reference asset type.');
  }
  return validateDocument({ ...project, ...(project.references ? { references } : {}) });
}
