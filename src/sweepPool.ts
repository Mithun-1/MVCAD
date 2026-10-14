import type { SweepKernel } from './sweep.ts';
import type { SweepChunkRequest, SweepChunkResult } from './sweepChunk.ts';

export type WorkerLike = {
  postMessage: (message: SweepChunkRequest) => void;
  terminate: () => void;
  onmessage: ((event: { data: SweepChunkResult & { error?: string } }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
};
type Job = {
  request: SweepChunkRequest;
  resolve: (value: SweepChunkResult) => void;
  reject: (reason: Error) => void;
};

// Workers own independent kernel scratch memory. Only immutable input and
// indexed buffers cross threads; slice boundaries are welded during assembly.
export class SweepPool {
  private sequence = 0;
  private module: WebAssembly.Module;
  private queue: Job[] = [];
  private failure?: Error;
  private slots: { worker: WorkerLike; initialized: boolean; job?: Job }[];
  constructor(module: WebAssembly.Module, factory: () => WorkerLike, count = 4) {
    this.module = module;
    this.slots = Array.from({ length: count }, () => ({ worker: factory(), initialized: false }));
    for (const slot of this.slots) {
      slot.worker.onmessage = ({ data }) => {
        const job = slot.job;
        if (!job || data.id !== job.request.id) return;
        slot.job = undefined;
        if (data.error) job.reject(new Error(data.error));
        else job.resolve(data);
        this.dispatch();
      };
      slot.worker.onerror = ({ message }) => this.stop(new Error(message));
    }
  }
  private dispatch() {
    if (this.failure) return;
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      if (!slot.initialized) {
        job.request.module = this.module;
        slot.initialized = true;
      }
      try {
        slot.worker.postMessage(job.request);
      } catch (error) {
        this.stop(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }
  async generate(
    api: SweepKernel,
    count: number,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<() => { size: number; indexed: boolean }> {
    if (this.failure) throw this.failure;
    const settings = new Float64Array(api.memory.buffer, api.sweep_settings(), 8).slice();
    const segments = new Float64Array(api.memory.buffer, api.sweep_segments(), count * 10).slice();
    const roundings = new Float64Array(api.memory.buffer, api.sweep_roundings(), settings[7] * 7).slice();
    const cells = settings[6] - 1,
      jobs = Math.min(this.slots.length, cells),
      pending: Promise<SweepChunkResult>[] = [];
    let completed = 0;
    for (let i = 0; i < jobs; i++)
      pending.push(
        new Promise((resolve, reject) => {
          this.queue.push({
            request: {
              id: ++this.sequence,
              settings,
              segments,
              roundings,
              first: Math.floor((i * cells) / jobs),
              last: Math.floor(((i + 1) * cells) / jobs),
            },
            resolve: (result) => {
              onProgress?.(++completed, jobs);
              resolve(result);
            },
            reject,
          });
        }),
      );
    this.dispatch();
    const chunks = await Promise.all(pending);
    const totals = chunks.reduce(
      (sum, c) => [
        sum[0] + c.positions.length / 3,
        sum[1] + c.renderVertices.length,
        sum[2] + c.indices.length,
      ],
      [0, 0, 0],
    );
    if (totals.some((value) => value > 3000000))
      throw new Error('Auto Sweep exceeds the surface mesh limit.');
    return () => {
      // Assembly and finalization run synchronously together in the caller.
      // Other messages may have prepared different inputs while these jobs ran.
      new Float64Array(api.memory.buffer, api.sweep_settings(), 8).set(settings);
      const status = api.begin_merge_sweep(segments[(count - 1) * 10 + 8] + 1, totals[0]);
      if (status < 0) return { size: status, indexed: true };
      let v = 0,
        r = 0,
        i = 0;
      for (const chunk of chunks) {
        new Float64Array(api.memory.buffer, api.sweep_vertices() + v * 24, chunk.positions.length).set(
          chunk.positions,
        );
        new Float32Array(api.memory.buffer, api.sweep_mesh_normals() + v * 12, chunk.normals.length).set(
          chunk.normals,
        );
        new Float32Array(api.memory.buffer, api.sweep_normals() + r * 12, chunk.renderNormals.length).set(
          chunk.renderNormals,
        );
        new Uint32Array(
          api.memory.buffer,
          api.sweep_mesh_render_vertices() + r * 4,
          chunk.renderVertices.length,
        ).set(chunk.renderVertices);
        new Uint32Array(api.memory.buffer, api.sweep_merge_indices() + i * 4, chunk.indices.length).set(
          chunk.indices,
        );
        new Uint32Array(
          api.memory.buffer,
          api.sweep_merge_render_indices() + i * 4,
          chunk.renderIndices.length,
        ).set(chunk.renderIndices);
        new Uint32Array(api.memory.buffer, api.sweep_sources() + (i / 3) * 4, chunk.sources.length).set(
          chunk.sources,
        );
        new Uint32Array(api.memory.buffer, api.sweep_caps() + (i / 3) * 4, chunk.caps.length).set(chunk.caps);
        const merged = api.merge_sweep_chunk(
          chunk.positions.length / 3,
          chunk.renderVertices.length,
          chunk.indices.length,
          chunk.first * settings[3],
          chunk.last * settings[3],
        );
        if (merged < 0) return { size: merged, indexed: true };
        [v, r, i] = new Uint32Array(api.memory.buffer, api.sweep_mesh_counts(), 3);
      }
      const finished = api.finish_merge_sweep();
      return { size: finished < 0 ? finished : i, indexed: true };
    };
  }
  private stop(error: Error) {
    this.failure = error;
    for (const job of this.queue.splice(0)) job.reject(error);
    for (const slot of this.slots) {
      slot.job?.reject(error);
      slot.job = undefined;
      slot.worker.terminate();
    }
  }
  dispose() {
    this.stop(new Error('Sweep workers were disposed.'));
  }
}
