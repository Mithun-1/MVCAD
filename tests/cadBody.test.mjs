import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init from 'replicad-opencascadejs';
import occtReader from 'occt-import-js';
import * as cad from 'replicad';
import { buildCadBody } from '../src/cadBody.ts';
import { exportCadStep } from '../src/stepExport.ts';
import { newDocument, validateDocument } from '../src/model.ts';
import { importStepCurves } from '../src/stepImport.ts';

let oc, kernel, reader;
before(async () => {
  oc = await init({ print: () => {} });
  cad.setOC(oc);
  kernel = (await WebAssembly.instantiate(await readFile('engine/planes.wasm'), {})).instance.exports;
  reader = await occtReader();
});
function fixture(branch = false, diameter = 8) {
  const doc = newDocument();
  doc.pointSets = [
    {
      id: 'points',
      name: 'Points',
      visible: true,
      sourceFiles: [],
      points: [
        [0, 0, 0],
        [0, 30, 0],
        [0, 60, 0],
        [30, 30, 0],
      ].map(([x, y, z], i) => ({ id: String(i), name: `P${i}`, x, y, z })),
    },
  ];
  const node = (i, diameter) => ({
    id: `n${i}`,
    point: { setId: 'points', pointId: String(i) },
    connection: 'line',
    diameter,
  });
  doc.curves = [{ id: 'main', name: 'Main', visible: true, nodes: [node(0), node(1, 8), node(2, diameter)] }];
  if (branch) doc.curves.push({ id: 'branch', name: 'Branch', visible: true, nodes: [node(1), node(3, 6)] });
  return doc;
}
function evaluate(doc) {
  return doc.curves.map((curve) => {
    const values = curve.nodes.flatMap((n) => {
      const p = doc.pointSets[0].points.find((p) => p.id === n.point.pointId);
      return [p.x, p.y, p.z];
    });
    new Float64Array(kernel.memory.buffer, kernel.point_buffer(), values.length).set(values);
    new Int32Array(kernel.memory.buffer, kernel.curve_modes(), curve.nodes.length).set(
      curve.nodes.map((n) => (n.connection === 'spline' ? 1 : 0)),
    );
    const count = kernel.evaluate_curve(curve.nodes.length);
    let offset = 0;
    return {
      id: curve.id,
      positions: new Float64Array(kernel.memory.buffer, kernel.curve_data(), count * 3).slice(),
      nodeOffsets: curve.nodes.map((n, i) => (i === 0 ? 0 : (offset += n.connection === 'spline' ? 24 : 1))),
    };
  });
}

test('native cylinder has analytic walls, sharp caps, valid solid and STEP with no faceted faces', async () => {
  const doc = fixture();
  const mesh = buildCadBody(oc, doc, evaluate(doc), false);
  assert.equal(mesh.bodies, 1);
  const shape = cad.deserializeShape(mesh.cadBreps[0]);
  assert.ok(shape.faces.some((f) => f.geomType === 'CYLINDRE'));
  assert.ok(Math.abs(cad.measureVolume(shape) - Math.PI * 16 * 60) < 0.01);
  const blob = exportCadStep(mesh.cadBreps, "Vessel's test", 'mm');
  const text = await blob.text();
  assert.match(text, /ADVANCED_FACE/);
  assert.match(text, /MANIFOLD_SOLID_BREP/);
  assert.doesNotMatch(text, /FACETED_BREP|POLY_LOOP|TRIANGULATED_FACE/);
  const imported = reader.ReadStepFile(new Uint8Array(await blob.arrayBuffer()), null);
  assert.equal(imported.success, true);
  assert.equal(imported.meshes.length, 1);
  assert.ok(imported.meshes[0].brep_faces.length < 10);
  shape.delete();
});

test('Remove opens a single-face cylindrical wall without rounding its circular rims', async () => {
  const doc = fixture();
  doc.curves[0].nodes.splice(1, 1);
  const mesh = buildCadBody(oc, doc, evaluate(doc), true);
  const shape = cad.deserializeShape(mesh.cadBreps[0]);
  assert.equal(shape.faces.length, 1);
  assert.equal(shape.faces[0].geomType, 'CYLINDRE');
  assert.equal(shape.solids.length, 0);
  const circles = shape.edges.filter((e) => e.geomType === 'CIRCLE');
  assert.equal(circles.length, 2);
  circles.forEach((e) => assert.ok(Math.abs(e.length - 8 * Math.PI) < 1e-7));
  const blob = exportCadStep(mesh.cadBreps, 'Open cylinder', 'mm');
  assert.match(await blob.text(), /OPEN_SHELL/);
  assert.equal(reader.ReadStepFile(new Uint8Array(await blob.arrayBuffer()), null).success, true);
  shape.delete();
});

