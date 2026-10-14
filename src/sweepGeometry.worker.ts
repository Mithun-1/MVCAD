import { createSweepChunkRunner, type SweepChunkRequest } from './sweepChunk.ts';

const run = createSweepChunkRunner();
self.onmessage = async ({ data }: MessageEvent<SweepChunkRequest>) => {
  try {
    const result = await run(data);
    self.postMessage(result, {
      transfer: [
        result.positions.buffer,
        result.normals.buffer,
        result.renderNormals.buffer,
        result.renderVertices.buffer,
        result.indices.buffer,
        result.renderIndices.buffer,
        result.sources.buffer,
        result.caps.buffer,
      ],
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : 'Sweep generation failed.',
    });
  }
};
