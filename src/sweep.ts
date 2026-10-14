import {
  curveSections,
  curveJunctions,
  junctionRoundingDiameter,
  pointReferenceKey,
  resolvePoint,
  type EvaluatedCurve,
} from './curves.ts';
import type { Document } from './model.ts';
import { cylinderSweep } from './cylinderSweep.ts';

export type SweepMesh = {
  cadFaces?: import('./measure').CadFaceMeasurement[];
  cadBreps?: string[];
  cadEdges?: { key: string; positions: Float32Array; body: number }[];
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  renderPositions: Float32Array;
  renderNormals: Float32Array;
  renderIndices: Uint32Array;
  surfaceIds: Uint32Array;
  endCapTriangles: Uint8Array;
  surfaceShell?: boolean;
  removedCapTriangles?: number;
  creases: Float32Array;
  origin: number[];
  cellSize: number;
  bodies: number;
  bodyRanges: { start: number; count: number; creaseStart: number; creaseCount: number }[];
  skipped: number;
};
export type SweepKernel = {
  memory: WebAssembly.Memory;
  sweep_settings: () => number;
  sweep_segments: () => number;
  sweep_vertices: () => number;
  sweep_normals: () => number;
  sweep_sources: () => number;
  sweep_caps: () => number;
  index_sweep: () => number;
  finish_sweep: () => number;
  sweep_mesh_creases: () => number;
  sweep_mesh_crease_ranges: () => number;
  sweep_mesh_counts: () => number;
  sweep_mesh_indices: () => number;
  sweep_mesh_render_indices: () => number;
  sweep_mesh_sources: () => number;
  sweep_mesh_caps: () => number;
  sweep_mesh_ranges: () => number;
  sweep_mesh_normals: () => number;
  sweep_mesh_render_positions: () => number;
  sweep_field: () => number;
  sweep_roundings: () => number;
  build_sweep: (count: number) => number;
  begin_merge_sweep: (groups: number, vertices: number) => number;
  merge_sweep_chunk: (
    vertices: number,
    rendered: number,
    indices: number,
    lower: number,
    upper: number,
  ) => number;
  finish_merge_sweep: () => number;
  sweep_merge_indices: () => number;
  sweep_merge_render_indices: () => number;
  sweep_mesh_render_vertices: () => number;
  build_sweep_slice: (count: number, first: number, last: number) => number;
  assemble_sweep: (count: number, sourceCount: number) => number;
};
type Path = { positions: number[]; radii: number[]; curveId: string; nodeStart: number; nodeEnd: number };
type Rounding = { a: number; b: number; center: number[]; radius: number; support: number };

