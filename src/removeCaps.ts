import type { SweepMesh } from './sweep.ts';

// Delete faces from both solid and display index buffers. Keep the common
// vertex positions, smooth junctions, body identities, and wall topology.
export function removeEndCaps(mesh: SweepMesh): SweepMesh {
  let removed = 0;
  for (const cap of mesh.endCapTriangles) if (cap) removed++;
  const faceCount = mesh.indices.length / 3 - removed;
  const indices = new Uint32Array(faceCount * 3),
    renderIndices = new Uint32Array(faceCount * 3),
    sources = new Uint32Array(faceCount);
  let cursor = 0;
  const bodyRanges = mesh.bodyRanges.map((range) => {
    const start = cursor;
    const end = (range.start + range.count) / 3;
    for (let face = range.start / 3; face < end; ) {
      while (face < end && mesh.endCapTriangles[face]) face++;
      const first = face;
      while (face < end && !mesh.endCapTriangles[face]) face++;
      if (face === first) continue;
      indices.set(mesh.indices.subarray(first * 3, face * 3), cursor);
      renderIndices.set(mesh.renderIndices.subarray(first * 3, face * 3), cursor);
      sources.set(mesh.surfaceIds.subarray(first, face), cursor / 3);
      cursor += (face - first) * 3;
    }
    return { ...range, start, count: cursor - start };
  });
  return {
    ...mesh,
    indices,
    renderIndices,
    surfaceIds: sources,
    endCapTriangles: new Uint8Array(sources.length),
    bodyRanges,
    surfaceShell: true,
    removedCapTriangles: removed,
  };
}
