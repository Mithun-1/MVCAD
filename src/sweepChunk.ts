import type { SweepKernel } from './sweep.ts';

export type SweepChunkRequest = {
  id: number;
  module?: WebAssembly.Module;
  settings: Float64Array;
  segments: Float64Array;
  roundings: Float64Array;
  first: number;
  last: number;
};
export type SweepChunkResult = {
  id: number;
  positions: Float64Array;
  normals: Float32Array;
  renderNormals: Float32Array;
  renderVertices: Uint32Array;
  indices: Uint32Array;
  renderIndices: Uint32Array;
  first: number;
  last: number;
  sources: Uint32Array;
  caps: Uint32Array;
};

export function createSweepChunkRunner() {
  let kernel: Promise<SweepKernel> | undefined;
  return async (request: SweepChunkRequest): Promise<SweepChunkResult> => {
    kernel ??= WebAssembly.instantiate(request.module!, {}).then(
      (instance) => instance.exports as unknown as SweepKernel,
    );
    const api = await kernel;
    new Float64Array(api.memory.buffer, api.sweep_settings(), 8).set(request.settings);
    new Float64Array(api.memory.buffer, api.sweep_segments(), request.segments.length).set(request.segments);
    new Float64Array(api.memory.buffer, api.sweep_roundings(), request.roundings.length).set(
      request.roundings,
    );
    const count = api.build_sweep_slice(request.segments.length / 10, request.first, request.last);
    if (count < 0)
      throw new Error(
        count === -3
          ? 'Auto Sweep exceeds the surface mesh limit.'
          : 'A sweep grid section could not be generated.',
      );
    if (api.index_sweep() !== 0) throw new Error('A sweep section exceeds the indexed mesh limit.');
    const [unique, rendered, size] = new Uint32Array(api.memory.buffer, api.sweep_mesh_counts(), 5);
    return {
      id: request.id,
      first: request.first,
      last: request.last,
      positions: new Float64Array(api.memory.buffer, api.sweep_vertices(), unique * 3).slice(),
      normals: new Float32Array(api.memory.buffer, api.sweep_mesh_normals(), unique * 3).slice(),
      renderNormals: new Float32Array(api.memory.buffer, api.sweep_normals(), rendered * 3).slice(),
      renderVertices: new Uint32Array(api.memory.buffer, api.sweep_mesh_render_vertices(), rendered).slice(),
      indices: new Uint32Array(api.memory.buffer, api.sweep_mesh_indices(), size).slice(),
      renderIndices: new Uint32Array(api.memory.buffer, api.sweep_mesh_render_indices(), size).slice(),
      sources: new Uint32Array(api.memory.buffer, api.sweep_mesh_sources(), size / 3).slice(),
      caps: new Uint32Array(api.memory.buffer, api.sweep_mesh_caps(), size / 3).slice(),
    };
  };
}
