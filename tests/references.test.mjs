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
  assert.deepEqual(Array.from(asset.positions), vertices);
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
import { referenceObjects, disposeReferenceObjects } from '../src/referenceObjects.ts';
import { Group, Mesh, Plane, Raycaster, Texture, TorusKnotGeometry } from 'three';

test('reference edits reuse mesh buffers and picking index; deletion releases resources', () => {
  const group = new Group();
  const textures = new Map();
  const positions = new Float32Array([-5, -5, 0, 5, -5, 0, 0, 5, 0]);
  let asset = { id: 'ref', name: 'STL', kind: 'stl', visible: true, opacity: 0.6, positions };
  const update = (assets = [asset], clips = [], edges = false, dark = false) =>
    referenceObjects(group, assets, [], clips, () => {}, textures, edges, dark);
  update();
  const mesh = group.children[0],
    geometry = mesh.geometry,
    index = geometry.boundsTree;
  assert.equal(geometry.attributes.position.array, positions, 'reuse the immutable imported buffer');
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  const clip = new Plane(new Vector3(0, 0, 1), 1);
  for (let i = 0; i < 20; i++) {
    asset = {
      ...asset,
      opacity: i / 20,
      transform: { axes: [2, 1, 0], rotation: [0, 45, 0], translation: [i, 0, 0] },
    };
    update([asset], [clip], true, true);
    assert.equal(group.children[0], mesh);
    assert.equal(mesh.geometry, geometry);
    assert.equal(geometry.boundsTree, index);
  }
  const edgeGeometry = mesh.children[0].geometry;
  update([{ ...asset, visible: false }]);
  assert.equal(group.children.length, 0, 'hidden references are excluded from picking and fit');
  update();
  assert.equal(group.children[0], mesh);
  update([asset], [], true);
  assert.equal(mesh.children[0].geometry, edgeGeometry);
  assert.equal(disposed, 0);
  update([]);
  assert.equal(disposed, 1);
  assert.equal(geometry.boundsTree, undefined);
  update();
  assert.notEqual(group.children[0], mesh, 'undo recreates a released reference safely');
  disposeReferenceObjects(group);
  assert.equal(group.children.length, 0);
});

test('accelerated reference picking preserves transformed and sectioned surface hits', () => {
  const group = new Group();
  const source = new TorusKnotGeometry(30, 8, 200, 24).toNonIndexed();
  const asset = {
    id: 'ref',
    name: 'STL',
    kind: 'stl',
    visible: true,
    opacity: 0.6,
    positions: source.attributes.position.array,
    transform: { axes: [2, 1, 0], rotation: [17, 35, 9], translation: [5, 10, 3] },
  };
  const original = asset.positions.slice();
  for (const clips of [[], [new Plane(new Vector3(0, 0, -1), 0)]]) {
    referenceObjects(group, [asset], [], clips, () => {}, new Map(), false, false);
    group.updateMatrixWorld(true);
    const mesh = group.children[0];
    for (let x = -40; x <= 40; x += 8) {
      const ray = new Raycaster(new Vector3(x, 10, 100), new Vector3(0, 0, -1));
      const ordinary = [];
      Mesh.prototype.raycast.call(mesh, ray, ordinary);
      ordinary.sort((a, b) => a.distance - b.distance);
      const accelerated = ray.intersectObject(mesh, false);
      assert.equal(ray.firstHitOnly, undefined, 'reference picking must not change other object picking');
      const visible = (hit) => clips.every((clip) => clip.distanceToPoint(hit.point) >= 0);
      const expected = ordinary.find(visible),
        actual = accelerated.find(visible);
      assert.equal(!!actual, !!expected);
      if (actual) assert.ok(actual.point.distanceTo(expected.point) < 1e-5);
      if (clips.length)
        assert.equal(accelerated.length, ordinary.length, 'retain rear hits behind section clips');
    }
  }
  assert.deepEqual(asset.positions, original, 'acceleration never changes stored or exported vertices');
  disposeReferenceObjects(group);
  source.dispose();
});

test('reference image sizing reuses its texture and geometry while updating placement', () => {
  const group = new Group(),
    texture = new Texture();
  const textures = new Map([['data:image/png;base64,test', texture]]);
  const planes = [{ id: 'front', frame: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }];
  let asset = {
    id: 'image',
    name: 'Image',
    kind: 'image',
    visible: true,
    opacity: 0.6,
    dataUrl: 'data:image/png;base64,test',
    planeId: 'front',
    width: 10,
    height: 20,
    centerU: 0,
    centerV: 0,
  };
  referenceObjects(group, [asset], planes, [], () => {}, textures, false, false);
  const mesh = group.children[0],
    geometry = mesh.geometry;
  asset = { ...asset, width: 40, height: 60, centerU: 5, centerV: 8 };
  referenceObjects(group, [asset], planes, [], () => {}, textures, false, false);
  assert.equal(group.children[0], mesh);
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material.map, texture);
  assert.deepEqual(new Vector3(0.5, 0.5, 0).applyMatrix4(mesh.matrix).toArray(), [25, 38, 0]);
  disposeReferenceObjects(group);
  texture.dispose();
});

test('metadata edits reuse validated payloads but changed payloads and external documents are fully checked', () => {
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  const reference = validateReference(
    { id: 'ref', name: 'STL', kind: 'stl', visible: true, opacity: 0.6, positions },
    new Set(),
  );
  const previous = validateDocument({ ...newDocument(), references: [reference] });
  let scans = 0;
  const every = positions.every;
  positions.every = function (...args) {
    scans++;
    return every.apply(this, args);
  };
  const edited = {
    ...reference,
    opacity: 0.4,
    transform: { axes: [0, 1, 2], rotation: [1, 2, 3], translation: [4, 5, 6] },
  };
  validateReference(edited, new Set(), reference);
  validateDocument({ ...previous, references: [edited] }, previous);
  assert.equal(scans, 0, 'metadata-only edits must not revisit millions of coordinates');
  validateDocument({ ...previous, references: [edited] });
  assert.equal(scans, 1, 'external documents always validate coordinates');
  const invalid = { ...edited, positions: new Float32Array([NaN, 0, 0, 10, 0, 0, 0, 10, 0]) };
  assert.throws(() => validateReference(invalid, new Set(), reference), /Invalid reference/);
  assert.throws(
    () => validateDocument({ ...previous, references: [invalid] }, previous),
    /Invalid reference/,
  );
  assert.throws(
    () => validateReference({ ...edited, opacity: 2 }, new Set(), reference),
    /Invalid reference/,
  );
  assert.throws(
    () =>
      validateReference(
        { ...edited, transform: { ...edited.transform, rotation: [NaN, 0, 0] } },
        new Set(),
        reference,
      ),
    /Invalid reference transform/,
  );
});
