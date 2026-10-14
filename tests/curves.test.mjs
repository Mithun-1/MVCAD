import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { newDocument, validateDocument, descendants } from '../src/model.ts';
import {
  suppressedFeatures,
  curveSections,
  assignSectionDiameter,
  sectionDiameter,
  curveJunctions,
  sectionSweepSettings,
  sectionRoundingJunctions,
  assignSectionSweepSetting,
} from '../src/curves.ts';

test('junction graph records all adjoining sections, including connections across masters', () => {
  const doc = document();
  const master = doc.curves[0];
  doc.curves.push({ ...master, id: 'branch', name: 'Branch', nodes: [master.nodes[1], master.nodes[3]] });
  const sections = curveSections(doc);
  const graph = curveJunctions(doc, sections);
  assert.equal(graph.size, 2);
  assert.deepEqual(
    graph.get(JSON.stringify(['set', 'b'])).sectionIds,
    sections.map((s) => s.id),
  );
  assert.deepEqual(graph.get(JSON.stringify(['set', 'd'])).sectionIds, [sections[1].id, sections[2].id]);
  doc.curves[1].visible = false;
  assert.deepEqual(curveJunctions(doc, curveSections(doc)), graph);
  assert.deepEqual(curveJunctions(validateDocument(JSON.parse(JSON.stringify(doc))), sections), graph);
  doc.curves[1].suppressed = true;
  assert.equal(curveJunctions(doc, curveSections(doc)).size, 0);
  doc.curves.pop();
  assert.equal(curveJunctions(doc, curveSections(doc)).size, 0);
});

const points = [
  { id: 'a', name: 'A', x: 0, y: 0, z: 0 },
  { id: 'b', name: 'B', x: 10, y: 20, z: 1 },
  { id: 'c', name: 'C', x: 30, y: -10, z: 3 },
  { id: 'd', name: 'D', x: 45, y: 0, z: -2 },
];
function document() {
  return {
    ...newDocument(),
    pointSets: [
      { id: 'set', name: 'Points', points: structuredClone(points), visible: true, sourceFiles: [] },
    ],
    curves: [
      {
        id: 'curve',
        name: 'Curve',
        visible: true,
        nodes: points.map((p, i) => ({
          id: `node${i}`,
          point: { setId: 'set', pointId: p.id },
          connection: i === 3 ? 'line' : 'spline',
        })),
      },
    ],
  };
}

test('subcurve cutoff limits, connected ends, shared rounding, and persistence', () => {
  let doc = document();
  const master = doc.curves[0];
  doc.curves.push({ ...master, id: 'branch', name: 'Branch', nodes: [master.nodes[1], master.nodes[2]] });
  const sections = curveSections(doc),
    [first, middle, last, branch] = sections;
  assert.deepEqual(sectionSweepSettings(doc, sections, first), {
    startCutoff: 10,
    endCutoff: 10,
    roundingDiameter: 3,
    connected: [false, true],
  });
  assert.deepEqual(sectionSweepSettings(doc, sections, middle).connected, [true, true]);
  assert.deepEqual(sectionSweepSettings(doc, sections, last).connected, [true, false]);
  assert.deepEqual(sectionSweepSettings(doc, sections, branch).connected, [true, true]);
  assert.equal(assignSectionSweepSetting(doc, first, 'startCutoff', 40), doc);
  doc = assignSectionSweepSetting(doc, first, 'endCutoff', 50);
  doc = assignSectionSweepSetting(doc, middle, 'startCutoff', 0);
  assert.equal(sectionSweepSettings(doc, sections, first).endCutoff, 50);
  assert.equal(sectionSweepSettings(doc, sections, middle).startCutoff, 0);
  doc = assignSectionSweepSetting(doc, first, 'roundingDiameter', 0);
  assert.equal(sectionSweepSettings(doc, sections, middle).roundingDiameter, 0);
  const [junction1, junction2] = sectionRoundingJunctions(doc, sections, middle);
  doc = assignSectionSweepSetting(doc, middle, 'roundingDiameter', 4, junction1.key);
  for (const section of [first, middle, branch])
    assert.equal(sectionSweepSettings(doc, sections, section, junction1.key).roundingDiameter, 4);
  assert.equal(sectionSweepSettings(doc, sections, last).roundingDiameter, 3, 'other junction is unchanged');
  doc = assignSectionSweepSetting(doc, branch, 'roundingDiameter', 6, junction2.key);
  assert.equal(sectionSweepSettings(doc, sections, middle, junction2.key).roundingDiameter, 6);
  assert.equal(sectionSweepSettings(doc, sections, last).roundingDiameter, 6);
  assert.equal(sectionSweepSettings(doc, sections, first).roundingDiameter, 4);
  assert.equal(
    assignSectionSweepSetting(doc, first, 'roundingDiameter', 8, junction2.key),
    doc,
    'cannot edit a junction that does not belong to the selected section',
  );
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  for (const value of [-1, 50.1, Infinity, NaN])
    assert.throws(() => assignSectionSweepSetting(doc, first, 'endCutoff', value));
  for (const key of ['startCutoff', 'endCutoff', 'roundingDiameter']) {
    const malformed = structuredClone(doc);
    malformed.curves[0].nodes[1][key] = -1;
    assert.throws(() => validateDocument(malformed));
    malformed.curves[0].nodes[1][key] = '3';
    assert.throws(() => validateDocument(malformed));
  }
  doc.curves[1].suppressed = true;
  const single = curveSections(doc);
  assert.deepEqual(sectionSweepSettings(doc, single, single[0]).connected, [false, false]);
});

