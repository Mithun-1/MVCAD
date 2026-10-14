import { validateDocument, type Document } from './model.ts';
import { packProject, unpackProject, type AssetData, type StoredProject } from './projectAssets.ts';

const MAGIC = 'MVCAD2\r\n';
const MAX_METADATA = 50_000_000;
export async function exportProjectFile(doc: Document): Promise<Blob> {
  if (!doc.references?.length) return new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const { project, assets } = await packProject(doc);
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      project,
      assets: assets.map(({ id, encoding, data }) => ({
        id,
        encoding,
        size: data.size,
        type: data.type,
      })),
    }),
  );
  if (metadata.byteLength > MAX_METADATA) throw new Error('Project metadata exceeds 50 MB.');
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(8, metadata.byteLength, true);
  return new Blob([header, metadata, ...assets.map((asset) => asset.data)], {
    type: 'application/octet-stream',
  });
}
export async function importProjectFile(file: Blob): Promise<Document> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(header.subarray(0, 8)) !== MAGIC) {
    if (file.size > MAX_METADATA)
      throw new Error(
        'Legacy JSON projects must be 50 MB or smaller. Use the compact MVCAD format for large references.',
      );
    return validateDocument(JSON.parse(await file.text()));
  }
  if (header.byteLength !== 12) throw new Error('Incomplete MVCAD file.');
  const length = new DataView(header.buffer).getUint32(8, true);
  if (!length || length > MAX_METADATA || 12 + length > file.size)
    throw new Error('Invalid MVCAD file header.');
  const { project, assets: descriptors } = JSON.parse(await file.slice(12, 12 + length).text()) as {
    project: StoredProject;
    assets: { id: string; encoding: AssetData['encoding']; size: number; type: string }[];
  };
  if (!project || !Array.isArray(descriptors) || descriptors.length > 10000)
    throw new Error('Invalid MVCAD project.');
  const assets = new Map<string, AssetData>();
  let offset = 12 + length;
  for (const item of descriptors) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      assets.has(item.id) ||
      !['f32', 'f64', 'image'].includes(item.encoding) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      item.size > 1.6 * 1024 ** 3 ||
      offset + item.size > file.size ||
      typeof item.type !== 'string'
    )
      throw new Error('Invalid or incomplete MVCAD reference asset.');
    assets.set(item.id, {
      id: item.id,
      encoding: item.encoding,
      data: file.slice(offset, offset + item.size, item.type),
    });
    offset += item.size;
  }
  if (offset !== file.size) throw new Error('Unexpected data after MVCAD assets.');
  return unpackProject(project, assets);
}
