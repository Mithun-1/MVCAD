import { ArrowLeftRight, X } from 'lucide-react';
import { planeName, type Document, type EvaluatedPlane } from './model';
import { identityReferenceTransform, validateReference, type ReferenceAsset } from './references';

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
  const transform = asset.kind === 'stl' ? (asset.transform ?? identityReferenceTransform()) : undefined;
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
        {asset.kind === 'stl' && transform && (
          <div className="reference-transform-tools">
            <h4>Swap coordinates</h4>
            <div className="reference-axis-swaps">
              {(
                [
                  [0, 1],
                  [0, 2],
                  [1, 2],
                ] as const
              ).map(([a, b]) => (
                <button
                  type="button"
                  className="secondary-button"
                  key={`${a}${b}`}
                  aria-label={`Swap reference ${'XYZ'[a]} and ${'XYZ'[b]}`}
                  onClick={() => {
                    const axes = [...transform.axes] as [number, number, number];
                    [axes[a], axes[b]] = [axes[b], axes[a]];
                    onChange({ ...asset, transform: { ...transform, axes } });
                  }}
                >
                  {'XYZ'[a]} <ArrowLeftRight size={12} /> {'XYZ'[b]}
                </button>
              ))}
            </div>
            <p className="field-hint">
              Imported axes: {transform.axes.map((axis, i) => `${'XYZ'[i]} ← ${'XYZ'[axis]}`).join(', ')}
            </p>
            {(['rotation', 'translation'] as const).map((kind) => (
              <div key={kind}>
                <h4>{kind === 'rotation' ? 'Rotate (degrees)' : 'Translate (model units)'}</h4>
                <div className="reference-transform-inputs">
                  {([0, 1, 2] as const).map((axis) => (
                    <label key={axis}>
                      {'XYZ'[axis]}
                      <input
                        type="number"
                        step="any"
                        required
                        min="-1000000"
                        max="1000000"
                        aria-label={`Reference ${kind} ${'XYZ'[axis]}`}
                        value={Number.isFinite(transform[kind][axis]) ? transform[kind][axis] : ''}
                        onChange={(e) => {
                          const values = [...transform[kind]] as [number, number, number];
                          values[axis] = e.target.value ? Number(e.target.value) : NaN;
                          onChange({ ...asset, transform: { ...transform, [kind]: values } });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <p className="field-hint">
              Swap imported axes, rotate around the model origin in X → Y → Z order, then translate.
            </p>
            <button
              type="button"
              className="wide-button"
              onClick={() => onChange({ ...asset, transform: identityReferenceTransform() })}
            >
              Reset placement
            </button>
          </div>
        )}
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