test('shared points split both master curves at interior junctions with stable section identities', () => {
  const doc = document();
  const master = doc.curves[0];
  doc.curves.push({ ...master, id: 'branch', name: 'Branch', nodes: [master.nodes[1], master.nodes[2]] });
  const split = curveSections(doc);
  assert.deepEqual(
    split.filter((s) => s.curveId === 'curve').map((s) => [s.start, s.end]),
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  );
  assert.deepEqual(
    split.filter((s) => s.curveId === 'branch').map((s) => [s.start, s.end]),
    [[0, 1]],
  );
  doc.curves[1].visible = false;
  assert.deepEqual(curveSections(doc), split, 'hiding a feature preserves its junctions');
  master.name = 'Renamed';
  doc.pointSets[0].points[1] = { ...points[1], x: 100 };
  assert.deepEqual(curveSections(doc), split, 'names and coordinates do not change topology IDs');
  doc.curves[1].suppressed = true;
  assert.deepEqual(
    curveSections(doc).map((s) => [s.curveId, s.start, s.end]),
    [['curve', 0, 3]],
  );
  doc.curves.pop();
  assert.equal(curveSections(doc).length, 1, 'deleting a branch rejoins the master');
});

test('endpoint-only joins create no empty sections, distinct coincident points do not join', () => {
  const doc = document();
  const master = doc.curves[0];
  const copy = { ...points[1], id: 'copy', name: 'Copy' };
  doc.pointSets[0].points.push(copy);
  doc.curves.push({
    ...master,
    id: 'branch',
    name: 'Branch',
    nodes: [{ id: 'b1', point: { setId: 'set', pointId: 'copy' }, connection: 'line' }, master.nodes[3]],
  });
  assert.deepEqual(
    curveSections(doc).map((s) => [s.start, s.end]),
    [
      [0, 3],
      [0, 1],
    ],
  );
  doc.pointSets[0].suppressed = true;
  assert.deepEqual(curveSections(doc), []);
});