test('junctions are boolean unions with true local fillets and Remove produces a valid open STEP shell', async () => {
  const doc = fixture(true);
  const sharp = buildCadBody(oc, doc, evaluate(doc), false);
  doc.curves.forEach((c) => c.nodes.forEach((n) => (n.roundingDiameter = 100)));
  const legacy = buildCadBody(oc, doc, evaluate(doc), false);
  assert.deepEqual(
    legacy.cadEdges.map((e) => e.key),
    sharp.cadEdges.map((e) => e.key),
    'legacy per-node rounding must not affect Auto Sweep',
  );
  const edges = sharp.cadEdges.filter((e) => e.key.startsWith('BSPLINE_CURVE:')).map((e) => e.key);
  assert.equal(edges.length, 2);
  doc.fillets = [{ id: 'fillet', name: 'Fillet 1', radius: 1.5, edges }];
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))).fillets, doc.fillets);
  const smooth = buildCadBody(oc, doc, evaluate(doc), false);
  const sm = cad.deserializeShape(smooth.cadBreps[0]),
    sh = cad.deserializeShape(sharp.cadBreps[0]);
  assert.equal(smooth.bodies, 1);
  assert.ok(sm.faces.length > sh.faces.length, 'fillet introduces curved junction faces');
  const shell = buildCadBody(oc, doc, evaluate(doc), true);
  assert.equal(shell.bodies, 1);
  const shape = cad.deserializeShape(shell.cadBreps[0]);
  assert.equal(shape.solids.length, 0);
  assert.ok(
    shape.faces.every((f) => f.geomType !== 'PLANE'),
    'all and only original flat cap faces removed',
  );
  const blob = exportCadStep(shell.cadBreps, 'Open vessel', 'cm');
  assert.match(await blob.text(), /OPEN_SHELL/);
  assert.doesNotMatch(await blob.text(), /MANIFOLD_SOLID_BREP/);
  assert.equal(reader.ReadStepFile(new Uint8Array(await blob.arrayBuffer()), null).success, true);
  doc.fillets[0].suppressed = true;
  const suppressed = buildCadBody(oc, doc, evaluate(doc), false);
  const ss = cad.deserializeShape(suppressed.cadBreps[0]);
  assert.equal(ss.faces.length, sh.faces.length);
  doc.fillets[0].suppressed = false;
  doc.fillets[0].edges = ['missing'];
  assert.throws(() => buildCadBody(oc, doc, evaluate(doc), false), /selected edge changed/);
  ss.delete();
  sm.delete();
  sh.delete();
  shape.delete();
});

test('STEP centerlines retain the original NURBS for sweeping and document roundtrip', async () => {
  const text = await readFile('SampleFiles/Geom2_Centerline.STEP', 'utf8');
  const doc = importStepCurves(newDocument(), text, 'Geom2_Centerline.STEP').doc;
  assert.ok(doc.curves[0].sourceNurbs);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))).curves, doc.curves);
  doc.curves[0].nodes.forEach((n) => (n.diameter = 8));
  const mesh = buildCadBody(oc, doc, evaluate(doc), false);
  const shape = cad.deserializeShape(mesh.cadBreps[0]);
  assert.equal(mesh.bodies, 1);
  assert.ok(shape.faces.length < 10, 'original spline sweep avoids one face for each display chord');
  assert.ok(shape.faces.some((f) => f.geomType === 'BSPLINE_SURFACE'));
  const malformed = structuredClone(doc);
  malformed.curves[0].sourceNurbs.weights[0] = -1;
  assert.throws(() => validateDocument(malformed), /NURBS/);
  shape.delete();
});

test('exact spline guides and diameter transitions generate valid curved CAD surfaces', () => {
  const doc = fixture(false, 6);
  doc.pointSets[0].points[2].x = 12;
  doc.curves[0].nodes.forEach((n) => (n.connection = 'spline'));
  const mesh = buildCadBody(oc, doc, evaluate(doc), false);
  const shape = cad.deserializeShape(mesh.cadBreps[0]);
  assert.ok(shape.faces.some((f) => f.geomType === 'BSPLINE_SURFACE'));
  assert.ok(cad.measureVolume(shape) > 0);
  shape.delete();
});
