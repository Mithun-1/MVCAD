import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { pointContentBounds, planeDisplayBounds } from '../src/displayBounds.ts';

const front = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

test('plane display covers combined point ranges without forcing symmetry around the origin', () => {
  const bounds = pointContentBounds([
    new Float64Array([1000, -300, 50, 1400, -100, 80]),
    new Float64Array([900, -500, -20]),
  ]);
  const patch = planeDisplayBounds(front, bounds);
  assert.equal(patch.centerU, 1150);
  assert.equal(patch.centerV, -300);
  assert.ok(patch.width > 500 && patch.width < 600);
  assert.ok(patch.height > 400 && patch.height < 480);
  const offset = [...front];
  offset[2] = 125;
  assert.deepEqual(planeDisplayBounds(offset, bounds), patch);
  assert.equal(offset[2], 125);
});

test('small, empty, single-point and collinear bounds produce usable finite patches', () => {
  assert.deepEqual(planeDisplayBounds(front, new Box3()), {
    width: 140,
    height: 140,
    centerU: 0,
    centerV: 0,
  });
  for (const positions of [
    [0, 0, 0, 0.01, 0.02, 0],
    [8000, 2, -4],
    [-10, 0, 0, 10, 0, 0],
  ]) {
    const patch = planeDisplayBounds(front, pointContentBounds([positions]));
    assert.ok(patch.width > 0 && patch.height > 0);
    assert.ok(patch.width < 140 && patch.height < 140);
    assert.ok(Object.values(patch).every(Number.isFinite));
  }
});

test('arbitrarily oriented planes enclose projected model bounds and preserve their frames', () => {
  const u = new Vector3(1, 1, 0).normalize();
  const n = new Vector3(1, -1, 2).normalize();
  const v = n.clone().cross(u);
  const origin = new Vector3(25, -80, 100);
  const frame = [...origin, ...u, ...v, ...n];
  const original = [...frame];
  // A future solid can supply the same world-space bounding box directly.
  const bounds = new Box3(new Vector3(-800, -30, -100), new Vector3(2500, 900, 700));
  const patch = planeDisplayBounds(frame, bounds);
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new Vector3(x, y, z).sub(origin);
        assert.ok(Math.abs(point.dot(u) - patch.centerU) < patch.width / 2);
        assert.ok(Math.abs(point.dot(v) - patch.centerV) < patch.height / 2);
      }
  assert.deepEqual(frame, original);
});