test('diameters belong only to assigned subcurves and survive roundtrip and topology changes', () => {
  const doc = document();
  const master = doc.curves[0];
  doc.curves.push({ ...master, id: 'branch', name: 'Branch', nodes: [master.nodes[1], master.nodes[3]] });
  const sections = curveSections(doc).filter((s) => s.curveId === master.id);
  doc.curves[0] = assignSectionDiameter(master, sections[0], 2.5);
  assert.equal(sectionDiameter(doc.curves[0], sections[0]), 2.5);
  assert.equal(sectionDiameter(doc.curves[0], sections[1]), undefined);
  assert.ok(doc.curves[1].nodes.every((n) => n.diameter === undefined));
  doc.curves[0] = assignSectionDiameter(doc.curves[0], sections[1], 4);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  doc.curves[1].suppressed = true;
  assert.equal(sectionDiameter(doc.curves[0], curveSections(doc)[0]), 'mixed');
  doc.curves[1].suppressed = false;
  for (const [i, diameter] of [2.5, 4].entries())
    assert.equal(sectionDiameter(doc.curves[0], sections[i]), diameter);
  doc.curves[1].nodes = [master.nodes[1], master.nodes[2], master.nodes[3]];
  assert.deepEqual(
    curveSections(doc)
      .filter((s) => s.curveId === master.id)
      .map((s) => sectionDiameter(doc.curves[0], s)),
    [2.5, 4, 4],
  );
  for (const diameter of [0, -1, NaN, Infinity, '3']) {
    const invalid = structuredClone(doc);
    invalid.curves[0].nodes[1].diameter = diameter;
    assert.throws(() => validateDocument(invalid));
  }
});
test('curves roundtrip stable point references and reject dangling links and duplicate neighbors', () => {
  const doc = document();
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  assert.deepEqual([...descendants(doc, 'set')], ['curve']);
  const old = newDocument();
  delete old.curves;
  assert.deepEqual(validateDocument(old).curves, []);
  for (const change of [
    (d) => (d.pointSets[0].points = points.slice(1)),
    (d) => (d.curves[0].nodes[1].point = d.curves[0].nodes[0].point),
    (d) => (d.curves[0].nodes[1].point = null),
    (d) => (d.curves[0].nodes[1].connection = 'unknown'),
    (d) => (d.curves[0].suppressed = 'yes'),
    (d) => (d.curves[0].name = 'Points'),
  ]) {
    const invalid = structuredClone(doc);
    change(invalid);
    assert.throws(() => validateDocument(invalid));
  }
});
test('suppression propagates to dependent curves and planes and preserves independent suppression on resume', () => {
  const doc = document();
  doc.planes = [
    { id: 'p', name: 'P', parentId: 'front', offset: 20, visible: true, suppressed: true },
    { id: 'q', name: 'Q', parentId: 'p', offset: 5, visible: true },
  ];
  doc.pointSets[0].suppressed = true;
  assert.deepEqual([...suppressedFeatures(validateDocument(doc))].sort(), ['curve', 'p', 'q', 'set']);
  doc.pointSets[0].suppressed = false;
  assert.equal(suppressedFeatures(doc).has('curve'), false);
  doc.curves[0].suppressed = true;
  assert.equal(suppressedFeatures(validateDocument(doc)).has('curve'), true);
});
test('C++ mixed curves interpolate every source point, preserve straight segments and recompute edited points', async () => {
  const { instance } = await WebAssembly.instantiate(await readFile('engine/planes.wasm'), {});
  const api = instance.exports;
  const packed = new Float64Array(api.memory.buffer, api.point_buffer(), 12);
  const modes = new Int32Array(api.memory.buffer, api.curve_modes(), 4);
  packed.set(points.flatMap((p) => [p.x, p.y, p.z]));
  modes.set([1, 1, 1, 0]);
  assert.equal(api.evaluate_curve(4), 50);
  const output = new Float64Array(api.memory.buffer, api.curve_data(), 150);
  for (const [i, sample] of [
    [0, 0],
    [1, 24],
    [2, 48],
    [3, 49],
  ])
    assert.deepEqual([...output.slice(sample * 3, sample * 3 + 3)], [points[i].x, points[i].y, points[i].z]);
  const before = output[12 * 3 + 1];
  packed[4] = 40;
  api.evaluate_curve(4);
  assert.notEqual(output[12 * 3 + 1], before);
  assert.equal(output[24 * 3 + 1], 40);
  modes.fill(0);
  assert.equal(api.evaluate_curve(4), 4);
  assert.deepEqual([...output.slice(0, 12)], [...packed]);
  modes.fill(1);
  packed.fill(0);
  assert.equal(api.evaluate_curve(4), 73);
  assert.ok([...new Float64Array(api.memory.buffer, api.curve_data(), 73 * 3)].every((n) => n === 0));
  assert.equal(api.evaluate_curve(1001), -1);
  assert.equal(api.evaluate_curve(1), -1);
  packed[0] = NaN;
  assert.equal(api.evaluate_curve(4), -3);
});
