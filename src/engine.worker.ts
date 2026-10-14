import wasmUrl from '../engine/planes.wasm?url';
import type { SweepMesh } from './sweep';
import { getCadKernel } from './cadKernel';
import { buildCadBody } from './cadBody';
import { measureCadDistance } from './cadMeasure';
import type { MeasureSelection } from './measure';
import { BASE_PLANES, type EvaluatedPlane, type FilletFeature, type ReferencePlane } from './model';
import { MAX_POINTS, type PointSet, type EvaluatedPointSet } from './points';
import { suppressedFeatures, type CurveFeature, type EvaluatedCurve } from './curves';

type Kernel = {
  memory: WebAssembly.Memory;
  kernel_version: () => number;
  reset_model: () => void;
  create_offset_plane: (parent: number, offset: number) => number;
  plane_data: (handle: number) => number;
  point_buffer: () => number;
  validate_points: (count: number) => number;
  curve_modes: () => number;
  curve_data: () => number;
  evaluate_curve: (count: number) => number;
};

const kernel = (async () => {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error('The CAD engine could not be downloaded.');
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const result = instance.exports as unknown as Kernel;
  if (result.kernel_version() !== 1) throw new Error('Unsupported CAD engine version.');
  return result;
})();
let cachedKey = '';
let cachedBody: SweepMesh | undefined;
let lastRegeneration = 0;

