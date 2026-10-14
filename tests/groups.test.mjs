import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDocument, validateDocument, nextPlaneName } from '../src/model.ts';
import { groupFeatures, groupDisplayDocument, pruneGroups, ungroupFeatures } from '../src/featureGroups.ts';

function fixture() {
  const doc = newDocument();
  doc.planes = [
    { id: 'p1', name: 'Offset A', parentId: 'front', offset: 10, visible: true },
    { id: 'p2', name: 'Offset B', parentId: 'p1', offset: 20, visible: false },
  ];
  doc.pointSets = [
    {
      id: 'set',
      name: 'Points',
      visible: true,
      sourceFiles: [],
      points: [
        { id: 'a', name: 'A', x: 0, y: 0, z: 0 },
        { id: 'b', name: 'B', x: 0, y: 30, z: 0 },
      ],
    },
  ];
  doc.curves = [
    {
      id: 'curve',
      name: 'Vessel',
      visible: true,
      nodes: ['a', 'b'].map((id) => ({
        id,
        point: { setId: 'set', pointId: id },
        connection: 'line',
        diameter: 8,
      })),
    },
  ];
  return doc;
}
test('groups roundtrip mixed features and preserve individual visibility and geometry references', () => {
  const original = fixture();
  const doc = validateDocument(groupFeatures(original, ['p1', 'p2', 'set', 'curve'], 'g', 'Vessels'));
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  const hidden = { ...doc, groups: doc.groups.map((g) => ({ ...g, visible: false })) };
  const display = groupDisplayDocument(hidden);
  assert.ok([...display.planes, ...display.pointSets, ...display.curves].every((p) => !p.visible));
  assert.equal(hidden.planes[0].visible, true);
  assert.equal(hidden.planes[1].visible, false);
  assert.equal(display.curves[0].nodes, doc.curves[0].nodes);
  assert.equal(display.planes[1].parentId, 'p1');
  assert.deepEqual(groupDisplayDocument(doc).planes, original.planes);
  assert.deepEqual(validateDocument(ungroupFeatures(doc, 'g')), original);
  const ungrouped = validateDocument(ungroupFeatures(hidden, 'g'));
  assert.equal(ungrouped.groups, undefined);
  assert.ok([...ungrouped.planes, ...ungrouped.pointSets, ...ungrouped.curves].every((p) => !p.visible));
});
test('group membership stays unique during regrouping and feature deletion', () => {
  let doc = groupFeatures(fixture(), ['p1', 'set'], 'g', 'Group 1');
  doc = groupFeatures(doc, ['set', 'curve'], 'g2', 'Group 2');
  assert.deepEqual(doc.groups[0].members, ['p1']);
  assert.deepEqual(doc.groups[1].members, ['set', 'curve']);
  doc = validateDocument(pruneGroups({ ...doc, planes: [] }));
  assert.equal(doc.groups.length, 1);
  assert.equal(doc.groups[0].id, 'g2');
  assert.deepEqual(groupFeatures(doc, ['front', 'origin'], 'bad', 'Bad'), doc);
});
test('group validation rejects broken references, duplicate membership, folders as members and name collisions', () => {
  const doc = groupFeatures(fixture(), ['p1', 'p2'], 'g', 'Group 1');
  for (const patch of [
    { members: ['missing'] },
    { members: ['origin'] },
    { members: ['g'] },
    { members: ['p1', 'p1'] },
    { members: [] },
    { id: 'p1' },
    { name: 'Points' },
    { visible: 0 },
  ])
    assert.throws(() => validateDocument({ ...doc, groups: [{ ...doc.groups[0], ...patch }] }));
  assert.throws(() =>
    validateDocument({
      ...doc,
      groups: [...doc.groups, { id: 'g2', name: 'Group 2', visible: true, members: ['p2'] }],
    }),
  );
  assert.throws(() => validateDocument({ ...doc, groups: null }));
  assert.equal(nextPlaneName({ ...doc, groups: [{ ...doc.groups[0], name: 'Plane 1' }] }), 'Plane 2');
});
