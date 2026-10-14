import { parentPort } from 'node:worker_threads';
import { createSweepChunkRunner } from '../src/sweepChunk.ts';
const run = createSweepChunkRunner();
parentPort.on('message', async (request) => {
  try {
    const result = await run(request);
    parentPort.postMessage(result, [
      result.positions.buffer,
      result.renderNormals.buffer,
      result.renderVertices.buffer,
      result.indices.buffer,
      result.renderIndices.buffer,
      result.normals.buffer,
      result.sources.buffer,
      result.caps.buffer,
    ]);
  } catch (error) {
    parentPort.postMessage({ id: request.id, error: error.message });
  }
});