self.onmessage = async (
  event: MessageEvent<{
    sequence: number;
    planes: ReferencePlane[];
    preview?: ReferencePlane;
    pointSets?: PointSet[];
    pointPreview?: PointSet;
    curves?: CurveFeature[];
    fillets?: FilletFeature[];
    filletPreview?: FilletFeature;
    curvePreview?: CurveFeature;
    autoSweep?: boolean;
    removeCaps?: boolean;
    regeneration?: number;
    measureRequest?: number;
    selections?: MeasureSelection[];
  }>,
) => {
  if (event.data.measureRequest !== undefined) {
    const measureRequest = event.data.measureRequest;
    try {
      await getCadKernel();
      if (!cachedBody?.cadBreps || event.data.selections?.length !== 2)
        throw new Error('Select two available objects.');
      self.postMessage({
        measureRequest,
        result: measureCadDistance(cachedBody.cadBreps, event.data.selections),
      });
    } catch (error) {
      self.postMessage({
        measureRequest,
        measureError: error instanceof Error ? error.message : 'Measurement failed.',
      });
    }
    return;
  }
  const { sequence, planes, preview, pointSets = [], pointPreview, curves = [], curvePreview } = event.data;
  try {
    const api = await kernel;
    api.reset_model();
    const handles = new Map<string, number>(BASE_PLANES.map((p, i) => [p.id, i]));
    const read = (id: string, handle: number): EvaluatedPlane => ({
      id,
      frame: Array.from(new Float64Array(api.memory.buffer, api.plane_data(handle), 12)),
    });
    const geometry = BASE_PLANES.map((p, i) => read(p.id, i));
    const effectiveSets = [
      ...pointSets.filter((p) => p.id !== pointPreview?.id),
      ...(pointPreview ? [pointPreview] : []),
    ];
    const suppressed = suppressedFeatures({ planes, pointSets: effectiveSets, curves });
    for (const p of [...planes, ...(preview ? [preview] : [])]) {
      if (suppressed.has(p.id) || suppressed.has(p.parentId)) continue;
      const parent = handles.get(p.parentId);
      if (parent === undefined) throw new Error(`Missing reference for ${p.name}.`);
      const handle = api.create_offset_plane(parent, p.offset);
      if (handle < 0)
        throw new Error(handle === -3 ? 'Plane limit reached.' : `Invalid geometry for ${p.name}.`);
      handles.set(p.id, handle);
      geometry.push(read(p.id, handle));
    }
    const points: EvaluatedPointSet[] = [];
    for (const set of effectiveSets) {
      if (suppressed.has(set.id)) continue;
      if (set.points.length > MAX_POINTS) throw new Error('Too many points.');
      const packed = new Float64Array(api.memory.buffer, api.point_buffer(), set.points.length * 3);
      set.points.forEach((p, i) => {
        packed[i * 3] = p.x;
        packed[i * 3 + 1] = p.y;
        packed[i * 3 + 2] = p.z;
      });
      if (api.validate_points(set.points.length) !== 0)
        throw new Error(`Invalid coordinates in ${set.name}.`);
      points.push({ id: set.id, positions: packed.slice() });
    }
    const pointLookup = new Map(
      effectiveSets.map((set) => [set.id, new Map(set.points.map((p) => [p.id, p]))]),
    );
    const evaluatedCurves: EvaluatedCurve[] = [];
    for (const curve of [
      ...curves.filter((c) => c.id !== curvePreview?.id),
      ...(curvePreview ? [curvePreview] : []),
    ]) {
      if (suppressed.has(curve.id) || curve.suppressed) continue;
      const packed = new Float64Array(api.memory.buffer, api.point_buffer(), curve.nodes.length * 3);
      const modes = new Int32Array(api.memory.buffer, api.curve_modes(), curve.nodes.length);
      let valid = curve.nodes.length >= 2;
      curve.nodes.forEach((node, i) => {
        const point = node.point && pointLookup.get(node.point.setId)?.get(node.point.pointId);
        if (!point || (node.point && suppressed.has(node.point.setId))) {
          valid = false;
          return;
        }
        packed.set([point.x, point.y, point.z], i * 3);
        modes[i] = node.connection === 'spline' ? 1 : 0;
      });
      if (!valid) continue;
      const count = api.evaluate_curve(curve.nodes.length);
      if (count < 0) throw new Error(`Invalid curve: ${curve.name}.`);
      evaluatedCurves.push({
        id: curve.id,
        positions: new Float64Array(api.memory.buffer, api.curve_data(), count * 3).slice(),
        // Match the kernel's emitted samples; split the existing result, never refit splines.
        nodeOffsets: curve.nodes.reduce<number[]>((offsets, node, i) => {
          offsets.push(i === 0 ? 0 : offsets[i - 1] + (node.connection === 'spline' ? 24 : 1));
          return offsets;
        }, []),
      });
    }
    let sweep: SweepMesh | undefined, sweepError: string | undefined;
    let filletPreviewReady = false;
    if (event.data.autoSweep) {
      try {
        const progress = (value: number) => self.postMessage({ sequence, progress: value });
        progress(0);
        const cad = await getCadKernel();
        const key = JSON.stringify([
          curves,
          event.data.fillets,
          evaluatedCurves.map((c) => [c.id, Array.from(c.positions)]),
          !!event.data.removeCaps,
        ]);
        if ((event.data.regeneration ?? 0) !== lastRegeneration) {
          lastRegeneration = event.data.regeneration ?? 0;
          cachedKey = '';
          cachedBody = undefined;
        }
        if (cachedKey !== key || !cachedBody) {
          cachedBody = undefined;
          cachedKey = '';
          cachedBody = buildCadBody(
            cad,
            { planes, pointSets: effectiveSets, curves, fillets: event.data.fillets },
            evaluatedCurves,
            !!event.data.removeCaps,
            progress,
          );
          cachedKey = key;
        }
        sweep = cachedBody;
        const draft = event.data.filletPreview;
        if (
          draft?.edges.length &&
          Number.isFinite(draft.radius) &&
          draft.radius > 0 &&
          draft.radius <= 1000000
        ) {
          // Keep the unrounded topology available for picking additional edges and
          // removing selections. The preview never replaces the committed cache.
          const rounded = buildCadBody(
            cad,
            { planes, pointSets: effectiveSets, curves, fillets: [...(event.data.fillets ?? []), draft] },
            evaluatedCurves,
            !!event.data.removeCaps,
            progress,
          );
          sweep = { ...rounded, cadEdges: cachedBody.cadEdges };
          filletPreviewReady = true;
        }
      } catch (error) {
        sweepError = error instanceof Error ? error.message : 'Auto Sweep failed.';
      }
    }
    self.postMessage(
      { sequence, geometry, points, curves: evaluatedCurves, sweep, sweepError, filletPreviewReady },
      {
        // Keep the cached sweep buffers intact. Structured cloning copies them
        // for the UI; reference-plane/point/curve buffers remain transferable.
        transfer: [...points, ...evaluatedCurves].map((p) => p.positions.buffer),
      },
    );
  } catch (error) {
    self.postMessage({ sequence, error: error instanceof Error ? error.message : 'CAD engine failed.' });
  }
};
