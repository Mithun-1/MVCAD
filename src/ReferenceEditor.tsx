import { X } from 'lucide-react';
import { planeName, type Document, type EvaluatedPlane } from './model';
import { validateReference, type ReferenceAsset } from './references';

export function ReferenceEditor({
  asset,
  doc,
  geometry,
  sizing,
  onSizing,
  onChange,
  onPlane,
  onApply,
  onCancel,
}: {
  asset: ReferenceAsset;
  doc: Document;
  geometry: EvaluatedPlane[];
  sizing: boolean;
  onSizing: (v: boolean) => void;
  onChange: (v: ReferenceAsset) => void;
  onPlane: (id: string) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  let error = '';
  try {
    validateReference(asset, new Set(geometry.map((p) => p.id)));
  } catch (e) {
    error = (e as Error).message;
  }
  const frame = asset.kind === 'image' ? geometry.find((p) => p.id === asset.planeId)?.frame : undefined;
  return (
    <form
      className="reference-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!error) onApply();
      }}
    >
      <div className="panel-heading">
        <h2>{asset.kind === 'image' ? 'Reference image' : 'Reference STL'}</h2>
        <button type="button" aria-label="Cancel reference" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>
      <div className="properties-body">
        <h3>{asset.name}</h3>
        <label>
          Opacity <span>{Math.round(asset.opacity * 100)}%</span>
          <input
            aria-label="Reference opacity"
            type="range"
            min="0"
            max="100"
            value={asset.opacity * 100}
            onChange={(e) => onChange({ ...asset, opacity: Number(e.target.value) / 100 })}
          />
        </label>
        {asset.kind === 'image' && (
          <>
            <label>
              Reference plane
              <select
                aria-label="Image reference plane"
                value={asset.planeId}
                onChange={(e) => {
                  onChange({ ...asset, planeId: e.target.value });
                  onPlane(e.target.value);
                }}
              >
                {geometry
                  .filter((p) => p.id !== '__preview__')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {planeName(doc, p.id)}
                    </option>
                  ))}
              </select>
            </label>
            <div className="reference-dimensions">
              {(['width', 'height', 'centerU', 'centerV'] as const).map((key, i) => (
                <label key={key}>
                  {['Width', 'Height', 'Center U', 'Center V'][i]}
                  <input
                    aria-label={`Image ${key}`}
                    type="number"
                    step="any"
                    required
                    min={i < 2 ? 0.000001 : -1000000}
                    max="1000000"
                    value={Number.isFinite(asset[key]) ? asset[key] : ''}
                    onChange={(e) =>
                      onChange({ ...asset, [key]: e.target.value ? Number(e.target.value) : NaN })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="field-hint">
              Dimensions are in model units. U and V are the plane’s horizontal and vertical axes, relative to
              its origin.
            </p>
            {frame && (
              <p className="field-hint">
                World center (X, Y, Z):{' '}
                {[0, 1, 2]
                  .map((i) =>
                    (frame[i] + frame[3 + i] * asset.centerU + frame[6 + i] * asset.centerV).toFixed(3),
                  )
                  .join(', ')}
              </p>
            )}
            <button
              type="button"
              className="wide-button"
              aria-pressed={sizing}
              onClick={() => onSizing(!sizing)}
            >
              Drag to size image
            </button>
            {sizing && (
              <p className="field-hint">
                Drag between two opposite corners in the design space. The image center and dimensions update
                together.
              </p>
            )}
          </>
        )}
        <p className="field-hint">
          Reference only. Excluded from Auto Sweep and STEP export; included in MVCAD files.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={!!error}>
          Apply reference
        </button>
      </div>
    </form>
  );
}