// Transition distances are measured along the evaluated master, not along a chord.
export function sweepPaths(
  doc: Pick<Document, 'planes' | 'pointSets' | 'curves'>,
  evaluated: EvaluatedCurve[],
) {
  const sections = curveSections(doc);
  const paths: Path[] = [];
  let skipped = 0;
  for (const curve of doc.curves) {
    const geometry = evaluated.find((g) => g.id === curve.id);
    if (!geometry) continue;
    const { positions: p, nodeOffsets } = geometry;
    const distance = new Float64Array(p.length / 3);
    for (let i = 1; i < distance.length; i++)
      distance[i] =
        distance[i - 1] +
        Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]);
    const spans = sections.filter((s) => s.curveId === curve.id);
    for (const section of spans)
      if (curve.nodes.slice(section.start + 1, section.end + 1).some((n) => !n.diameter)) skipped++;
    const transitions: { start: number; end: number; a: number; b: number }[] = [];
    for (let i = 1; i < curve.nodes.length - 1; i++) {
      const a = curve.nodes[i].diameter,
        b = curve.nodes[i + 1].diameter;
      if (!a || !b || a === b) continue;
      const left = spans.find((s) => s.end === i),
        right = spans.find((s) => s.start === i);
      const at = distance[nodeOffsets[i]];
      const leftLength = at - distance[nodeOffsets[left?.start ?? i - 1]];
      const rightLength = distance[nodeOffsets[right?.end ?? i + 1]] - at;
      const endCutoff = left ? (curve.nodes[i].endCutoff ?? 10) : 10;
      const startCutoff = right ? (curve.nodes[i].startCutoff ?? 10) : 10;
      transitions.push({
        start: at - (leftLength * endCutoff) / 100,
        end: at + (rightLength * startCutoff) / 100,
        a: a / 2,
        b: b / 2,
      });
    }
    let path: Path | undefined;
    for (let node = 1; node < curve.nodes.length; node++) {
      const diameter = curve.nodes[node].diameter;
      if (!diameter) {
        path = undefined;
        continue;
      }
      if (transitions.some((t) => t.start === t.end && t.start === distance[nodeOffsets[node - 1]]))
        path = undefined;
      if (!path) {
        path = { positions: [], radii: [], curveId: curve.id, nodeStart: node - 1, nodeEnd: node };
        paths.push(path);
      }
      path.nodeEnd = node;
      const radiusAt = (s: number) => {
        const transition = transitions.find((t) => s >= t.start && s <= t.end && t.end > t.start);
        if (!transition) return diameter / 2;
        const t = (s - transition.start) / (transition.end - transition.start);
        return transition.a + (transition.b - transition.a) * t * t * (3 - 2 * t);
      };
      const first = nodeOffsets[node - 1],
        last = nodeOffsets[node];
      if (!path.radii.length) {
        path.positions.push(p[first * 3], p[first * 3 + 1], p[first * 3 + 2]);
        path.radii.push(radiusAt(distance[first]));
      }
      for (let i = first + 1; i <= last; i++) {
        const length = distance[i] - distance[i - 1];
        if (length < 1e-12) continue;
        const localRadius = Math.min(diameter / 2, radiusAt(distance[i - 1]), radiusAt(distance[i]));
        const steps = Math.max(1, Math.ceil(length / (localRadius * 0.5)));
        if (steps > 200000 || path.radii.length + steps > 200000)
          throw new Error(
            'Auto Sweep exceeds the centerline sampling limit. Increase very small diameters or shorten the paths.',
          );
        // Include exact transition boundaries even on a long straight guide segment.
        const samples = Array.from({ length: steps }, (_, j) => (j + 1) / steps);
        for (const transition of transitions)
          for (const boundary of [transition.start, transition.end])
            if (boundary > distance[i - 1] && boundary < distance[i])
              samples.push((boundary - distance[i - 1]) / length);
        samples.sort((a, b) => a - b);
        let previous = -1;
        for (const t of samples) {
          if (t * length < 1e-10) continue;
          if (Math.abs(t - previous) < 1e-12) continue;
          previous = t;
          for (let c = 0; c < 3; c++)
            path.positions.push(p[(i - 1) * 3 + c] + t * (p[i * 3 + c] - p[(i - 1) * 3 + c]));
          path.radii.push(radiusAt(distance[i - 1] + t * length));
        }
      }
    }
  }
  return { paths: paths.filter((p) => p.radii.length > 1), skipped };
}

export function sweepRoundings(
  doc: Pick<Document, 'planes' | 'pointSets' | 'curves'>,
  paths: Path[],
): Rounding[] {
  const roundings: Rounding[] = [];
  const curves = new Map(doc.curves.map((curve) => [curve.id, curve]));
  for (const [key, junction] of curveJunctions(doc, curveSections(doc))) {
    const radius = junctionRoundingDiameter(doc, junction.point) / 2;
    if (!radius) continue;
    const point = resolvePoint(doc, junction.point);
    if (!point) continue;
    const groups = paths.flatMap((path, i) =>
      curves
        .get(path.curveId)!
        .nodes.slice(path.nodeStart, path.nodeEnd + 1)
        .some((node) => node.point && pointReferenceKey(node.point) === key)
        ? [i]
        : [],
    );
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i],
          b = groups[j];
        // Zero cutoffs can split one master into capped paths. Keep that
        // intentional diameter step sharp; round connections between vessels.
        if (paths[a].curveId === paths[b].curveId) continue;
        const vesselRadius = Math.max(
          paths[a].radii.reduce((m, r) => Math.max(m, r), 0),
          paths[b].radii.reduce((m, r) => Math.max(m, r), 0),
        );
        roundings.push({
          a,
          b,
          center: [point.x, point.y, point.z],
          radius,
          support: vesselRadius * 3 + radius * 4,
        });
      }
  }
  if (roundings.length > 8192) throw new Error('Too many rounded vessel connections for Auto Sweep.');
  return roundings;
}

