import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { newDocument, validateDocument } from '../src/model.ts';
import { groupDisplayDocument, pruneGroups, ungroupFeatures } from '../src/featureGroups.ts';
import {
  setBoundingBox,
  boxDimensions,
  boundingPlanePatch,
  measureBoxSpacing,
  sectionPlane,
} from '../src/viewTools.ts';

test('bounding box creates and updates three stable reference planes and exact finite patches', () => {
  const original = newDocument();
  const doc = setBoundingBox(original, [100, 80, 60]);
  assert.equal(original.planes.length, 0);
  assert.deepEqual(
    doc.planes.map((p) => [p.parentId, p.offset]),
    [
      ['right', 100],
      ['top', 80],
      ['front', 60],
    ],
  );
  assert.deepEqual(boxDimensions(doc), [100, 80, 60]);
  assert.deepEqual(doc.baseNames, { right: 'Lx_0', top: 'Ly_0', front: 'Lz_0' });
  assert.equal(doc.groups[0].name, 'Computational Domain');
  assert.deepEqual(doc.groups[0].members, [
    'right',
    doc.planes[0].id,
    'top',
    doc.planes[1].id,
    'front',
    doc.planes[2].id,
  ]);
  assert.deepEqual(pruneGroups(doc), doc);
  const hidden = { ...doc, groups: doc.groups.map((group) => ({ ...group, visible: false })) };
  const display = groupDisplayDocument(hidden);
  assert.ok(display.planes.every((p) => !p.visible));
  assert.deepEqual(display.baseVisibility, { front: false, top: false, right: false });
  assert.deepEqual(ungroupFeatures(hidden, doc.groups[0].id).baseVisibility, display.baseVisibility);
  const next = setBoundingBox(doc, [110, 90, 70]);
  assert.deepEqual(next.boundingBox, doc.boundingBox);
  assert.equal(next.planes.length, 3);
  assert.equal(next.groups.length, 1);
  assert.equal(next.groups[0].id, doc.groups[0].id);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(next))), next);
  assert.deepEqual(boundingPlanePatch(doc, { id: 'top', frame: [0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 1, 0] }), {
    width: 100,
    height: 60,
    centerU: 50,
    centerV: -30,
  });
  assert.deepEqual(
    boundingPlanePatch(doc, { id: doc.planes[0].id, frame: [100, 0, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0] }),
    { width: 60, height: 80, centerU: -30, centerV: 40 },
  );
  assert.throws(() => setBoundingBox(doc, [0, 20, 30]));
  assert.throws(() => setBoundingBox(doc, [10, NaN, 30]));
  assert.throws(() => validateDocument({ ...doc, boundingBox: { planeIds: ['bad', 'top', 'front'] } }));
});
const mesh = (points, origin = [0, 0, 0]) => {
  const positions = new Float32Array(points.flat());
  const indices = Uint32Array.from(points.map((_, i) => i));
  return {
    positions,
    indices,
    origin,
    renderPositions: positions,
    renderIndices: indices,
    bodyRanges: [{ start: 0, count: indices.length }],
  };
};
test('spacing uses finite box faces and actual triangle interiors, including shell and crossing surfaces', () => {
  const inside = measureBoxSpacing(
    mesh([
      [2, 3, 4],
      [2, 6, 4],
      [2, 3, 7],
    ]),
    [10, 10, 10],
  );
  assert.equal(inside.distance, 2);
  assert.equal(inside.face, 'X = 0');
  assert.equal(inside.boxPoint[0], 0);
  const outside = measureBoxSpacing(
    mesh([
      [12, 12, 3],
      [12, 14, 3],
      [12, 12, 7],
    ]),
    [10, 10, 10],
  );
  assert.ok(Math.abs(outside.distance - Math.sqrt(8)) < 1e-10);
  const crossing = measureBoxSpacing(
    mesh([
      [-2, 5, 5],
      [12, 5, 5],
      [5, 12, 5],
    ]),
    [10, 10, 10],
  );
  assert.equal(crossing.distance, 0, 'all vertices can be outside while the face crosses the box');
  const enclosingTriangle = measureBoxSpacing(
    mesh([
      [-100, -100, 5],
      [100, -100, 5],
      [0, 100, 5],
    ]),
    [10, 10, 10],
  );
  assert.equal(enclosingTriangle.distance, 0, 'box edges can pierce the triangle interior');
  assert.equal(
    measureBoxSpacing(
      {
        ...mesh(
          [
            [0, 0, 0],
            [0, 3, 0],
            [0, 0, 3],
          ],
          [2, 3, 4],
        ),
        surfaceShell: true,
      },
      [10, 10, 10],
    ).distance,
    2,
  );
});
test('section view respects the reference plane origin, offset and visible side', () => {
  const geometry = [{ id: 'offset', frame: [0, 0, 10, 1, 0, 0, 0, 1, 0, 0, 0, 1] }];
  const above = sectionPlane({ planeId: 'offset', offset: 5, keepAbove: true }, geometry);
  assert.ok(above.distanceToPoint(new Vector3(0, 0, 20)) > 0);
  assert.ok(above.distanceToPoint(new Vector3(0, 0, 12)) < 0);
  const below = sectionPlane({ planeId: 'offset', offset: 5, keepAbove: false }, geometry);
  assert.ok(below.distanceToPoint(new Vector3(0, 0, 12)) > 0);
  assert.equal(sectionPlane(undefined, geometry), undefined);
});
