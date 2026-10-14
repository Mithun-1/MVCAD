import { useEffect, useRef, useState } from 'react';
import { FileOutput, X } from 'lucide-react';
import type { SweepMesh } from './sweep';
import type { ExportUnit } from './stepExport';

export function ExportBody({
  mesh,
  name,
  disabled,
  onExport,
  onExportDocument,
}: {
  mesh?: SweepMesh;
  name: string;
  disabled: boolean;
  onExport: (message: string) => void;
  onExportDocument: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'mvcad' | 'step'>('mvcad');
  const [unit, setUnit] = useState<ExportUnit>('mm');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const worker = useRef<Worker | null>(null);
  const close = () => {
    worker.current?.terminate();
    worker.current = null;
    setExporting(false);
    setOpen(false);
  };
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    worker.current?.terminate();
    worker.current = null;
    setExporting(false);
    return () => worker.current?.terminate();
  }, [mesh]);
  const start = () => {
    if (format === 'mvcad') {
      onExportDocument();
      onExport('Exported MVCAD document.');
      close();
      return;
    }
    if (!mesh?.cadBreps?.length || disabled || exporting) return;
    setError('');
    setProgress(0);
    setExporting(true);
    const finishError = (message: string) => {
      worker.current?.terminate();
      worker.current = null;
      setError(message);
      setExporting(false);
    };
    try {
      const task = new Worker(new URL('./stepExport.worker.ts', import.meta.url), { type: 'module' });
      worker.current = task;
      task.onmessage = (event: MessageEvent<{ progress?: number; blob?: Blob; error?: string }>) => {
        if (event.data.error) return finishError(event.data.error);
        if (event.data.progress !== undefined) setProgress(event.data.progress);
        if (event.data.blob) {
          const url = URL.createObjectURL(event.data.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${name.replace(/[^a-zA-Z0-9 _-]/g, '_') || 'MVCAD'}${mesh.surfaceShell ? '_surface' : ''}.step`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          onExport(
            `Exported ${mesh.bodyRanges.length} ${mesh.surfaceShell ? 'surface' : 'solid'} ${mesh.bodyRanges.length === 1 ? 'body' : 'bodies'} to STEP (${unit}).`,
          );
          close();
        }
      };
      task.onerror = () => finishError('The STEP exporter could not finish. Try again with fewer bodies.');
      task.postMessage({ breps: mesh.cadBreps, name, unit });
    } catch (e) {
      finishError(e instanceof Error ? e.message : 'Could not start STEP export.');
    }
  };
  return (
    <>
      <button
        aria-label="Export"
        title="Export MVCAD document or CAD bodies"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        <FileOutput size={18} />
      </button>
      <dialog
        ref={dialog}
        className="body-export-dialog"
        aria-labelledby="body-export-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="view-tool-heading">
          <h2 id="body-export-title">Export</h2>
          <button aria-label="Close export" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <label>
          File format
          <select
            aria-label="Export format"
            value={format}
            disabled={exporting}
            onChange={(e) => {
              setFormat(e.target.value as 'mvcad' | 'step');
              setError('');
            }}
          >
            <option value="mvcad">MVCAD (.mvcad)</option>
            <option value="step">STEP (.step)</option>
            <option value="parasolid" disabled>
              Parasolid (.x_t) — unavailable
            </option>
          </select>
        </label>
        {format === 'mvcad' ? (
          <p>Save the complete editable part, including points, curves, settings, and feature definitions.</p>
        ) : (
          <>
            <p>
              STEP (.step) · {mesh?.bodyRanges.length ?? 0} {mesh?.surfaceShell ? 'surface' : 'solid'} bodies
            </p>
            <label>
              Model units
              <select
                aria-label="Export units"
                value={unit}
                disabled={exporting}
                onChange={(e) => setUnit(e.target.value as ExportUnit)}
              >
                <option value="mm">Millimeters (mm)</option>
                <option value="cm">Centimeters (cm)</option>
                <option value="m">Meters (m)</option>
              </select>
            </label>
            <p className="field-hint">One model unit will equal one selected unit.</p>
            <p>Exports the generated B-Rep bodies with smooth trimmed CAD surfaces (STEP AP214).</p>
            <p className="field-hint">
              Section cuts, reference planes, and centerlines are excluded. Removed end caps stay open.
            </p>
            {!mesh?.cadBreps?.length && (
              <p className="field-hint">Generate a body with Auto Sweep to export STEP.</p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {exporting && (
          <div role="status" className="body-export-progress">
            Exporting STEP… {Math.round(progress * 100)}%
            <progress aria-label="STEP export progress" max={1} value={progress} />
          </div>
        )}
        <div className="form-actions">
          <button className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={exporting || (format === 'step' && (disabled || !mesh?.cadBreps?.length))}
            onClick={start}
          >
            {format === 'mvcad' ? 'Export MVCAD' : 'Export STEP'}
          </button>
        </div>
      </dialog>
    </>
  );
}
