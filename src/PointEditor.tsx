import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Check, Crosshair, Plus, Trash2, Upload, X } from 'lucide-react';
import { BASE_PLANES, planeName, type Document } from './model';
import { coordinate, MAX_POINTS, type DatumPoint, type PointSet } from './points';

type Row = { id: string; name: string; x: string; y: string; z: string };
const rowFromPoint = (p: DatumPoint): Row => ({ ...p, x: String(p.x), y: String(p.y), z: String(p.z) });
const emptyRow = (name: string): Row => ({ id: crypto.randomUUID(), name, x: '0', y: '0', z: '0' });
const PAGE_SIZE = 50;
type Props = {
  doc: Document;
  id: string;
  initial?: PointSet;
  busy: boolean;
  engineError: string;
  onPreview: (set: PointSet | undefined) => void;
  onSave: (set: PointSet) => void;
  onCancel: () => void;
};

export function PointEditor({ doc, id, initial, busy, engineError, onPreview, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(() => {
    const names = [
      ...BASE_PLANES.map((p) => planeName(doc, p.id)),
      ...doc.planes.map((p) => p.name),
      ...doc.pointSets.map((p) => p.name),
      ...doc.curves.map((p) => p.name),
      ...(doc.groups ?? []).map((p) => p.name),
    ];
    let n = 1;
    while (names.some((name) => name.toLowerCase() === `point set ${n}`)) n++;
    return {
      name: initial?.name ?? `Point set ${n}`,
      rows: initial?.points.map(rowFromPoint) ?? [emptyRow('P1')],
      sourceFiles: initial?.sourceFiles ?? [],
    };
  });
  const [page, setPage] = useState(0);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [importError, setImportError] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const csvWorker = useRef<Worker | null>(null);
  useEffect(() => () => csvWorker.current?.terminate(), []);
  const pristine = useRef(!initial);
  const remaining =
    MAX_POINTS - doc.pointSets.filter((set) => set.id !== id).reduce((n, set) => n + set.points.length, 0);
  const evaluation = useMemo(() => {
    try {
      const name = draft.name.trim();
      if (!name) throw new Error('Enter a point-set name.');
      const names = [
        'origin',
        ...BASE_PLANES.map((p) => planeName(doc, p.id).toLowerCase()),
        ...doc.planes.map((p) => p.name.toLowerCase()),
        ...doc.pointSets.filter((p) => p.id !== id).map((p) => p.name.toLowerCase()),
        ...doc.curves.map((p) => p.name.toLowerCase()),
        ...(doc.groups ?? []).map((p) => p.name.toLowerCase()),
      ];
      if (names.includes(name.toLowerCase())) throw new Error('A feature with this name already exists.');
      if (!draft.rows.length) throw new Error('Add at least one point or import a CSV or PTS file.');
      if (draft.rows.length > remaining)
        throw new Error(`This document has room for ${remaining.toLocaleString()} points in this set.`);
      const pointNames = new Set<string>();
      const points = draft.rows.map((row, index) => {
        try {
          if (!row.name.trim()) throw new Error('Enter a point name.');
          if (pointNames.has(row.name.trim().toLowerCase()))
            throw new Error('Point names must be unique within this set.');
          pointNames.add(row.name.trim().toLowerCase());
          return {
            id: row.id,
            name: row.name.trim(),
            x: coordinate(row.x),
            y: coordinate(row.y),
            z: coordinate(row.z),
          };
        } catch (error) {
          throw new Error(`Row ${index + 1}: ${(error as Error).message}`);
        }
      });
      const remainingIds = new Set(points.map((p) => p.id));
      if (
        doc.curves.some((curve) =>
          curve.nodes.some((n) => n.point?.setId === id && !remainingIds.has(n.point.pointId)),
        )
      )
        throw new Error('A removed point is referenced by a curve. Edit or delete that curve first.');
      return {
        set: {
          id,
          name,
          points,
          visible: initial?.visible ?? true,
          suppressed: initial?.suppressed,
          sourceFiles: draft.sourceFiles,
        },
        error: '',
      };
    } catch (error) {
      return { set: undefined, error: (error as Error).message };
    }
  }, [draft, doc, id, initial, remaining]);
  useEffect(() => {
    onPreview(evaluation.set);
  }, [evaluation, onPreview]);
  useEffect(() => () => onPreview(undefined), [onPreview]);
  const pageCount = Math.max(1, Math.ceil(draft.rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const updateRow = (rowId: string, key: keyof Omit<Row, 'id'>, value: string) => {
    setImportError('');
    pristine.current = false;
    setDraft((d) => ({
      ...d,
      rows: d.rows.map((row) => (row.id === rowId ? { ...row, [key]: value } : row)),
    }));
  };
  const swapCoordinates = (a: 'x' | 'y' | 'z', b: 'x' | 'y' | 'z') => {
    if (draft.rows.some((row) => row[a] !== row[b])) pristine.current = false;
    setDraft((d) => ({
      ...d,
      rows: d.rows.map((row) => ({ ...row, [a]: row[b], [b]: row[a] })),
    }));
    setMessage(
      `Swapped ${a.toUpperCase()} and ${b.toUpperCase()} for all ${draft.rows.length.toLocaleString()} points.`,
    );
  };

  return (
    <form
      className="point-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (evaluation.set && !busy && !importing && !engineError) onSave(evaluation.set);
      }}
    >
      <div className="panel-heading">
        <h2>Offset Coordinate System</h2>
        <button type="button" className="icon-button" aria-label="Cancel points" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>
      <div className="point-editor-heading">
        <Crosshair size={20} />
        <div>
          <strong>Datum points</strong>
          <p>Define points with Cartesian coordinates.</p>
        </div>
      </div>
      <div className="point-definition">
        <label htmlFor="point-set-name">Feature name</label>
        <input
          id="point-set-name"
          autoFocus
          maxLength={60}
          value={draft.name}
          disabled={importing}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <dl>
          <dt>Reference</dt>
          <dd>
            <Crosshair size={12} /> Origin (0, 0, 0)
          </dd>
          <dt>Type</dt>
          <dd>Cartesian</dd>
        </dl>
      </div>
      <div className="point-table-heading">
        <span>POINT COORDINATES</span>
        <span>{draft.rows.length.toLocaleString()} points</span>
      </div>
      <div className="point-coordinate-tools" role="group" aria-label="Swap coordinates for all points">
        <span>Swap all</span>
        {(
          [
            ['x', 'y'],
            ['x', 'z'],
            ['y', 'z'],
          ] as const
        ).map(([a, b]) => (
          <button
            key={`${a}${b}`}
            type="button"
            className="secondary-button"
            aria-label={`Swap ${a.toUpperCase()} and ${b.toUpperCase()}`}
            title={`Swap ${a.toUpperCase()} and ${b.toUpperCase()} for every point in this set`}
            disabled={importing || !draft.rows.length}
            onClick={() => swapCoordinates(a, b)}
          >
            {a.toUpperCase()}
            <ArrowLeftRight size={12} />
            {b.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="point-table-scroll">
        <table className="point-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>X</th>
              <th>Y</th>
              <th>Z</th>
              <th>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((row, index) => {
              const number = currentPage * PAGE_SIZE + index + 1;
              return (
                <tr key={row.id}>
                  {(['name', 'x', 'y', 'z'] as const).map((key) => (
                    <td key={key}>
                      <input
                        aria-label={`Point ${number} ${key === 'name' ? 'name' : key.toUpperCase()}`}
                        maxLength={key === 'name' ? 60 : 32}
                        inputMode={key === 'name' ? 'text' : 'decimal'}
                        value={row[key]}
                        disabled={importing}
                        onChange={(e) => updateRow(row.id, key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      aria-label={`Remove point ${number}`}
                      disabled={importing}
                      onClick={() => {
                        pristine.current = false;
                        setDraft((d) => ({ ...d, rows: d.rows.filter((p) => p.id !== row.id) }));
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!draft.rows.length && (
          <p className="point-table-empty">Add a point below or import XYZ coordinates.</p>
        )}
      </div>
      <div className="point-table-actions">
        <button
          type="button"
          disabled={importing || draft.rows.length >= remaining}
          onClick={() => {
            pristine.current = false;
            let n = draft.rows.length + 1;
            const names = new Set(draft.rows.map((row) => row.name.trim().toLowerCase()));
            while (names.has(`p${n}`)) n++;
            setPage(Math.floor(draft.rows.length / PAGE_SIZE));
            setDraft((d) => ({ ...d, rows: [...d.rows, emptyRow(`P${n}`)] }));
          }}
        >
          <Plus size={14} />
          Add point
        </button>
        {pageCount > 1 && (
          <div className="point-pagination">
            <button
              type="button"
              aria-label="Previous points"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              ‹
            </button>
            <span>
              {currentPage + 1} / {pageCount}
            </span>
            <button
              type="button"
              aria-label="Next points"
              disabled={currentPage === pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              ›
            </button>
          </div>
        )}
      </div>
      <div className="point-feedback">
        {(importError || evaluation.error || engineError) && (
          <p className="form-error" role="alert">
            {importError || evaluation.error || engineError}
          </p>
        )}
        {message && !importError && <p role="status">{message}</p>}
        <p className="field-hint">
          {busy ? 'Updating preview…' : 'Dimensionless coordinates, relative to the origin.'}
        </p>
      </div>
      <div className="point-import-bar">
        <button
          type="button"
          className="secondary-button"
          disabled={importing}
          onClick={() => importInput.current?.click()}
        >
          <Upload size={14} />
          {importing ? 'Importing…' : 'Import Points'}
        </button>
        <span>
          CSV: x, y, z (optional name)
          <br />
          PTS: x y z
        </span>
      </div>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="primary-button"
          disabled={!evaluation.set || busy || importing || !!engineError}
        >
          <Check size={15} />
          {initial ? 'Apply changes' : 'Create points'}
        </button>
      </div>
      <input
        type="file"
        aria-label="Import point file"
        accept=".csv,.pts,text/csv"
        hidden
        ref={importInput}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setImporting(true);
          setImportError('');
          setMessage('');
          try {
            if (file.size > 20_000_000) throw new Error('Point files must be smaller than 20 MB.');
            // Point parsing and numeric validation stay off the UI thread.
            const points = await new Promise<DatumPoint[]>((resolve, reject) => {
              const worker = new Worker(new URL('./pointCsv.worker.ts', import.meta.url), { type: 'module' });
              csvWorker.current = worker;
              worker.onmessage = (event: MessageEvent<{ points?: DatumPoint[]; error?: string }>) => {
                worker.terminate();
                csvWorker.current = null;
                if (event.data.error) reject(new Error(event.data.error));
                else resolve(event.data.points!);
              };
              worker.onerror = () => {
                worker.terminate();
                csvWorker.current = null;
                reject(new Error('The point reader could not start. Try importing again.'));
              };
              worker.postMessage(file);
            });
            const existing = pristine.current ? [] : draft.rows;
            if (existing.length + points.length > remaining)
              throw new Error(
                `Import would exceed the document limit of ${MAX_POINTS.toLocaleString()} points.`,
              );
            const names = new Set(existing.map((row) => row.name.trim().toLowerCase()));
            const suffixes = new Map<string, number>();
            const imported = points.map((p) => {
              let name = p.name,
                n = suffixes.get(p.name.toLowerCase()) ?? 2;
              while (names.has(name.toLowerCase())) {
                const suffix = `_${n++}`;
                name = p.name.slice(0, 60 - suffix.length) + suffix;
              }
              names.add(name.toLowerCase());
              suffixes.set(p.name.toLowerCase(), n);
              return rowFromPoint({ ...p, name });
            });
            setDraft((d) => ({
              ...d,
              rows: [...existing, ...imported],
              sourceFiles: [...d.sourceFiles, file.name],
            }));
            pristine.current = false;
            setPage(Math.floor(existing.length / PAGE_SIZE));
            setMessage(`Imported ${points.length.toLocaleString()} points from ${file.name}.`);
          } catch (error) {
            setImportError((error as Error).message);
          } finally {
            setImporting(false);
          }
        }}
      />
    </form>
  );
}
