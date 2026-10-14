import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(process.env.BENCH_ROOT || '.');
const { buildSweep, buildSweepAsync } = await import(pathToFileURL(resolve(root, 'src/sweep.ts')));
const { removeEndCaps } = await import(pathToFileURL(resolve(root, 'src/removeCaps.ts')));
const { newDocument } = await import(pathToFileURL(resolve(root, 'src/model.ts')));
const load = async (name) =>
  (await WebAssembly.instantiate(await readFile(resolve(root, `engine/${name}.wasm`)), {})).instance.exports;
const api = await load('sweep'),
  curves = await load('planes');

let pool;
if (process.env.BENCH_PARALLEL) {
  const { Worker } = await import('node:worker_threads');
  const { SweepPool } = await import('../src/sweepPool.ts');
  const module = await WebAssembly.compile(await readFile(resolve(root, 'engine/sweep.wasm')));
  pool = new SweepPool(
    module,
    () => {
      const worker = new Worker(new URL('../tests/sweepChunk.worker.mjs', import.meta.url));
      const adapter = {
        postMessage: (m) => worker.postMessage(m),
        terminate: () => {
          void worker.terminate();
        },
        onmessage: null,
        onerror: null,
      };
      worker.on('message', (data) => adapter.onmessage?.({ data }));
      worker.on('error', (error) => adapter.onerror?.({ message: error.message }));
      return adapter;
    },
    Number(process.env.BENCH_PARALLEL),
  );
}
function fixture(branches) {
  const doc = newDocument();
  doc.autoSweep = true;
  const points = [],
    features = [];
  const point = (id, x, y, z = 0) => {
    points.push({ id, name: id, x, y, z });
    return id;
  };
  const node = (id, diameter) => ({
    id,
    point: { setId: 'points', pointId: id },
    connection: 'spline',
    ...(diameter ? { diameter } : {}),
  });
  if (!branches) {
    features.push({
      id: 'main',
      name: 'Cylinder',
      visible: true,
      nodes: [node(point('a', 0, 0)), node(point('b', 0, 50), 8)],
    });
  } else {
    const trunk = [node(point('p0', 0, 0))];
    for (let i = 0; i <= branches; i++) trunk.push(node(point(`p${i + 1}`, 0, (i + 1) * 50), i % 2 ? 6 : 8));
    features.push({ id: 'main', name: 'Main', visible: true, nodes: trunk });
    for (let i = 0; i < branches; i++) {
      const id = point(`b${i}`, i % 2 ? -40 : 40, (i + 1.5) * 50, ((i % 3) - 1) * 8);
      features.push({
        id: `branch${i}`,
        name: `Branch ${i}`,
        visible: true,
        nodes: [node(`p${i + 1}`), node(id, 7), node(`p${i + 2}`, 7)],
      });
    }
  }
  doc.pointSets = [{ id: 'points', name: 'Points', visible: true, sourceFiles: [], points }];
  doc.curves = features;
  return doc;
}
function evaluate(doc) {
  const lookup = new Map(doc.pointSets[0].points.map((p) => [p.id, p]));
  return doc.curves.map((c) => {
    new Float64Array(curves.memory.buffer, curves.point_buffer(), c.nodes.length * 3).set(
      c.nodes.flatMap((n) => {
        const p = lookup.get(n.point.pointId);
        return [p.x, p.y, p.z];
      }),
    );
    new Int32Array(curves.memory.buffer, curves.curve_modes(), c.nodes.length).set(
      c.nodes.map((n) => (n.connection === 'spline' ? 1 : 0)),
    );
    const count = curves.evaluate_curve(c.nodes.length);
    let offset = 0;
    return {
      id: c.id,
      positions: new Float64Array(curves.memory.buffer, curves.curve_data(), count * 3).slice(),
      nodeOffsets: c.nodes.map((n, i) => (i ? (offset += n.connection === 'spline' ? 24 : 1) : 0)),
    };
  });
}
const names = (process.env.BENCH_CASES || 'cylinder,minor,network').split(',');
const samples = Number(process.env.BENCH_SAMPLES || 3);
const results = [];
for (const name of names) {
  const doc = fixture(name === 'cylinder' ? 0 : name === 'minor' ? 1 : name === 'medium' ? 3 : 12),
    geometry = evaluate(doc);
  for (let run = 0; run < samples; run++) {
    let kernelMs = 0,
      indexMs = 0,
      finishMs = 0,
      prepareMs = 0,
      polygonMs = 0;
    const instrumented = {
      ...api,
      build_sweep(count) {
        const t = performance.now();
        let result;
        if (api.prepare_sweep) {
          result = api.prepare_sweep(count);
          prepareMs = performance.now() - t;
          const p = performance.now();
          if (result >= 0) result = api.polygonize_sweep();
          polygonMs = performance.now() - p;
        } else result = api.build_sweep(count);
        kernelMs = performance.now() - t;
        return result;
      },
      ...(api.index_sweep
        ? {
            index_sweep() {
              const t = performance.now();
              const r = api.index_sweep();
              indexMs = performance.now() - t;
              return r;
            },
            finish_sweep() {
              const t = performance.now();
              const r = api.finish_sweep();
              finishMs = performance.now() - t;
              return r;
            },
          }
        : {}),
    };
    const t = performance.now();
    const mesh = pool
      ? await buildSweepAsync(instrumented, doc, geometry, async (api, count) => {
          const t = performance.now(),
            assemble = await pool.generate(api, count);
          return () => {
            const result = assemble();
            kernelMs = performance.now() - t;
            return result;
          };
        })
      : buildSweep(instrumented, doc, geometry);
    const solidMs = performance.now() - t;
    const r = performance.now();
    const shell = removeEndCaps(mesh);
    const removeMs = performance.now() - r;
    const result = {
      name,
      run,
      solidMs,
      kernelMs,
      prepareMs,
      polygonMs,
      indexMs,
      finishMs,
      postMs: solidMs - kernelMs,
      surfaceMs: solidMs + removeMs,
      removeMs,
      triangles: mesh.indices.length / 3,
      shellTriangles: shell.indices.length / 3,
      vertices: mesh.positions.length / 3,
      bodies: mesh.bodies,
      cellSize: mesh.cellSize,
    };
    if (process.env.BENCH_VALIDATE) {
      const edges = new Map();
      for (let i = 0; i < mesh.indices.length; i += 3)
        for (let j = 0; j < 3; j++) {
          const a = mesh.indices[i + j],
            b = mesh.indices[i + ((j + 1) % 3)],
            key = Math.min(a, b) * mesh.positions.length + Math.max(a, b);
          const e = edges.get(key) || { a, b, count: 0, orientation: 0 };
          e.count++;
          e.orientation += a < b ? 1 : -1;
          edges.set(key, e);
        }
      const bad = [...edges.values()].filter((e) => e.count !== 2 || e.orientation !== 0);
      console.log(
        'BAD',
        bad.length,
        bad.slice(0, 12).map((e) => ({
          ...e,
          a: [0, 1, 2].map((c) => mesh.positions[e.a * 3 + c] + mesh.origin[c]),
          b: [0, 1, 2].map((c) => mesh.positions[e.b * 3 + c] + mesh.origin[c]),
        })),
      );
    }
    results.push(result);
    console.log(JSON.stringify(result));
    await mkdir('output/sweep-optimization', { recursive: true });
    await writeFile(
      process.env.BENCH_OUTPUT || 'output/sweep-optimization/latest.json',
      JSON.stringify({ date: new Date().toISOString(), root, node: process.version, results }, null, 2),
    );
  }
}
await mkdir('output/sweep-optimization', { recursive: true });
await writeFile(
  process.env.BENCH_OUTPUT || 'output/sweep-optimization/latest.json',
  JSON.stringify({ date: new Date().toISOString(), root, node: process.version, results }, null, 2),
);

pool?.dispose();
