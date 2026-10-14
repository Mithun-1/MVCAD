import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument, newDocument, descendants, nextPlaneName } from '../src/model.ts';

test('default names migrate from older documents and remain unique across all planes', () => {
  const doc = newDocument();
  const { baseNames, ...legacy } = doc;
  assert.deepEqual(validateDocument(legacy), doc);
  const renamed = {
    ...doc,
    baseNames: { ...baseNames, top: 'Plane 1' },
    planes: [{ id: 'p1', name: 'Offset', parentId: 'top', offset: 25, visible: true }],
  };
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(renamed))), renamed);
  assert.equal(nextPlaneName(renamed), 'Plane 2');
  for (const name of ['', '  ', 'Origin', 'Front Plane', ' offset ', 'x'.repeat(61), 3]) {
    assert.throws(() => validateDocument({ ...renamed, baseNames: { ...baseNames, top: name } }));
  }
  for (const invalid of [null, [], {}, 'invalid']) {
    assert.throws(() => validateDocument({ ...doc, baseNames: invalid }));
  }
});

test('document validation rejects broken graphs, reserved IDs, non-finite offsets, and duplicate names', () => {
  const p = { id: 'p1', name: 'Plane 1', parentId: 'top', offset: 12.5, visible: true };
  const doc = {
    ...newDocument(),
    planes: [p, { ...p, id: 'p2', name: 'Plane 2', parentId: 'p1', offset: -4 }],
  };
  assert.deepEqual(validateDocument(doc), doc);
  assert.deepEqual([...descendants(doc, 'top')], ['p1', 'p2']);
  for (const patch of [
    { parentId: 'p1' },
    { parentId: 'missing' },
    { id: 'origin' },
    { id: '__preview__' },
    { name: 'Front Plane' },
    { offset: Infinity },
    { offset: '25' },
    { offset: 1000001 },
    { visible: 'yes' },
  ]) {
    assert.throws(() => validateDocument({ ...newDocument(), planes: [{ ...p, ...patch }] }));
  }
  assert.throws(() => validateDocument({ ...doc, planes: [...doc.planes, p] }));
  assert.throws(() => validateDocument({ ...doc, planes: [...doc.planes].reverse() }));
  assert.throws(() => validateDocument({ ...newDocument(), version: 2 }));
});
