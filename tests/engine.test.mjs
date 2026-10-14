import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function kernel() {
  const { instance } = await WebAssembly.instantiate(
    await readFile(new URL('../engine/planes.wasm', import.meta.url)),
    {},
  );
  const api = instance.exports;
  api.reset_model();
  return { api, frame: (id) => Array.from(new Float64Array(api.memory.buffer, api.plane_data(id), 12)) };
}
test('principal planes have orthonormal right-handed frames at the origin', async () => {
  const { api, frame } = await kernel();
  assert.equal(api.kernel_version(), 1);
  assert.equal(api.plane_count(), 3);
  const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
  for (let i = 0; i < 3; i++) {
    const f = frame(i),
      u = f.slice(3, 6),
      v = f.slice(6, 9),
      n = f.slice(9, 12);
    assert.deepEqual(f.slice(0, 3), [0, 0, 0]);
    for (const axis of [u, v, n]) assert.equal(dot(axis, axis), 1);
    assert.equal(dot(u, v), 0);
    assert.equal(dot(u, n), 0);
    assert.equal(dot(v, n), 0);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.deepEqual(
      cross.map((x) => x || 0),
      n,
    );
  }
  assert.deepEqual(frame(0).slice(9), [0, 0, 1]);
  assert.deepEqual(frame(1).slice(9), [0, 1, 0]);
  assert.deepEqual(frame(2).slice(9), [1, 0, 0]);
});
test('signed and chained offsets preserve orientation and double precision', async () => {
  const { api, frame } = await kernel();
  for (let i = 0; i < 3; i++) {
    const first = api.create_offset_plane(i, 25.125);
    const second = api.create_offset_plane(first, -40.25);
    const expected = frame(i)
      .slice(9)
      .map((x) => (x ? x * -15.125 : 0));
    assert.deepEqual(frame(second).slice(0, 3), expected);
    assert.deepEqual(frame(second).slice(3), frame(i).slice(3));
  }
  const zero = api.create_offset_plane(0, 0);
  assert.deepEqual(frame(zero), frame(0));
});
test('invalid operations do not mutate the model', async () => {
  const { api } = await kernel();
  for (const offset of [NaN, Infinity, -Infinity, 1000001, -1000001])
    assert.equal(api.create_offset_plane(0, offset), -2);
  for (const parent of [-1, 3, 10000]) assert.equal(api.create_offset_plane(parent, 1), -1);
  assert.equal(api.plane_count(), 3);
  assert.equal(api.plane_data(-1), 0);
  assert.equal(api.plane_data(3), 0);
});
test('capacity bounds prevent memory overflow and reset removes all custom planes', async () => {
  const { api, frame } = await kernel();
  const max = api.plane_capacity();
  for (let i = 3; i < max; i++) assert.equal(api.create_offset_plane(i - 1, 1), i);
  assert.equal(api.create_offset_plane(0, 1), -3);
  assert.equal(api.plane_count(), max);
  assert.deepEqual(frame(max - 1).slice(0, 3), [max - 3, 0, 0]);
  api.reset_model();
  assert.equal(api.plane_count(), 3);
  assert.equal(api.plane_data(3), 0);
});
