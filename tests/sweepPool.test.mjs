import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { SweepPool } from '../src/sweepPool.ts';
import { buildSweep, buildSweepAsync } from '../src/sweep.ts';
import { newDocument } from '../src/model.ts';
import { removeEndCaps } from '../src/removeCaps.ts';

const createWorker = () => {
  const worker = new Worker(new URL('./sweepChunk.worker.mjs', import.meta.url));
  const adapter = {
    postMessage: (m) => worker.postMessage(m),
    terminate: () => void worker.terminate(),
    onmessage: null,
    onerror: null,
  };
  worker.on('message', (data) => adapter.onmessage?.({ data }));
  worker.on('error', (error) => adapter.onerror?.({ message: error.message }));
  return adapter;
};
function fixture(radiusScale = 1) {
  const doc = newDocument();
  const points = [
    [0, 0, 0],
    [0, 30, 5],
    [0, 60, 0],
    [0, 90, -5],
    [25, 45, 10],
  ].map(([x, y, z], i) => ({ id: String(i), name: String(i), x, y, z }));
  doc.pointSets = [{ id: 'points', name: 'Points', visible: true, points, sourceFiles: [] }];
  const node = (i, diameter) => ({
    id: String(i),
    point: { setId: 'points', pointId: String(i) },
    connection: 'line',
    ...(diameter ? { diameter: diameter * radiusScale } : {}),
  });
  doc.curves = [
    { id: 'main', name: 'Main', visible: true, nodes: [node(0), node(1, 8), node(2, 6), node(3, 9)] },
    { id: 'branch', name: 'Branch', visible: true, nodes: [node(1), node(4, 7), node(2, 7)] },
  ];
  const geometry = doc.curves.map((c) => ({
    id: c.id,
    nodeOffsets: c.nodes.map((_, i) => i),
    positions: new Float64Array(
      c.nodes.flatMap((n) => {
        const p = points[Number(n.point.pointId)];
        return [p.x, p.y, p.z];
      }),
    ),
  }));
  return [doc, geometry];
}
function validate(mesh) {
  const edges = new Map();
  let volume = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = Array.from(mesh.indices.subarray(i, i + 3));
    for (let j = 0; j < 3; j++) {
      const a = ids[j],
        b = ids[(j + 1) % 3],
        key = `${Math.min(a, b)},${Math.max(a, b)}`;
      const edge = edges.get(key) || [0, 0];
      edge[0]++;
      edge[1] += a < b ? 1 : -1;
      edges.set(key, edge);
    }
    const [a, b, c] = ids.map((v) => mesh.positions.subarray(v * 3, v * 3 + 3));
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        assert.equal(mesh.positions[ids[j] * 3 + k], mesh.renderPositions[mesh.renderIndices[i + j] * 3 + k]);
  }
  assert.ok([...edges.values()].every(([count, orientation]) => count === 2 && orientation === 0));
  assert.ok(volume > 0);
  assert.ok(mesh.normals.every(Number.isFinite));
  const shell = removeEndCaps(mesh);
  assert.equal(shell.positions, mesh.positions);
  assert.ok(shell.indices.length < mesh.indices.length);
  assert.ok(shell.endCapTriangles.every((v) => v === 0));
  return volume;
}
test('parallel sweep stitches closed bodies, preserves serial volume and isolates concurrent inputs', async () => {
  const module = await WebAssembly.compile(await readFile('engine/sweep.wasm'));
  const api = (await WebAssembly.instantiate(module, {})).exports;
  const pool = new SweepPool(module, createWorker, 4);
  try {
    const a = fixture(),
      b = fixture(1.2);
    const serial = buildSweep(api, ...a),
      serialVolume = validate(serial);
    const [first, second] = await Promise.all(
      [a, b].map((args) => buildSweepAsync(api, ...args, (api, count) => pool.generate(api, count))),
    );
    assert.equal(first.bodies, serial.bodies);
    assert.equal(first.indices.length, serial.indices.length);
    assert.ok(Math.abs(validate(first) - serialVolume) / serialVolume < 1e-5);
    assert.ok(validate(second) > serialVolume * 1.2);
    const third = await buildSweepAsync(api, ...a, (api, count) => pool.generate(api, count));
    assert.deepEqual(third.positions, first.positions);
  } finally {
    pool.dispose();
  }
});

test('worker failure rejects active and queued jobs and disposal rejects future work', async () => {
  const worker = { postMessage() {}, terminate() {}, onmessage: null, onerror: null };
  const memory = new WebAssembly.Memory({ initial: 1 });
  new Float64Array(memory.buffer, 0, 8).set([0, 0, 0, 1, 2, 2, 8, 0]);
  const api = { memory, sweep_settings: () => 0, sweep_segments: () => 64, sweep_roundings: () => 144 };
  const pool = new SweepPool({}, () => worker, 1);
  const first = pool.generate(api, 1),
    second = pool.generate(api, 1);
  const rejected = Promise.all([
    assert.rejects(first, /worker failed/),
    assert.rejects(second, /worker failed/),
  ]);
  worker.onerror({ message: 'worker failed' });
  await rejected;
  await assert.rejects(pool.generate(api, 1), /worker failed/);
  pool.dispose();
});
