import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SweepCache } from '../src/sweepCache.ts';

test('sweep cache reuses solids for display edits and cap removal, but invalidates all geometry inputs', () => {
  const cache = new SweepCache();
  const node = { point: { setId: 'set', pointId: 'point' }, connection: 'spline', diameter: 8 };
  const doc = { curves: [{ id: 'curve', name: 'Curve', visible: true, nodes: [node] }] };
  const geometry = [{ id: 'curve', nodeOffsets: [0], positions: new Float64Array([1, 2, 3]) }];
  let count = 0;
  const create = () => {
    count++;
    return {
      positions: new Float32Array(9),
      renderPositions: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
      renderIndices: new Uint32Array([0, 1, 2]),
      surfaceIds: new Uint32Array([0]),
      endCapTriangles: new Uint8Array([1]),
      bodyRanges: [{ start: 0, count: 3 }],
    };
  };
  const get = (remove = false) => cache.get(doc, geometry, create, remove);
  const original = get();
  doc.curves[0].name = 'Renamed';
  doc.curves[0].visible = false;
  assert.equal(get(), original);
  const shell = get(true);
  assert.equal(shell.indices.length, 0);
  assert.equal(shell.positions, original.positions);
  assert.equal(get(true), shell);
  assert.equal(get(), original);
  assert.equal(count, 1);
  for (const field of ['diameter', 'startCutoff', 'endCutoff', 'roundingDiameter']) {
    const previous = get();
    node[field] = 13;
    assert.notEqual(get(), previous);
  }
  let previous = get();
  node.point.pointId = 'coincident-but-distinct';
  assert.notEqual(get(), previous);
  previous = get();
  geometry[0].positions[0] += 1;
  assert.notEqual(get(), previous);
  previous = get();
  geometry[0].nodeOffsets[0] += 1;
  assert.notEqual(get(), previous);
  previous = get();
  node.connection = 'line';
  assert.notEqual(get(), previous);
  previous = get();
  doc.curves.push({ id: 'suppressed-peer', suppressed: true, nodes: [{ ...node, roundingDiameter: 22 }] });
  assert.notEqual(get(), previous);
  previous = get();
  doc.curves[1].nodes[0].roundingDiameter = 24;
  assert.notEqual(get(), previous);
  const before = count;
  geometry.length = 0;
  get();
  assert.equal(count, before + 1);
});

test('failed generation does not poison the last valid cached solid', () => {
  const cache = new SweepCache(),
    doc = { curves: [] };
  const original = cache.get(doc, [], () => ({}), false);
  const geometry = [{ id: 'missing', nodeOffsets: [], positions: new Float64Array() }];
  assert.throws(() =>
    cache.get(
      doc,
      geometry,
      () => {
        throw Error('failed');
      },
      false,
    ),
  );
  assert.equal(
    cache.get(
      doc,
      [],
      () => {
        throw Error('should reuse');
      },
      false,
    ),
    original,
  );
});

test('async cache deduplicates pending geometry and ignores stale completions', async () => {
  const cache = new SweepCache(),
    doc = { curves: [] };
  const a = [{ id: 'a', nodeOffsets: [], positions: new Float64Array() }];
  const b = [{ id: 'b', nodeOffsets: [], positions: new Float64Array() }];
  let resolveA,
    resolveB,
    calls = 0;
  const generateA = () => {
    calls++;
    return new Promise((resolve) => {
      resolveA = resolve;
    });
  };
  const first = cache.getAsync(doc, a, generateA, false);
  const duplicate = cache.getAsync(doc, a, generateA, false);
  const latest = cache.getAsync(
    doc,
    b,
    () =>
      new Promise((resolve) => {
        resolveB = resolve;
      }),
    false,
  );
  const solidA = {},
    solidB = {};
  resolveB(solidB);
  assert.equal(await latest, solidB);
  resolveA(solidA);
  assert.equal(await first, solidA);
  assert.equal(await duplicate, solidA);
  assert.equal(calls, 1);
  assert.equal(
    await cache.getAsync(
      doc,
      b,
      () => {
        throw Error('must reuse latest');
      },
      false,
    ),
    solidB,
  );
  await assert.rejects(
    cache.getAsync(
      doc,
      a,
      async () => {
        throw Error('failed');
      },
      false,
    ),
  );
  assert.equal(await cache.getAsync(doc, a, async () => solidA, false), solidA);
});

test('explicit regeneration discards cached and pending results', async () => {
  const cache = new SweepCache(),
    doc = { curves: [] };
  let finish;
  const previous = cache.getAsync(
    doc,
    [],
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    false,
  );
  cache.clear();
  const fresh = {};
  assert.equal(await cache.getAsync(doc, [], async () => fresh, false), fresh);
  finish({});
  await previous;
  assert.equal(
    await cache.getAsync(
      doc,
      [],
      () => {
        throw Error('old pending result replaced fresh result');
      },
      false,
    ),
    fresh,
  );
  cache.clear();
  const newer = {};
  assert.equal(await cache.getAsync(doc, [], async () => newer, false), newer);
});
