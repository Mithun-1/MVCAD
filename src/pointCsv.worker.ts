import { parsePointFile } from './points';

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const points = parsePointFile(await event.data.text(), event.data.name);
    self.postMessage({ points });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not read the point file.' });
  }
};
