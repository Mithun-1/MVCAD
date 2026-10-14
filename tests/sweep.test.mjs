import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildSweep, sweepPaths, sweepRoundings } from '../src/sweep.ts';
import { curveSections, assignSectionSweepSetting } from '../src/curves.ts';
import { newDocument, validateDocument } from '../src/model.ts';
import { removeEndCaps } from '../src/removeCaps.ts';

let api, curves;
before(async () => {
  api = (await WebAssembly.instantiate(await readFile('engine/sweep.wasm'), {})).instance.exports;
  curves = (await WebAssembly.instantiate(await readFile('engine/planes.wasm'), {})).instance.exports;
});
export function vesselDocument() {
  const doc = newDocument();
  doc.autoSweep = true;
  doc.pointSets = [
    {
      id: 'points',
      name: 'Vessel points',
      visible: true,
      sourceFiles: [],
      points: [
        { id: 'a', name: 'A', x: 0, y: 0, z: 0 },
        { id: 'b', name: 'B', x: 0, y: 50, z: 0 },
        { id: 'c', name: 'C', x: 0, y: 100, z: 0 },
        { id: 'd', name: 'D', x: 0, y: 150, z: 0 },
        { id: 'e', name: 'E', x: 40, y: 75, z: 0 },
      ],
    },
  ];
  const node = (id, diameter) => ({
    id,
    point: { setId: 'points', pointId: id },
    connection: 'line',
    ...(diameter ? { diameter } : {}),
  });
  doc.curves = [
    {
      id: 'master',
      name: 'Main vessel',
      visible: true,
      nodes: [node('a'), node('b', 8), node('c', 6), node('d', 9)],
    },
    { id: 'branch', name: 'Branch', visible: true, nodes: [node('b'), node('e', 7), node('c', 7)] },
  ];
  return doc;
}
function evaluate(doc) {
  return doc.curves
    .filter((c) => !c.suppressed)
    .map((c) => {
      new Float64Array(curves.memory.buffer, curves.point_buffer(), c.nodes.length * 3).set(
        c.nodes.flatMap((n) => {
          const p = doc.pointSets[0].points.find((p) => p.id === n.point.pointId);
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
function closed(mesh) {
  const edges = new Map();
  const n = mesh.positions.length / 3;
  let volume = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = [...mesh.indices.subarray(i, i + 3)];
    for (let j = 0; j < 3; j++) {
      const a = ids[j],
        b = ids[(j + 1) % 3],
        key = Math.min(a, b) * n + Math.max(a, b);
      const edge = edges.get(key) ?? [0, 0];
      edge[0]++;
      edge[1] += a < b ? 1 : -1;
      edges.set(key, edge);
    }
    const [a, b, c] = ids.map((id) => mesh.positions.subarray(id * 3, id * 3 + 3));
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  assert.ok(
    [...edges.values()].every(([count, orientation]) => count === 2 && orientation === 0),
    'every mesh edge has two oppositely oriented faces',
  );
  assert.ok(volume > 0, 'outward-oriented closed volume');
  assert.ok(mesh.normals.every(Number.isFinite));
  return volume;
}

function sharpEnds(mesh, endpoints) {
  const capVertices = new Set(),
    wallVertices = new Set(),
    rendered = new Map();
  let capFaces = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const isCap = !!mesh.endCapTriangles[i / 3];
    const xyz = [0, 1, 2].map((j) =>
      [0, 1, 2].map((c) => mesh.positions[mesh.indices[i + j] * 3 + c] + mesh.origin[c]),
    );
    const plane =
      isCap &&
      endpoints.find(({ center, normal }) =>
        xyz.every(
          (p) =>
            Math.abs(p.reduce((sum, v, c) => sum + (v - center[c]) * normal[c], 0)) < mesh.cellSize * 2e-4,
        ),
      );
    if (isCap) {
      assert.ok(plane, 'cap triangles lie exactly on an endpoint plane');
      capFaces++;
    }
    for (let j = 0; j < 3; j++) {
      const v = mesh.indices[i + j],
        r = mesh.renderIndices[i + j];
      (isCap ? capVertices : wallVertices).add(v);
      const pair = rendered.get(v) ?? {};
      pair[isCap ? 'cap' : 'wall'] = r;
      rendered.set(v, pair);
      if (plane)
        assert.ok(
          plane.normal.reduce((sum, n, c) => sum + n * mesh.renderNormals[r * 3 + c], 0) > 0.99999,
          'flat cap shading',
        );
    }
  }
  assert.ok(capFaces > 10);
  let rims = 0;
  for (const v of capVertices)
    if (wallVertices.has(v)) {
      const pair = rendered.get(v);
      assert.notEqual(pair.cap, pair.wall, 'rim has separate cap and wall normals');
      const p = [0, 1, 2].map((c) => mesh.positions[v * 3 + c] + mesh.origin[c]);
      const end = endpoints.find(
        ({ center, normal }) =>
          Math.abs(p.reduce((sum, value, c) => sum + (value - center[c]) * normal[c], 0)) <
          mesh.cellSize * 2e-4,
      );
      assert.ok(end);
      assert.ok(
        Math.abs(Math.hypot(...p.map((value, c) => value - end.center[c])) - end.radius) <
          mesh.cellSize * 0.12,
        'rim retains full circular radius',
      );
      const dot = [0, 1, 2].reduce(
        (sum, c) => sum + mesh.renderNormals[pair.cap * 3 + c] * mesh.renderNormals[pair.wall * 3 + c],
        0,
      );
      assert.ok(Math.abs(dot) < 0.02, 'cap and cylindrical wall meet sharply, without a shading bevel');
      rims++;
    }
  assert.ok(rims > 20);
  const shell = removeEndCaps(mesh);
  const edgeCounts = new Map();
  for (let i = 0; i < shell.indices.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = shell.indices[i + j],
        b = shell.indices[i + ((j + 1) % 3)];
      const key = [Math.min(a, b), Math.max(a, b)].join(':');
      const edge = edgeCounts.get(key) ?? { a, b, count: 0 };
      edge.count++;
      edgeCounts.set(key, edge);
    }
  for (const edge of edgeCounts.values())
    if (edge.count === 1) {
      assert.ok(
        capVertices.has(edge.a) && capVertices.has(edge.b),
        'Remove exposes precisely the planar rim',
      );
    }
}

function openingCount(mesh) {
  const edges = new Map(),
    adjacency = new Map();
  for (let i = 0; i < mesh.indices.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = mesh.indices[i + j],
        b = mesh.indices[i + ((j + 1) % 3)];
      const key = [Math.min(a, b), Math.max(a, b)].join(':');
      const edge = edges.get(key) ?? { a, b, count: 0 };
      edge.count++;
      edges.set(key, edge);
    }
  for (const { a, b, count } of edges.values()) {
    assert.ok(count === 1 || count === 2, 'shell edges remain manifold');
    if (count !== 1) continue;
    for (const [v, n] of [
      [a, b],
      [b, a],
    ]) {
      if (!adjacency.has(v)) adjacency.set(v, new Set());
      adjacency.get(v).add(n);
    }
  }
  assert.ok(
    [...adjacency.values()].every((neighbors) => neighbors.size === 2),
    'openings have continuous closed rims',
  );
  let loops = 0;
  const visited = new Set();
  for (const vertex of adjacency.keys())
    if (!visited.has(vertex)) {
      loops++;
      const pending = [vertex];
      while (pending.length) {
        const v = pending.pop();
        if (visited.has(v)) continue;
        visited.add(v);
        pending.push(...adjacency.get(v));
      }
    }
  return loops;
}

test('10% arc-length transition windows preserve core diameters and full-length branch radius', () => {
  const doc = vesselDocument();
  const { paths, skipped } = sweepPaths(doc, evaluate(doc));
  assert.equal(skipped, 0);
  assert.equal(paths.length, 2);
  const radius = (y) => {
    const i = paths[0].radii.findIndex((_, i) => Math.abs(paths[0].positions[i * 3 + 1] - y) < 1e-8);
    assert.ok(i >= 0);
    return paths[0].radii[i];
  };
  for (const [y, r] of [
    [0, 4],
    [45, 4],
    [50, 3.5],
    [55, 3],
    [95, 3],
    [100, 3.75],
    [105, 4.5],
    [150, 4.5],
  ])
    assert.ok(Math.abs(radius(y) - r) < 1e-9);
  assert.ok(paths[1].radii.every((r) => r === 3.5));
});

test('independent 0–50% cutoffs define asymmetric transition windows, including zero and touching windows', () => {
  let doc = vesselDocument();
  const sections = curveSections(doc).filter((section) => section.curveId === 'master');
  doc = assignSectionSweepSetting(doc, sections[0], 'endCutoff', 20);
  doc = assignSectionSweepSetting(doc, sections[1], 'startCutoff', 0);
  let path = sweepPaths(doc, evaluate(doc)).paths[0];
  const at = (y) => {
    const i = path.radii.findIndex((_, i) => Math.abs(path.positions[i * 3 + 1] - y) < 1e-8);
    assert.ok(i >= 0);
    return path.radii[i];
  };
  assert.equal(at(40), 4);
  assert.equal(at(50), 3);
  doc = assignSectionSweepSetting(doc, sections[0], 'endCutoff', 0);
  const split = sweepPaths(doc, evaluate(doc)).paths;
  assert.equal(split.length, 3, 'zero on both sides creates an abrupt diameter change without a hidden ramp');
  assert.equal(split[0].radii.at(-1), 4);
  assert.equal(split[1].radii[0], 3);
  const zeroCutoffs = buildSweep(api, doc, evaluate(doc));
  assert.equal(zeroCutoffs.bodies, 1);
  closed(zeroCutoffs);
  assert.equal(openingCount(removeEndCaps(zeroCutoffs)), 2, 'internal diameter steps do not become holes');
  doc = assignSectionSweepSetting(doc, sections[0], 'endCutoff', 50);
  doc = assignSectionSweepSetting(doc, sections[1], 'startCutoff', 50);
  doc = assignSectionSweepSetting(doc, sections[1], 'endCutoff', 50);
  doc = assignSectionSweepSetting(doc, sections[2], 'startCutoff', 50);
  path = sweepPaths(doc, evaluate(doc)).paths[0];
  assert.equal(at(75), 3);
  assert.ok(path.radii.every(Number.isFinite));
});

test('default diameter-3 junction fillets add a closed rounding region and zero restores sharp geometry', () => {
  const doc = vesselDocument();
  const evaluated = evaluate(doc);
  const specs = sweepRoundings(doc, sweepPaths(doc, evaluated).paths);
  assert.equal(specs.length, 2);
  assert.ok(specs.every((spec) => spec.radius === 1.5));
  const rounded = buildSweep(api, doc, evaluated);
  assert.equal(rounded.bodies, 1);
  const roundedVolume = closed(rounded);
  const shell = removeEndCaps(rounded);
  assert.equal(openingCount(shell), 2, 'junctions stay joined while the two exterior ends open');
  assert.equal(shell.bodies, rounded.bodies);
  for (const curve of doc.curves) for (const node of curve.nodes) node.roundingDiameter = 0;
  assert.equal(sweepRoundings(doc, sweepPaths(doc, evaluated).paths).length, 0);
  const sharp = buildSweep(api, doc, evaluated);
  const sharpVolume = closed(sharp);
  assert.ok(roundedVolume > sharpVolume, 'rounding adds material at the concave junction');
  assert.ok(roundedVolume < sharpVolume * 1.15, 'rounding stays local to the junctions');
  assert.ok(rounded.creases.length < sharp.creases.length);
});

test('spline guides with asymmetric cutoffs generate a closed body', () => {
  let doc = vesselDocument();
  for (const curve of doc.curves) for (const node of curve.nodes) node.connection = 'spline';
  const sections = curveSections(doc).filter((s) => s.curveId === 'master');
  doc = assignSectionSweepSetting(doc, sections[0], 'endCutoff', 20);
  doc = assignSectionSweepSetting(doc, sections[1], 'startCutoff', 0);
  doc = assignSectionSweepSetting(doc, sections[1], 'endCutoff', 50);
  let original;
  const mesh = buildSweep(
    {
      ...api,
      finish_sweep: () => {
        const count = new Uint32Array(api.memory.buffer, api.sweep_mesh_counts(), 4)[0];
        original = new Float64Array(api.memory.buffer, api.sweep_vertices(), count * 3).slice();
        return api.finish_sweep();
      },
    },
    doc,
    evaluate(doc),
  );
  assert.equal(mesh.bodies, 1);
  const volume = closed(mesh);

  assert.equal(original.length, mesh.positions.length);
  const beforeVolume = closed({ ...mesh, positions: Float64Array.from(original) });
  assert.ok(Math.abs(volume / beforeVolume - 1) < 0.01, 'junction fairing changes volume by less than 1%');
  let maximum = 0;
  for (let i = 0; i < original.length; i += 3)
    maximum = Math.max(maximum, Math.hypot(...[0, 1, 2].map((c) => mesh.positions[i + c] - original[i + c])));
  assert.ok(maximum > mesh.cellSize * 0.01, 'the solid vertices actually change, not just their normals');
  assert.ok(maximum < mesh.cellSize * 0.751, 'the change remains sub-cell');
  for (let i = 0; i < mesh.indices.length; i++)
    for (let c = 0; c < 3; c++)
      assert.equal(
        mesh.renderPositions[mesh.renderIndices[i] * 3 + c],
        mesh.positions[mesh.indices[i] * 3 + c],
        'display and solid geometry agree exactly',
      );
});
test('C++ sweep joins intersecting vessels into one watertight body', () => {
  const doc = vesselDocument();
  const mesh = buildSweep(api, doc, evaluate(doc));
  assert.equal(mesh.bodies, 1);
  assert.ok(mesh.indices.length > 1000);
  closed(mesh);
});

test('rounding stays watertight with three vessels sharing a junction', () => {
  const doc = vesselDocument();
  doc.pointSets[0].points.push({ id: 'depth', name: 'Depth', x: -10, y: 50, z: 25 });
  doc.curves.push({
    id: 'depth',
    name: 'Depth branch',
    visible: true,
    nodes: [
      { id: 'start', point: { setId: 'points', pointId: 'b' }, connection: 'line' },
      { id: 'end', point: { setId: 'points', pointId: 'depth' }, connection: 'line', diameter: 6 },
    ],
  });
  const mesh = buildSweep(api, doc, evaluate(doc));
  assert.equal(mesh.bodies, 1);
  closed(mesh);
});

test('junctions use exact union without an automatic rounding blend', () => {
  const doc = vesselDocument();
  doc.curves[0].nodes = doc.curves[0].nodes.slice(0, 2);
  doc.pointSets[0].points.push(
    { id: 'f', name: 'F', x: -25, y: 25, z: 0 },
    { id: 'g', name: 'G', x: 25, y: 25, z: 0 },
  );
  doc.curves[1].nodes = ['f', 'g'].map((id) => ({
    id,
    point: { setId: 'points', pointId: id },
    connection: 'line',
    diameter: 8,
  }));
  const mesh = buildSweep(api, doc, evaluate(doc));
  const settings = new Float64Array(api.memory.buffer, api.sweep_settings(), 8);
  const grid = [3, 28, 2].map((v, c) => Math.round((v - mesh.origin[c]) / mesh.cellSize));
  const [x, y, z] = grid.map((i, c) => mesh.origin[c] + i * mesh.cellSize);
  const expected = Math.min(Math.hypot(x, z) - 4, Math.hypot(y - 25, z) - 4);
  const id = (grid[2] * settings[5] + grid[1]) * settings[4] + grid[0];
  const value = new Float32Array(
    api.memory.buffer,
    api.sweep_field(),
    settings[4] * settings[5] * settings[6],
  )[id];
  assert.ok(Math.abs(value - expected) < 1e-6);
  assert.equal(mesh.bodies, 1);
  closed(mesh);
  assert.ok(mesh.creases.length > 100, 'a visible intersection edge is retained');
  let intersectionVertices = 0;
  for (let i = 0; i < mesh.creases.length; i += 3) {
    const x = mesh.creases[i] + mesh.origin[0],
      y = mesh.creases[i + 1] + mesh.origin[1],
      z = mesh.creases[i + 2] + mesh.origin[2];
    // End rims are now explicit sharp edges as well as the vessel intersection.
    if (Math.abs(y) < 1e-4 || Math.abs(y - 50) < 1e-4 || Math.abs(Math.abs(x) - 25) < 1e-4) continue;
    intersectionVertices++;
    assert.ok(Math.abs(Math.hypot(x, z) - 4) < mesh.cellSize * 0.15, 'crease lies on first cylinder');
    assert.ok(Math.abs(Math.hypot(y - 25, z) - 4) < mesh.cellSize * 0.15, 'crease lies on second cylinder');
  }
  assert.ok(intersectionVertices > 100);
  const shared = new Map();
  for (let i = 0; i < mesh.indices.length; i++) {
    const vertex = mesh.indices[i],
      rendered = mesh.renderIndices[i],
      source = mesh.surfaceIds[Math.floor(i / 3)];
    const entry = shared.get(vertex) ?? new Map();
    entry.set(source, rendered);
    shared.set(vertex, entry);
  }
  let sharp = 0;
  for (const [vertex, entry] of shared) {
    if (entry.size !== 2) continue;
    const x = mesh.positions[vertex * 3] + mesh.origin[0],
      y = mesh.positions[vertex * 3 + 1] + mesh.origin[1],
      z = mesh.positions[vertex * 3 + 2] + mesh.origin[2];
    const a = mesh.renderNormals.subarray(entry.get(0) * 3, entry.get(0) * 3 + 3),
      b = mesh.renderNormals.subarray(entry.get(1) * 3, entry.get(1) * 3 + 3);
    assert.ok(
      (a[0] * x + a[2] * z) / Math.hypot(x, z) > 0.998,
      'first surface retains its radial normal at the seam',
    );
    assert.ok(
      (b[1] * (y - 25) + b[2] * z) / Math.hypot(y - 25, z) > 0.998,
      'second surface retains its radial normal at the seam',
    );
    if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0.8) sharp++;
  }
  assert.ok(sharp > 20, 'joined vertices have distinct normals instead of a smooth blend');
});
test('straight circular solid has flat end caps and the assigned diameter and volume', () => {
  const doc = vesselDocument();
  doc.curves = [doc.curves[0]];
  doc.curves[0].nodes = doc.curves[0].nodes.slice(0, 2);
  const mesh = buildSweep(api, doc, evaluate(doc));
  const volume = closed(mesh);
  sharpEnds(mesh, [
    { center: [0, 0, 0], normal: [0, -1, 0], radius: 4 },
    { center: [0, 50, 0], normal: [0, 1, 0], radius: 4 },
  ]);
  const shell = removeEndCaps(mesh);
  assert.equal(openingCount(shell), 2);
  assert.ok(shell.surfaceShell && shell.removedCapTriangles > 0);
  assert.equal(mesh.indices.length - shell.indices.length, shell.removedCapTriangles * 3);
  assert.equal(shell.positions, mesh.positions, 'wall and junction coordinates are unchanged');
  assert.equal(shell.renderPositions, mesh.renderPositions);
  assert.equal(shell.bodyRanges[0].count, shell.indices.length);
  for (let i = 0; i < shell.indices.length; i++)
    for (let c = 0; c < 3; c++)
      assert.equal(
        shell.positions[shell.indices[i] * 3 + c],
        shell.renderPositions[shell.renderIndices[i] * 3 + c],
      );
  doc.removeCaps = true;
  assert.equal(validateDocument(JSON.parse(JSON.stringify(doc))).removeCaps, true);
  assert.throws(() => validateDocument({ ...doc, removeCaps: 'yes' }));
  assert.ok(Math.abs(volume / (Math.PI * 16 * 50) - 1) < 0.025);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    const c = i % 3,
      value = mesh.positions[i] + mesh.origin[c];
    min[c] = Math.min(min[c], value);
    max[c] = Math.max(max[c], value);
  }
  assert.ok(Math.abs(min[1]) < mesh.cellSize * 0.1 && Math.abs(max[1] - 50) < mesh.cellSize * 0.1);
  assert.ok(Math.abs(max[0] - min[0] - 8) < mesh.cellSize * 0.15);
  // On a cylinder wall, shading normals follow the radial surface rather than mesh diagonals.
  let walls = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i] + mesh.origin[0],
      y = mesh.positions[i + 1] + mesh.origin[1],
      z = mesh.positions[i + 2] + mesh.origin[2];
    if (y < 2 || y > 48) continue;
    const radius = Math.hypot(x, z);
    assert.ok((mesh.normals[i] * x + mesh.normals[i + 2] * z) / radius > 0.999);
    assert.ok(Math.abs(mesh.normals[i + 1]) < 0.001);
    walls++;
  }
  assert.ok(walls > 100);
});

test('sharp unions remain watertight at three-way joins and coincident vessel surfaces', () => {
  const doc = vesselDocument();
  doc.curves = [doc.curves[0]];
  doc.curves[0].nodes = doc.curves[0].nodes.slice(0, 2);
  const add = (id, a, b, diameter) => {
    const points = [a, b].map(([x, y, z], i) => ({ id: `${id}${i}`, name: `${id}${i}`, x, y, z }));
    doc.pointSets[0].points.push(...points);
    doc.curves.push({
      id,
      name: id,
      visible: true,
      nodes: points.map((p) => ({
        id: p.id,
        point: { setId: 'points', pointId: p.id },
        connection: 'line',
        diameter,
      })),
    });
  };
  add('cross', [-20, 25, 0], [20, 25, 0], 8);
  add('depth', [0, 25, -20], [0, 25, 20], 6);
  let mesh = buildSweep(api, doc, evaluate(doc));
  assert.equal(mesh.bodies, 1);
  closed(mesh);
  doc.curves = [doc.curves[0], { ...doc.curves[0], id: 'duplicate', name: 'Duplicate' }];
  mesh = buildSweep(api, doc, evaluate(doc));
  assert.equal(mesh.bodies, 1);
  assert.equal(mesh.creases.length, 0);
  closed(mesh);
});

test('Remove handles angled ends and leaves closed-loop vessel walls intact', () => {
  const doc = vesselDocument();
  doc.curves = [doc.curves[0]];
  doc.curves[0].nodes = doc.curves[0].nodes.slice(0, 2);
  Object.assign(doc.pointSets[0].points[0], { x: 1, y: -20, z: 3 });
  Object.assign(doc.pointSets[0].points[1], { x: 22, y: 20, z: 18 });
  const angled = buildSweep(api, doc, evaluate(doc));
  closed(angled);
  const direction = [21, 40, 15].map((v) => v / Math.hypot(21, 40, 15));
  sharpEnds(angled, [
    { center: [1, -20, 3], normal: direction.map((v) => -v), radius: 4 },
    { center: [22, 20, 18], normal: direction, radius: 4 },
  ]);
  assert.equal(openingCount(removeEndCaps(angled)), 2);
  doc.curves[0].nodes.push(
    { id: 'turn', point: { setId: 'points', pointId: 'e' }, connection: 'line', diameter: 8 },
    { id: 'close', point: { setId: 'points', pointId: 'a' }, connection: 'line', diameter: 8 },
  );
  const loop = buildSweep(api, doc, evaluate(doc)),
    shell = removeEndCaps(loop);
  assert.equal(shell.removedCapTriangles, 0);
  assert.deepEqual(shell.indices, loop.indices);
  closed(shell);
});
test('unassigned sections create no geometry and disconnected assigned paths remain separate bodies', () => {
  const doc = vesselDocument();
  doc.curves = [doc.curves[0]];
  delete doc.curves[0].nodes[2].diameter;
  const mesh = buildSweep(api, doc, evaluate(doc));
  assert.equal(mesh.bodies, 2);
  assert.equal(mesh.bodyRanges.length, 2);
  assert.equal(
    mesh.bodyRanges.reduce((n, b) => n + b.count, 0),
    mesh.indices.length,
  );
  for (const range of mesh.bodyRanges)
    closed({ ...mesh, indices: mesh.indices.subarray(range.start, range.start + range.count) });
  closed(mesh);
  for (const node of doc.curves[0].nodes) delete node.diameter;
  assert.equal(buildSweep(api, doc, evaluate(doc)).indices.length, 0);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  assert.throws(() => validateDocument({ ...doc, autoSweep: 'yes' }));
});

test('junction rounding never rounds nearby free boundary caps', () => {
  const doc = vesselDocument();
  doc.curves[0].nodes = doc.curves[0].nodes.slice(0, 3);
  doc.curves[0].nodes.forEach((n) => {
    n.diameter = 8;
  });
  Object.assign(doc.pointSets[0].points[0], { y: 35 });
  Object.assign(doc.pointSets[0].points[2], { y: 65 });
  Object.assign(doc.pointSets[0].points[4], { x: 12, y: 50 });
  doc.curves[1].nodes = doc.curves[1].nodes.slice(0, 2);
  const mesh = buildSweep(api, doc, evaluate(doc));
  closed(mesh);
  sharpEnds(mesh, [
    { center: [0, 35, 0], normal: [0, -1, 0], radius: 4 },
    { center: [0, 65, 0], normal: [0, 1, 0], radius: 4 },
    { center: [12, 50, 0], normal: [1, 0, 0], radius: 3.5 },
  ]);
  assert.equal(openingCount(removeEndCaps(mesh)), 3);
});
