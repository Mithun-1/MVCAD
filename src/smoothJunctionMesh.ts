// Local, bounded geometry fairing. Both the welded solid and its display copy
// use the result; this is deliberately not a shading-only correction.
export function smoothJunctionMesh(
  positions: number[],
  indices: Uint32Array,
  sources: Uint32Array,
  vesselCount: number,
  cellSize: number,
  protectedVertices: ReadonlySet<number> = new Set(),
): Set<number> {
  const seeds = new Set<number>();
  for (let i = 0; i < indices.length; i++)
    if (sources[Math.floor(i / 3)] >= vesselCount) seeds.add(indices[i]);
  if (!seeds.size) return seeds;

  const neighbors = new Map<number, Set<number>>();
  const sharp = new Set<number>();
  const edges = new Map<number, number>();
  const count = positions.length / 3;
  for (let i = 0; i < indices.length; i += 3)
    for (let c = 0; c < 3; c++) {
      const a = indices[i + c],
        b = indices[i + ((c + 1) % 3)];
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      if (!neighbors.has(b)) neighbors.set(b, new Set());
      neighbors.get(a)!.add(b);
      neighbors.get(b)!.add(a);
      const key = Math.min(a, b) * count + Math.max(a, b),
        source = sources[i / 3];
      const previous = edges.get(key);
      if (previous !== undefined && sources[previous / 3] < vesselCount && source < vesselCount) {
        const u = cross(positions, previous),
          v = cross(positions, i);
        const dot = u.reduce((sum, value, c) => sum + value * v[c], 0);
        if (sources[previous / 3] !== source || dot < Math.hypot(...u) * Math.hypot(...v) * 0.5) {
          sharp.add(a);
          sharp.add(b);
        }
      }
      edges.set(key, i);
    }
  // Fade into the unchanged vessel wall, instead of creating a ring at the
  // boundary of the fillet patch. Explicit sharp intersections remain fixed.
  const weights = new Map<number, number>([...seeds].map((v) => [v, 1]));
  let frontier = [...seeds];
  for (let ring = 1; ring <= 3; ring++) {
    const next: number[] = [];
    for (const v of frontier)
      for (const n of neighbors.get(v)!)
        if (!weights.has(n)) {
          weights.set(n, (4 - ring) / 4);
          next.push(n);
        }
    frontier = next;
  }
  // End faces and the adjacent wall rings must retain their exact cut plane.
  let protectedRing = [...protectedVertices];
  for (let ring = 0; ring <= 2; ring++) {
    const next = new Set<number>();
    for (const v of protectedRing) {
      sharp.add(v);
      for (const n of neighbors.get(v) ?? []) if (!sharp.has(n)) next.add(n);
    }
    protectedRing = [...next];
  }
  for (const v of sharp) weights.delete(v);
  const active = [...weights.keys()];
  const original = positions.slice();
  const affectedFaces: number[] = [];
  for (let i = 0; i < indices.length; i += 3)
    if ([indices[i], indices[i + 1], indices[i + 2]].some((v) => weights.has(v))) affectedFaces.push(i);
  function cross(p: number[], i: number) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  }
  // Paired smoothing/inflation passes suppress cell-scale ripples while
  // limiting shrinkage. The maximum physical movement is below one cell.
  for (let pass = 0; pass < 16; pass++) {
    const proposed = positions.slice();
    const factor = pass % 2 === 0 ? 0.5 : -0.53;
    for (const v of active) {
      const adjacent = neighbors.get(v)!;
      const average = [0, 0, 0];
      for (const n of adjacent)
        for (let c = 0; c < 3; c++) average[c] += positions[n * 3 + c] / adjacent.size;
      for (let c = 0; c < 3; c++)
        proposed[v * 3 + c] += factor * weights.get(v)! * (average[c] - positions[v * 3 + c]);
      const distance = Math.hypot(...[0, 1, 2].map((c) => proposed[v * 3 + c] - original[v * 3 + c]));
      if (distance > cellSize * 0.75)
        for (let c = 0; c < 3; c++)
          proposed[v * 3 + c] =
            original[v * 3 + c] + ((proposed[v * 3 + c] - original[v * 3 + c]) * cellSize * 0.75) / distance;
    }
    // Clipped tetrahedra contain narrow triangles. Backtrack only vertices
    // beside a threatened face, so a sliver cannot stall the entire junction.
    const previousNormals = affectedFaces.map((i) => cross(positions, i));
    let accepted = false;
    for (let attempt = 0; attempt < 24; attempt++) {
      const backtrack = new Set<number>();
      affectedFaces.forEach((i, j) => {
        const n = cross(proposed, i),
          before = previousNormals[j];
        if (
          !(
            n.reduce((sum, value, c) => sum + value * before[c], 0) >=
            before.reduce((sum, value) => sum + value * value, 0) * 0.1
          )
        )
          for (let c = 0; c < 3; c++) if (weights.has(indices[i + c])) backtrack.add(indices[i + c]);
      });
      accepted = backtrack.size === 0;
      if (accepted) break;
      for (const v of backtrack)
        for (let c = 0; c < 3; c++) proposed[v * 3 + c] = (positions[v * 3 + c] + proposed[v * 3 + c]) / 2;
    }
    if (accepted)
      for (const v of active) for (let c = 0; c < 3; c++) positions[v * 3 + c] = proposed[v * 3 + c];
  }
  return new Set(active);
}
