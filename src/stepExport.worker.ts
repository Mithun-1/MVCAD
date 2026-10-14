import { exportCadStep, type ExportUnit } from './stepExport';
import { getCadKernel } from './cadKernel';
self.onmessage = async (event: MessageEvent<{ breps: string[]; name: string; unit: ExportUnit }>) => {
  try {
    self.postMessage({ progress: 0.05 });
    await getCadKernel();
    self.postMessage({ progress: 0.3 });
    const { breps, name, unit } = event.data;
    const blob = exportCadStep(breps, name, unit);
    self.postMessage({ progress: 1, blob });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'The CAD kernel could not export STEP.',
    });
  }
};
