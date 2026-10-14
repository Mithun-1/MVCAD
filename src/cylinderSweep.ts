import type { SweepMesh } from './sweep.ts';

// A straight, constant-radius guide has an analytic cylinder surface. Sampling
// a 3D distance grid adds no geometric information to this special case.
export function cylinderSweep(start: number[], end: number[], radius: number, skipped: number): SweepMesh {
  const delta = end.map((v, c) => v - start[c]);
  const length = Math.hypot(...delta);
  if (
    !Number.isFinite(length) ||
    length <= 0 ||
    !Number.isFinite(radius * 2) ||
    radius / 8 <= 0 ||
    radius * 2 > 3.4e38 ||
    length > 3.4e38
  )
    throw new Error('The assigned cylinder dimensions exceed the numeric range supported by Auto Sweep.');
  const tangent = delta.map((v) => v / length);
  const axis = Math.abs(tangent[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const dot = axis.reduce((sum, v, c) => sum + v * tangent[c], 0);
  const u = axis.map((v, c) => v - dot * tangent[c]);
  const unit = Math.hypot(...u);
  for (let c = 0; c < 3; c++) u[c] /= unit;
  const v = [
    tangent[1] * u[2] - tangent[2] * u[1],
    tangent[2] * u[0] - tangent[0] * u[2],
    tangent[0] * u[1] - tangent[1] * u[0],
  ];
  const around = 128,
    along = Math.max(1, Math.min(512, Math.ceil(length / (radius * 2))));
  const wallVertices = (along + 1) * around,
    vertexCount = wallVertices + 2,
    renderCount = vertexCount + 2 * around;
  const positions = new Float32Array(vertexCount * 3),
    normals = new Float32Array(vertexCount * 3);
  const renderPositions = new Float32Array(renderCount * 3),
    renderNormals = new Float32Array(renderCount * 3);
  const origin = start.map((a, c) => Math.min(a, end[c]) - radius);
  for (let j = 0; j <= along; j++)
    for (let i = 0; i < around; i++) {
      const theta = (i * Math.PI * 2) / around,
        cos = Math.cos(theta),
        sin = Math.sin(theta),
        id = j * around + i;
      for (let c = 0; c < 3; c++) {
        const n = u[c] * cos + v[c] * sin;
        positions[id * 3 + c] = start[c] + (delta[c] * j) / along + radius * n - origin[c];
        normals[id * 3 + c] = n;
      }
    }
  for (let cap = 0; cap < 2; cap++)
    for (let c = 0; c < 3; c++) {
      positions[(wallVertices + cap) * 3 + c] = (cap ? end : start)[c] - origin[c];
      normals[(wallVertices + cap) * 3 + c] = (cap ? 1 : -1) * tangent[c];
    }
  renderPositions.set(positions);
  renderNormals.set(normals);
  for (let cap = 0; cap < 2; cap++)
    for (let i = 0; i < around; i++)
      for (let c = 0; c < 3; c++) {
        renderPositions[(vertexCount + cap * around + i) * 3 + c] =
          positions[(cap * along * around + i) * 3 + c];
        renderNormals[(vertexCount + cap * around + i) * 3 + c] = (cap ? 1 : -1) * tangent[c];
      }
  const faceCount = 2 * around * (along + 1),
    indices = new Uint32Array(faceCount * 3),
    renderIndices = new Uint32Array(faceCount * 3),
    endCapTriangles = new Uint8Array(faceCount);
  let cursor = 0;
  for (let j = 0; j < along; j++)
    for (let i = 0; i < around; i++) {
      const a = j * around + i,
        b = j * around + ((i + 1) % around),
        c = a + around,
        d = b + around;
      indices.set([a, b, d, a, d, c], cursor);
      renderIndices.set([a, b, d, a, d, c], cursor);
      cursor += 6;
    }
  for (let cap = 0; cap < 2; cap++)
    for (let i = 0; i < around; i++) {
      const a = cap ? i : (i + 1) % around,
        b = cap ? (i + 1) % around : i;
      indices.set([wallVertices + cap, cap * along * around + a, cap * along * around + b], cursor);
      renderIndices.set(
        [wallVertices + cap, vertexCount + cap * around + a, vertexCount + cap * around + b],
        cursor,
      );
      endCapTriangles[cursor / 3] = 1;
      cursor += 3;
    }
  const creases = new Float32Array(around * 2 * 6);
  cursor = 0;
  for (let cap = 0; cap < 2; cap++)
    for (let i = 0; i < around; i++)
      for (const at of [i, (i + 1) % around])
        for (let c = 0; c < 3; c++) creases[cursor++] = positions[(cap * along * around + at) * 3 + c];
  return {
    positions,
    normals,
    indices,
    renderPositions,
    renderNormals,
    renderIndices,
    endCapTriangles,
    surfaceIds: new Uint32Array(faceCount),
    creases,
    origin,
    cellSize: radius / 8,
    bodies: 1,
    bodyRanges: [{ start: 0, count: indices.length, creaseStart: 0, creaseCount: creases.length / 3 }],
    skipped,
  };
}