function prepareSweep(
  api: SweepKernel,
  doc: Pick<Document, 'planes' | 'pointSets' | 'curves'>,
  evaluated: EvaluatedCurve[],
): SweepMesh | { count: number; origin: number[]; step: number; skipped: number } {
  const { paths, skipped } = sweepPaths(doc, evaluated);
  // Collinear constant-radius spans describe the very same capsule union.
  // Keep every bend and every diameter transition, but avoid subdividing lines
  // into dozens of identical distance queries.
  for (const path of paths) {
    const positions: number[] = [],
      radii: number[] = [];
    for (let i = 0; i < path.radii.length; i++) {
      if (
        radii.length >= 2 &&
        radii[radii.length - 1] === path.radii[i] &&
        radii[radii.length - 2] === path.radii[i]
      ) {
        const n = positions.length,
          ax = positions[n - 3] - positions[n - 6],
          ay = positions[n - 2] - positions[n - 5],
          az = positions[n - 1] - positions[n - 4];
        const bx = path.positions[i * 3] - positions[n - 3],
          by = path.positions[i * 3 + 1] - positions[n - 2],
          bz = path.positions[i * 3 + 2] - positions[n - 1];
        const cross2 = (ay * bz - az * by) ** 2 + (az * bx - ax * bz) ** 2 + (ax * by - ay * bx) ** 2;
        if (
          ax * bx + ay * by + az * bz > 0 &&
          cross2 <= 1e-24 * (ax * ax + ay * ay + az * az) * (bx * bx + by * by + bz * bz)
        ) {
          positions.length -= 3;
          radii.pop();
        }
      }
      positions.push(path.positions[i * 3], path.positions[i * 3 + 1], path.positions[i * 3 + 2]);
      radii.push(path.radii[i]);
    }
    path.positions = positions;
    path.radii = radii;
  }
  const roundings = sweepRoundings(doc, paths);
  if (
    paths.length === 1 &&
    paths[0].radii.length === 2 &&
    paths[0].radii[0] === paths[0].radii[1] &&
    Number.isFinite(paths[0].radii[0]) &&
    paths[0].radii[0] > 0
  ) {
    return cylinderSweep(
      paths[0].positions.slice(0, 3),
      paths[0].positions.slice(3, 6),
      paths[0].radii[0],
      skipped,
    );
  }
  if (!paths.length)
    return {
      positions: new Float32Array(),
      normals: new Float32Array(),
      indices: new Uint32Array(),
      renderPositions: new Float32Array(),
      renderNormals: new Float32Array(),
      renderIndices: new Uint32Array(),
      surfaceIds: new Uint32Array(),
      endCapTriangles: new Uint8Array(),
      creases: new Float32Array(),
      origin: [0, 0, 0],
      cellSize: 0,
      bodies: 0,
      bodyRanges: [],
      skipped,
    };
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity];
  let minRadius = Infinity,
    count = 0;
  for (const path of paths) {
    count += path.radii.length - 1;
    path.radii.forEach((r, i) => {
      minRadius = Math.min(minRadius, r);
      for (let c = 0; c < 3; c++) {
        low[c] = Math.min(low[c], path.positions[i * 3 + c] - r);
        high[c] = Math.max(high[c], path.positions[i * 3 + c] + r);
      }
    });
  }
  if (count > 200000) throw new Error('Auto Sweep exceeds the centerline sampling limit.');
  let step = minRadius / 8;
  for (const rounding of roundings) {
    step = Math.min(step, rounding.radius / 4);
  }
  const roundingPadding = roundings.reduce((m, r) => Math.max(m, r.radius * 2), 0);
  for (let c = 0; c < 3; c++) {
    low[c] -= roundingPadding;
    high[c] += roundingPadding;
  }
  if (
    !Number.isFinite(step) ||
    step <= 0 ||
    !low.every(Number.isFinite) ||
    !high.every(Number.isFinite) ||
    low.some((v, c) => !Number.isFinite(high[c] - v))
  )
    throw new Error('The assigned diameters exceed the numeric range supported by Auto Sweep.');
  const dimensions = () => low.map((v, c) => Math.ceil((high[c] - v) / step) + 7);
  let dims = dimensions();
  while (dims[0] * dims[1] * dims[2] > 12000000) {
    step *= 1.15;
    dims = dimensions();
  }
  if (step > minRadius / 2.5)
    throw new Error(
      'The model extent is too large for its smallest diameter at the current sweep resolution.',
    );
  if (roundings.some((rounding) => step > rounding.radius / 2))
    throw new Error(
      'The rounding diameter is too small for this model’s sweep resolution. Increase it or set it to 0.',
    );
  const origin = low.map((v) => v - step * 3.13);
  new Float64Array(api.memory.buffer, api.sweep_settings(), 8).set([
    ...origin,
    step,
    ...dims,
    roundings.length,
  ]);
  new Float64Array(api.memory.buffer, api.sweep_roundings(), roundings.length * 7).set(
    roundings.flatMap((r) => [r.a, r.b, ...r.center, r.radius, r.support]),
  );
  // Only unconnected, open endpoints are removable boundary faces.
  const caps = paths.map((path) => {
    const last = path.radii.length - 1;
    if ([0, 1, 2].every((c) => path.positions[c] === path.positions[last * 3 + c])) return [];
    return [0, last].flatMap((end) => {
      const endpoint = doc.curves.find((c) => c.id === path.curveId)!.nodes[
        end === 0 ? path.nodeStart : path.nodeEnd
      ].point;
      const internal = paths.some(
        (p) =>
          p !== path &&
          p.curveId === path.curveId &&
          (end === 0 ? p.nodeEnd === path.nodeStart : p.nodeStart === path.nodeEnd),
      );
      const joined =
        endpoint &&
        paths.some(
          (p) =>
            p !== path &&
            p.curveId !== path.curveId &&
            doc.curves
              .find((c) => c.id === p.curveId)!
              .nodes.slice(p.nodeStart, p.nodeEnd + 1)
              .some((node) => node.point && pointReferenceKey(node.point) === pointReferenceKey(endpoint)),
        );
      if (internal || joined) return [];
      return [{ end: end === 0 ? 0 : 1 }];
    });
  });
  const segments = new Float64Array(api.memory.buffer, api.sweep_segments(), count * 10);
  let offset = 0;
  paths.forEach((path, group) => {
    const internalStart = paths.some(
      (p) => p !== path && p.curveId === path.curveId && p.nodeEnd === path.nodeStart,
    );
    const internalEnd = paths.some(
      (p) => p !== path && p.curveId === path.curveId && p.nodeStart === path.nodeEnd,
    );
    for (let i = 1; i < path.radii.length; i++) {
      segments.set(
        [
          ...path.positions.slice((i - 1) * 3, i * 3),
          path.radii[i - 1],
          ...path.positions.slice(i * 3, i * 3 + 3),
          path.radii[i],
          group,
          (i === 1 ? 1 | (internalStart ? 4 : 0) | (caps[group].some((c) => c.end === 0) ? 16 : 0) : 0) |
            (i === path.radii.length - 1
              ? 2 | (internalEnd ? 8 : 0) | (caps[group].some((c) => c.end === 1) ? 32 : 0)
              : 0),
        ],
        offset,
      );
      offset += 10;
    }
  });
  return { count, origin, step, skipped };
}
export function buildSweep(
  api: SweepKernel,
  doc: Pick<Document, 'planes' | 'pointSets' | 'curves'>,
  evaluated: EvaluatedCurve[],
): SweepMesh {
  const input = prepareSweep(api, doc, evaluated);
  if ('indices' in input) return input;
  return finishSweep(api, api.build_sweep(input.count), input);
}
export async function buildSweepAsync(
  api: SweepKernel,
  doc: Pick<Document, 'planes' | 'pointSets' | 'curves'>,
  evaluated: EvaluatedCurve[],
  generate: (api: SweepKernel, count: number) => Promise<number | (() => { size: number; indexed: boolean })>,
): Promise<SweepMesh> {
  const input = prepareSweep(api, doc, evaluated);
  if ('indices' in input) return input;
  const result = await generate(api, input.count);
  const generated = typeof result === 'function' ? result() : { size: result, indexed: false };
  return finishSweep(api, generated.size, input, generated.indexed);
}
function finishSweep(
  api: SweepKernel,
  size: number,
  { origin, step, skipped }: { origin: number[]; step: number; skipped: number },
  indexed = false,
): SweepMesh {
  if (size <= 0)
    throw new Error(
      size === -3
        ? 'Auto Sweep exceeds the surface mesh limit.'
        : 'Auto Sweep could not create a solid from these centerlines.',
    );
  if (!indexed && api.index_sweep() !== 0) throw new Error('Auto Sweep exceeds the indexed mesh limit.');
  if (api.finish_sweep() !== 0) throw new Error('Auto Sweep exceeds the crease mesh limit.');
  const [vertexCount, renderCount, indexCount, bodyCount, creaseCount] = new Uint32Array(
    api.memory.buffer,
    api.sweep_mesh_counts(),
    5,
  );
  const positions = new Float32Array(
    new Float64Array(api.memory.buffer, api.sweep_vertices(), vertexCount * 3),
  );
  const normals = new Float32Array(api.memory.buffer, api.sweep_mesh_normals(), vertexCount * 3).slice();
  const renderPositions = new Float32Array(
    api.memory.buffer,
    api.sweep_mesh_render_positions(),
    renderCount * 3,
  ).slice();
  const renderNormals = new Float32Array(api.memory.buffer, api.sweep_normals(), renderCount * 3).slice();
  const grouped = new Uint32Array(api.memory.buffer, api.sweep_mesh_indices(), indexCount).slice();
  const groupedRender = new Uint32Array(
    api.memory.buffer,
    api.sweep_mesh_render_indices(),
    indexCount,
  ).slice();
  const surfaceIds = new Uint32Array(api.memory.buffer, api.sweep_mesh_sources(), indexCount / 3).slice();
  const capIds = new Uint32Array(api.memory.buffer, api.sweep_mesh_caps(), indexCount / 3);
  const endCapTriangles = new Uint8Array(capIds.length);
  for (let i = 0; i < capIds.length; i++) endCapTriangles[i] = capIds[i] ? 1 : 0;
  const ranges = new Uint32Array(api.memory.buffer, api.sweep_mesh_ranges(), bodyCount * 2);
  const bodyRanges: SweepMesh['bodyRanges'] = Array.from({ length: bodyCount }, (_, i) => ({
    start: ranges[i * 2],
    count: ranges[i * 2 + 1],
    creaseStart: 0,
    creaseCount: 0,
  }));
  const creaseRanges = new Uint32Array(api.memory.buffer, api.sweep_mesh_crease_ranges(), bodyCount * 2);
  for (let i = 0; i < bodyCount; i++) {
    bodyRanges[i].creaseStart = creaseRanges[i * 2];
    bodyRanges[i].creaseCount = creaseRanges[i * 2 + 1];
  }
  const creases = new Float32Array(api.memory.buffer, api.sweep_mesh_creases(), creaseCount).slice();
  return {
    positions,
    normals,
    indices: grouped,
    renderPositions,
    renderNormals,
    renderIndices: groupedRender,
    surfaceIds,
    endCapTriangles,
    creases,
    origin,
    cellSize: step,
    bodies: bodyRanges.length,
    bodyRanges,
    skipped,
  };
}
