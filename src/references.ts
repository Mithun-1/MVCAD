// File size and embedded-data validation must agree, including on document reload.
export const MAX_REFERENCE_BYTES = 1024 * 1024 * 1024;
const MAX_REFERENCE_COORDINATES = Math.floor((MAX_REFERENCE_BYTES - 84) / 50) * 9;
const MAX_REFERENCE_DATA_URL_LENGTH = 4 * Math.ceil(MAX_REFERENCE_BYTES / 3) + 64;

type Common = { id: string; name: string; visible: boolean; opacity: number };
export type ReferenceAsset = Common &
  (
    | { kind: 'stl'; positions: number[] }
    | {
        kind: 'image';
        dataUrl: string;
        planeId: string;
        width: number;
        height: number;
        centerU: number;
        centerV: number;
      }
  );
export function validateReference(asset: ReferenceAsset, planeIds: Set<string>): ReferenceAsset {
  if (
    !asset ||
    typeof asset.id !== 'string' ||
    !asset.id ||
    asset.id.length > 100 ||
    asset.id.startsWith('__') ||
    typeof asset.name !== 'string' ||
    !asset.name.trim() ||
    asset.name.length > 60 ||
    typeof asset.visible !== 'boolean' ||
    !Number.isFinite(asset.opacity) ||
    asset.opacity < 0 ||
    asset.opacity > 1
  )
    throw new Error('Invalid reference.');
  const common = { id: asset.id, name: asset.name.trim(), visible: asset.visible, opacity: asset.opacity };
  if (
    asset.kind === 'stl' &&
    Array.isArray(asset.positions) &&
    asset.positions.length >= 9 &&
    asset.positions.length <= MAX_REFERENCE_COORDINATES &&
    asset.positions.length % 9 === 0 &&
    asset.positions.every((v) => Number.isFinite(v) && Math.abs(v) <= 1000000)
  )
    return { ...common, kind: 'stl', positions: asset.positions };
  if (
    asset.kind === 'image' &&
    typeof asset.dataUrl === 'string' &&
    asset.dataUrl.length <= MAX_REFERENCE_DATA_URL_LENGTH &&
    /^data:image\/(png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/]+=*$/.test(asset.dataUrl) &&
    planeIds.has(asset.planeId) &&
    [asset.width, asset.height].every((v) => Number.isFinite(v) && v > 0 && v <= 1000000) &&
    [asset.centerU, asset.centerV].every((v) => Number.isFinite(v) && Math.abs(v) <= 1000000)
  )
    return {
      ...common,
      kind: 'image',
      dataUrl: asset.dataUrl,
      planeId: asset.planeId,
      width: asset.width,
      height: asset.height,
      centerU: asset.centerU,
      centerV: asset.centerV,
    };
  throw new Error('Invalid reference geometry, image, or attachment plane.');
}
export async function readReference(file: File, name: string, planeId: string): Promise<ReferenceAsset> {
  const common = { id: crypto.randomUUID(), name, visible: true, opacity: 0.6 };
  if (file.size > MAX_REFERENCE_BYTES) throw new Error('Reference files must be 1 GB or smaller.');
  if (/\.stl$/i.test(file.name)) {
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    try {
      const positions = Array.from(geometry.getAttribute('position')?.array ?? []);
      return validateReference({ ...common, kind: 'stl', positions }, new Set());
    } finally {
      geometry.dispose();
    }
  }
  if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name))
    throw new Error('Choose an STL or a PNG, JPEG, WebP, GIF, or BMP image.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.readAsDataURL(file);
  });
  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
  } catch {
    throw new Error('This image could not be decoded.');
  }
  if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 32000000)
    throw new Error('Images must contain at most 32 million pixels.');
  return validateReference(
    {
      ...common,
      kind: 'image',
      dataUrl,
      planeId,
      width: 100,
      height: (100 * img.naturalHeight) / img.naturalWidth,
      centerU: 0,
      centerV: 0,
    },
    new Set([planeId]),
  );
}
