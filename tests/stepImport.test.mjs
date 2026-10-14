import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { newDocument, validateDocument } from '../src/model.ts';
import { importStepCurves, STEP_CHORD_TOLERANCE } from '../src/stepImport.ts';
import {
  curveSections,
  curveJunctions,
  assignSectionDiameter,
  assignSectionSweepSetting,
  sectionRoundingJunctions,
} from '../src/curves.ts';

const step = (body) => `ISO-10303-21; HEADER; ENDSEC; DATA; ${body} ENDSEC; END-ISO-10303-21;`;
const branch = step(`
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(10.,0.,0.));
#3=CARTESIAN_POINT('',(5.,0.,0.));
#4=CARTESIAN_POINT('',(5.,5.,0.));
#5=POLYLINE('Main',(#1,#2));
#6=POLYLINE('Branch',(#3,#4));
#7=GEOMETRIC_CURVE_SET('',(#5,#6));
`);

test('SolidWorks sample imports all 33 curves, shares its 22 junctions, and preserves document persistence', async () => {
  const text = await readFile(new URL('../SampleFiles/Geom2_Centerline.STEP', import.meta.url), 'utf8');
  const original = newDocument();
  original.planes.push({ id: 'plane', name: 'Existing plane', parentId: 'front', offset: 8, visible: true });
  const result = importStepCurves(original, text, 'Geom2_Centerline.STEP');
  assert.equal(result.curveIds.length, 33);
  assert.equal(result.sectionCount, 33, 'sample is already segmented at its junctions');
  assert.equal(curveJunctions(result.doc, curveSections(result.doc)).size, 22);
  assert.equal(original.curves.length, 0, 'input document is not mutated');
  assert.deepEqual(result.doc.planes, original.planes);
  const points = result.doc.pointSets[0];
  assert.equal(points.visible, false, 'sampling points do not clutter the viewport');
  assert.ok(points.points.every((p) => Math.abs(p.y - 18.75) < 1e-10));
  assert.ok(points.points.some((p) => Math.abs(p.x - 275) < 1e-10 && Math.abs(p.z) < 1e-10));
  assert.ok(
    result.doc.curves.every((c) => c.nodes.every((n) => n.connection === 'line' && n.diameter === undefined)),
  );
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(result.doc))), result.doc);
  const second = importStepCurves(result.doc, text, 'Geom2_Centerline.STEP');
  assert.equal(second.doc.curves.length, 66);
  assert.equal(new Set(second.doc.curves.map((c) => c.name)).size, 66);
});

test('endpoint-to-interior branches create subcurves with shared diameter/rounding workflow; crossings stay separate', () => {
  let { doc, sectionCount } = importStepCurves(newDocument(), branch, 'junction.stp');
  assert.equal(sectionCount, 3);
  const sections = curveSections(doc);
  assert.deepEqual(
    sections.map((s) => [s.start, s.end]),
    [
      [0, 1],
      [1, 2],
      [0, 1],
    ],
  );
  assert.equal(curveJunctions(doc, sections).size, 1);
  doc.curves[0] = assignSectionDiameter(doc.curves[0], sections[0], 8);
  assert.equal(doc.curves[0].nodes[1].diameter, 8);
  assert.equal(doc.curves[0].nodes[2].diameter, undefined);
  doc = assignSectionSweepSetting(doc, sections[0], 'roundingDiameter', 4);
  assert.ok(sections.every((s) => sectionRoundingJunctions(doc, sections, s)[0].diameter === 4));
  const crossed = importStepCurves(newDocument(), branch.replace('(5.,0.,0.)', '(5.,-5.,0.)'), 'cross.stp');
  assert.equal(curveJunctions(crossed.doc, curveSections(crossed.doc)).size, 0);
  const nearMiss = importStepCurves(newDocument(), branch.replace('(5.,0.,0.)', '(5.,0.001,0.)'), 'gap.stp');
  assert.equal(curveJunctions(nearMiss.doc, curveSections(nearMiss.doc)).size, 0);
});

test('rational B-spline weights, adaptive chords and SI unit normalization preserve a quarter circle', () => {
  const input = step(`
#1=CARTESIAN_POINT('',(1.,0.,0.)); #2=CARTESIAN_POINT('',(1.,1.,0.)); #3=CARTESIAN_POINT('',(0.,1.,0.));
#4=(BOUNDED_CURVE() B_SPLINE_CURVE(2,(#1,#2,#3),.UNSPECIFIED.,.F.,.F.) B_SPLINE_CURVE_WITH_KNOTS((3,3),(0.,1.),.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_CURVE((1.,0.7071067811865476,1.)) REPRESENTATION_ITEM('Circle'));
#5=GEOMETRIC_CURVE_SET('',(#4));
#6=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));
`);
  const result = importStepCurves(newDocument(), input, 'circle.step');
  const points = result.doc.pointSets[0].points;
  assert.ok(points.length > 8);
  for (const p of points) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 1) < 1e-12);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    assert.ok(1 - Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2) < STEP_CHORD_TOLERANCE);
  }
  const metres = importStepCurves(newDocument(), input.replace('SI_UNIT(.MILLI.', 'SI_UNIT($'), 'metres.stp');
  assert.equal(metres.doc.pointSets[0].points[0].x, 1000);
});

test('trimmed lines use parameters and orientation; malformed or unsupported imports fail atomically', () => {
  const input = step(`
#1=CARTESIAN_POINT('',(1.,2.,3.)); #2=DIRECTION('',(2.,0.,0.)); #3=VECTOR('',#2,10.);
#4=LINE('',#1,#3); #5=TRIMMED_CURVE('',#4,(PARAMETER_VALUE(0.2)),(PARAMETER_VALUE(0.8)),.F.,.PARAMETER.);
#6=GEOMETRIC_CURVE_SET('',(#5));
`);
  const result = importStepCurves(newDocument(), input, 'line.stp');
  assert.deepEqual(
    result.doc.pointSets[0].points.map(({ x, y, z }) => [x, y, z].map((v) => Math.round(v * 1e10) / 1e10)),
    [
      [9, 2, 3],
      [3, 2, 3],
    ],
  );
  const doc = newDocument(),
    before = structuredClone(doc);
  assert.throws(() => importStepCurves(doc, 'not STEP', 'bad.stp'), /STEP/);
  assert.throws(
    () =>
      importStepCurves(doc, branch.replace("POLYLINE('Main'", "UNSUPPORTED_CURVE('Main'"), 'unsupported.stp'),
    /Unsupported STEP curve/,
  );
  assert.throws(() => importStepCurves(doc, branch.replace('#1,#2', '#1,#999'), 'bad.stp'), /Missing STEP/);
  assert.throws(
    () =>
      importStepCurves(
        doc,
        branch.replace('ENDSEC; END-ISO', '#8=MAPPED_ITEM(#5,#6); ENDSEC; END-ISO'),
        'assembly.stp',
      ),
    /assembly/,
  );
  assert.deepEqual(doc, before);
});
