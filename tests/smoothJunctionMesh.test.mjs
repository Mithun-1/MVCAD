import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothJunctionMesh } from '../src/smoothJunctionMesh.ts';

test('junction fairing removes geometric ripples, limits movement, and leaves distant walls fixed', () => {
  const positions = [],
    triangles = [],
    sources = [];
  const rings = 25,
    sides = 64;
  for (let y = 0; y < rings; y++)
    for (let j = 0; j < sides; j++) {
      const radius =
        3 + (y >= 10 && y <= 14 ? 0.08 * Math.cos((j * Math.PI) / 2) * Math.cos((y * Math.PI) / 2) : 0);
      const angle = (j * 2 * Math.PI) / sides;
      positions.push(radius * Math.cos(angle), y * 0.3, radius * Math.sin(angle));
    }
  for (let y = 0; y < rings - 1; y++)
    for (let j = 0; j < sides; j++) {
      const a = y * sides + j,
        b = y * sides + ((j + 1) % sides),
        c = a + sides,
        d = b + sides;
      triangles.push(a, c, b, b, c, d);
      sources.push(y >= 9 && y <= 14 ? 1 : 0, y >= 9 && y <= 14 ? 1 : 0);
    }
  const original = positions.slice();
  const ripple = (p) => {
    let sum = 0;
    for (let y = 10; y <= 14; y++)
      for (let j = 0; j < sides; j++) {
        const r = (k) => {
          const i = (y * sides + ((k + sides) % sides)) * 3;
          return Math.hypot(p[i], p[i + 2]);
        };
        sum += (r(j - 1) - 2 * r(j) + r(j + 1)) ** 2;
      }
    return sum;
  };
  const changed = smoothJunctionMesh(
    positions,
    Uint32Array.from(triangles),
    Uint32Array.from(sources),
    1,
    0.3,
  );
  assert.ok(ripple(positions) < ripple(original) * 0.3, 'actual vertex ripples fall by at least 70%');
  let maxMove = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const distance = Math.hypot(...[0, 1, 2].map((c) => positions[i + c] - original[i + c]));
    maxMove = Math.max(maxMove, distance);
    if (!changed.has(i / 3)) assert.equal(distance, 0);
  }
  assert.ok(maxMove > 0.01 && maxMove <= 0.225 + 1e-10);
  assert.deepEqual(positions.slice(0, sides * 6), original.slice(0, sides * 6));
  assert.deepEqual(positions.slice(-sides * 6), original.slice(-sides * 6));
  const sharp = original.slice();
  smoothJunctionMesh(sharp, Uint32Array.from(triangles), new Uint32Array(sources.length), 1, 0.3);
  assert.deepEqual(sharp, original, 'zero-rounding geometry is untouched');
});
