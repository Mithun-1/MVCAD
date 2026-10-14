import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointCsv, parsePointFile, parsePointPts, coordinate } from '../src/points.ts';
import { newDocument, validateDocument } from '../src/model.ts';
import { readFile } from 'node:fs/promises';

test('point display skipping survives file validation without removing source or curve references', () => {
  const doc = newDocument();
  doc.pointSets = [
    {
      id: 'cloud',
      name: 'Cloud',
      visible: true,
      sourceFiles: [],
      skipPoints: 2,
      points: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, x: i, y: 0, z: 0 })),
    },
  ];
  doc.curves = [
    {
      id: 'curve',
      name: 'Curve',
      visible: true,
      nodes: [1, 5].map((i) => ({
        id: `n${i}`,
        point: { setId: 'cloud', pointId: `p${i}` },
        connection: 'line',
      })),
    },
  ];
  const restored = validateDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored.pointSets, doc.pointSets);
  assert.deepEqual(restored.curves, doc.curves);
  for (const invalid of [-1, 1.5, '2', null, Infinity, 100001]) {
    doc.pointSets[0].skipPoints = invalid;
    assert.throws(() => validateDocument(doc), /Invalid point set/);
  }
  delete doc.pointSets[0].skipPoints;
  assert.equal(validateDocument(doc).pointSets[0].skipPoints, undefined);
});

test('CSV accepts headers, reordered named columns, BOM, quoting, CRLF and scientific notation', () => {
  const named = parsePointCsv(
    '\uFEFFZ,Name,X,Y\r\n-3,"Left, top",1.5,2e2\r\n\r\n0,"A ""quoted"" point",-1,0.25',
  );
  assert.deepEqual(
    named.map(({ id, ...p }) => p),
    [
      { name: 'Left, top', x: 1.5, y: 200, z: -3 },
      { name: 'A "quoted" point', x: -1, y: 0.25, z: 0 },
    ],
  );
  assert.deepEqual(
    parsePointCsv('1,2,3\n4,5,6').map((p) => [p.x, p.y, p.z]),
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
  );
  assert.equal(parsePointCsv('x,y,z\n0,0,0\n').length, 1);
});

test('PTS accepts whitespace XYZ centerlines, optional counts, and preserves coordinate order', () => {
  const expected = [
    { name: 'P1', x: 0, y: 21, z: 73.5 },
    { name: 'P2', x: -1.5, y: 200, z: 0 },
  ];
  for (const prefix of ['', '\uFEFF2\r\n']) {
    const points = parsePointFile(
      prefix + '0.000000 21.000000 73.500000\r\n\r\n -1.5\t2e2  0\n',
      'CENTERLINE.PTS',
    );
    assert.deepEqual(
      points.map(({ id, ...p }) => p),
      expected,
    );
    assert.equal(new Set(points.map((p) => p.id)).size, 2);
  }
  assert.equal(parsePointFile('1,2,3', 'points.csv')[0].z, 3);
  for (const text of ['', '0', '2\n1 2 3', '1 2', '1 2 3 4', '1 NaN 3', '1 1000001 3', '1,2,3'])
    assert.throws(() => parsePointPts(text));
  assert.throws(() => parsePointPts('0 1 2\n3 bad 5'), /Line 2/);
  assert.throws(() => parsePointFile('1 2 3', 'points.xyz'), /Only CSV and PTS/);
});

test('malformed CSV and non-finite, missing, or out-of-range coordinates fail atomically', () => {
  for (const csv of [
    '',
    'x,y,z',
    'x,y,x\n1,2,3',
    'x,y,z\n1,,3',
    '1,2,3\n4,5',
    '1,2,3,4',
    '1,2,3\n,,',
    '1,Infinity,3',
    '1,NaN,3',
    '1,1000001,3',
    'name,x,y,z\n"open,1,2,3',
    'name,x,y,z\n"a"x,1,2,3',
  ])
    assert.throws(() => parsePointCsv(csv));
  for (const value of ['', ' ', '0xff', 'Infinity', '1,000', '-1000001'])
    assert.throws(() => coordinate(value));
  assert.equal(coordinate(' -1.25e-2 '), -0.0125);
});

test('point sets roundtrip independently and older documents migrate without points', () => {
  const doc = newDocument();
  const { pointSets, ...legacy } = doc;
  assert.deepEqual(validateDocument(legacy).pointSets, []);
  const points = parsePointCsv('1,2,3\n4,5,6');
  const set = { id: 'set1', name: 'Imported points', points, visible: true, sourceFiles: ['survey.csv'] };
  const saved = { ...doc, pointSets: [set, { ...set, id: 'set2', name: 'Manual points', sourceFiles: [] }] };
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(saved))), saved);
  for (const patch of [
    { id: 'top' },
    { name: 'Front Plane' },
    { points: [] },
    { points: [{ ...points[0], x: NaN }] },
    { points: [points[0], points[0]] },
    { sourceFiles: ['x'.repeat(256)] },
  ])
    assert.throws(() => validateDocument({ ...doc, pointSets: [{ ...set, ...patch }] }));
  assert.throws(() => validateDocument({ ...doc, pointSets: null }));
});

test('C++ validates Cartesian point batches without losing float64 precision', async () => {
  const { instance } = await WebAssembly.instantiate(
    await readFile(new URL('../engine/planes.wasm', import.meta.url)),
    {},
  );
  const api = instance.exports;
  const buffer = new Float64Array(api.memory.buffer, api.point_buffer(), 300000);
  buffer.set([1.123456789123, -0.125, 1000000, 0, 0, 0]);
  assert.equal(api.validate_points(2), 0);
  assert.equal(buffer[0], 1.123456789123);
  buffer[4] = NaN;
  assert.equal(api.validate_points(2), 2);
  buffer[4] = 1000001;
  assert.equal(api.validate_points(2), 2);
  assert.equal(api.validate_points(100001), -1);
  assert.equal(api.validate_points(-1), -1);
  buffer.fill(0);
  assert.equal(api.validate_points(100000), 0);
});
