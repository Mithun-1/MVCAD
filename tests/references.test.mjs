import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REFERENCE_BYTES, readReference, validateReference } from '../src/references.ts';
import { newDocument, validateDocument, descendants } from '../src/model.ts';
import { Vector3 } from 'three';
import { referenceTransformMatrix } from '../src/referenceTransform.ts';

test('reference transforms swap imported axes, rotate in world XYZ order, and translate without changing vertices', () => {
  const transform = { axes: [2, 1, 0], rotation: [90, 0, 90], translation: [10, 20, 30] };
  // (1,2,3) -> (3,2,1) -> (3,-1,2) -> (1,3,2) -> (11,23,32).
  const matrix = referenceTransformMatrix(transform);
  const actual = new Vector3(1, 2, 3).applyMatrix4(matrix).toArray();
  actual.forEach((v, i) => assert.ok(Math.abs(v - [11, 23, 32][i]) < 1e-10));
  assert.ok(Math.abs(matrix.determinant() + 1) < 1e-10);
  assert.deepEqual(new Vector3(1, 2, 3).applyMatrix4(referenceTransformMatrix()).toArray(), [1, 2, 3]);
  const asset = {
    id: 'stl',
    name: 'STL',
    kind: 'stl',
    visible: true,
    opacity: 0.6,
    positions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    transform,
  };
  const doc = newDocument();
  doc.references = [asset];
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))).references, [asset]);
  assert.equal(validateReference(asset, new Set()).positions, asset.positions);
  for (const change of [
    null,
    {},
    { ...transform, axes: [0, 0, 2] },
    { ...transform, axes: [0, 1, 3] },
    { ...transform, rotation: [0, NaN, 0] },
    { ...transform, translation: [Infinity, 0, 0] },
    { ...transform, translation: [0, 0] },
  ])
    assert.throws(
      () => validateReference({ ...asset, transform: change }, new Set()),
      /Invalid reference transform/,
    );
});

test('reference size guard accepts 1 GB and rejects larger files before reading', async () => {
  assert.equal(MAX_REFERENCE_BYTES, 1073741824);
  // Check the boundary without allocating a gigabyte in the test process.
  await assert.rejects(
    readReference({ size: MAX_REFERENCE_BYTES, name: 'unsupported.txt' }, 'Reference', 'front'),
    /Choose an STL/,
  );
  await assert.rejects(
    readReference({ size: MAX_REFERENCE_BYTES + 1, name: 'large.stl' }, 'Reference', 'front'),
    /1 GB or smaller/,
  );
});

test('STL above the old 10 MB and triangle limits imports and survives document validation', async () => {
  const triangles = 210000;
  const bytes = new ArrayBuffer(84 + triangles * 50);
  assert.ok(bytes.byteLength > 10 * 1024 * 1024);
  const data = new DataView(bytes);
  data.setUint32(80, triangles, true);
  for (let i = 0; i < triangles; i++) {
    data.setFloat32(84 + i * 50 + 24, 1, true);
    data.setFloat32(84 + i * 50 + 40, 1, true);
  }
  const asset = await readReference(new File([bytes], 'large.stl'), 'Large reference', 'front');
  assert.equal(asset.positions.length, triangles * 9);
  const doc = newDocument();
  doc.references = [asset];
  assert.equal(validateDocument(doc).references[0].positions.length, triangles * 9);
});

test('binary STL imports preserve coordinates and reject nonfinite mesh data', async () => {
  const bytes = new ArrayBuffer(134),
    data = new DataView(bytes);
  data.setUint32(80, 1, true);
  const vertices = [-10, 0, 4, 10, 0, 4, 0, 20, 4];
  vertices.forEach((v, i) => data.setFloat32(96 + i * 4, v, true));
  const asset = await readReference(new File([bytes], 'triangle.stl'), 'Triangle', 'front');
  assert.equal(asset.kind, 'stl');
  assert.deepEqual(asset.positions, vertices);
  data.setFloat32(96, NaN, true);
  await assert.rejects(
    readReference(new File([bytes], 'invalid.stl'), 'Invalid', 'front'),
    /Invalid reference/,
  );
});
test('references roundtrip and image attachment protects the reference plane', () => {
  const doc = newDocument();
  doc.planes.push({ id: 'offset', name: 'Offset', parentId: 'front', offset: 25, visible: true });
  const image = {
    id: 'image',
    name: 'Image',
    visible: true,
    opacity: 0.4,
    kind: 'image',
    dataUrl: 'data:image/png;base64,YQ==',
    planeId: 'offset',
    width: 40,
    height: 20,
    centerU: 10,
    centerV: -20,
  };
  doc.references = [image];
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))).references, [image]);
  assert.ok(descendants(doc, 'front').has('image'));
  assert.ok(descendants(doc, 'offset').has('image'));
  for (const change of [
    { planeId: 'missing' },
    { width: 0 },
    { height: Infinity },
    { opacity: 2 },
    { centerU: NaN },
    { dataUrl: 'https://example.com/image.png' },
    { dataUrl: 'data:image/svg+xml;base64,YQ==' },
  ])
    assert.throws(() => validateReference({ ...image, ...change }, new Set(['offset'])), /Invalid reference/);
  doc.references.push({ ...image, id: 'another' });
  assert.throws(() => validateDocument(doc), /Duplicate reference/);
});
