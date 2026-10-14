import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDocument } from '../src/model.ts';
import { packProject, unpackProject } from '../src/projectAssets.ts';
import { exportProjectFile, importProjectFile } from '../src/projectFile.ts';

function project(positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])) {
  return {
    ...newDocument(),
    references: [{ id: 'guide', name: 'Guide', kind: 'stl', visible: true, opacity: 0.6, positions }],
  };
}

test('binary assets are reused for metadata edits and preserve legacy coordinate precision', async () => {
  const doc = project([0, 0, 0, 1 / 3, 0, 0, 0, 1, 0]);
  const first = await packProject(doc);
  const second = await packProject({ ...doc, references: [{ ...doc.references[0], opacity: 0.2 }] });
  assert.equal(first.assets[0], second.assets[0]);
  assert.equal(first.assets[0].encoding, 'f64');
  assert.equal(second.project.references[0].positions, undefined);
  const restored = await unpackProject(second.project, new Map(second.assets.map((a) => [a.id, a])));
  assert.deepEqual(Array.from(restored.references[0].positions), doc.references[0].positions);
  assert.equal(restored.references[0].opacity, 0.2);
  assert.equal((await packProject(restored)).assets[0], first.assets[0]);
  await assert.rejects(unpackProject(first.project, new Map()), /missing/);
});

test('compact MVCAD roundtrips references larger than the former 50 MB project limit', async () => {
  const positions = new Float32Array(1_500_000 * 9);
  positions[0] = 12.5;
  positions[positions.length - 1] = -42.25;
  const doc = project(positions);
  const file = await exportProjectFile(doc);
  assert.ok(file.size > 50_000_000);
  assert.ok(file.size < positions.byteLength + 5000);
  const restored = await importProjectFile(file);
  assert.equal(restored.references[0].positions.length, positions.length);
  assert.equal(restored.references[0].positions[0], 12.5);
  assert.equal(restored.references[0].positions.at(-1), -42.25);
});

test('project files accept legacy JSON and reject incomplete or invalid binary data', async () => {
  const legacy = project([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(await importProjectFile(new Blob([JSON.stringify(legacy)])), legacy);
  const plain = newDocument();
  assert.deepEqual(JSON.parse(await (await exportProjectFile(plain)).text()), plain);
  const binary = await exportProjectFile(project());
  await assert.rejects(importProjectFile(binary.slice(0, binary.size - 1)), /incomplete/);
  await assert.rejects(importProjectFile(new Blob([binary, 'unexpected'])), /Unexpected/);
  await assert.rejects(importProjectFile(new Blob(['MVCAD2\r\n'])), /Incomplete/);
  const bad = project(new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0]));
  await assert.rejects(importProjectFile(await exportProjectFile(bad)), /Invalid reference/);
});
