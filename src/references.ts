// File size and embedded-data validation must agree, including on document reload.
export const MAX_REFERENCE_BYTES = 1024 * 1024 * 1024;
const MAX_REFERENCE_COORDINATES = Math.floor((MAX_REFERENCE_BYTES - 84) / 50) * 9;
const MAX_REFERENCE_DATA_URL_LENGTH = 4 * Math.ceil(MAX_REFERENCE_BYTES / 3) + 64;

type Common = { id: string; name: string; visible: boolean; opacity: number };
export type ReferenceTransform = {
  axes: [number, number, number];
  rotation: [number, number, number];
  translation: [number, number, number];
};
export const identityReferenceTransform = (): ReferenceTransform => ({
  axes: [0, 1, 2],
  rotation: [0, 0, 0],
  translation: [0, 0, 0],
});
export function validReferenceTransform(t: ReferenceTransform): boolean {
  return (
    !!t &&
    Array.isArray(t.axes) &&
    t.axes.length === 3 &&
    new Set(t.axes).size === 3 &&
    t.axes.every((v) => Number.isInteger(v) && v >= 0 && v <= 2) &&
    [t.rotation, t.translation].every(
      (values) =>
        Array.isArray(values) &&
        values.length === 3 &&
        values.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000000),
    )
  );
}
export type ReferenceAsset = Common &
  (
    | { kind: 'stl'; positions: number[] | Float32Array | Float64Array; transform?: ReferenceTransform }
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
    (Array.isArray(asset.positions) ||
      asset.positions instanceof Float32Array ||
      asset.positions instanceof Float64Array) &&
    asset.positions.length >= 9 &&
    asset.positions.length <= MAX_REFERENCE_COORDINATES &&
    asset.positions.length % 9 === 0 &&
    asset.positions.every((v) => Number.isFinite(v) && Math.abs(v) <= 1000000)
  ) {
    if (asset.transform !== undefined && !validReferenceTransform(asset.transform))
      throw new Error(
        'Invalid reference transform. Enter finite rotations and translations within ±1,000,000.',
      );
    return {
      ...common,
      kind: 'stl',
      positions: asset.positions,
      ...(asset.transform
        ? {
            transform: {
              axes: [...asset.transform.axes],
              rotation: [...asset.transform.rotation],
              translation: [...asset.transform.translation],
            },
          }
        : {}),
    };
  }
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
      const positions = geometry.getAttribute('position')?.array as Float32Array;
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
