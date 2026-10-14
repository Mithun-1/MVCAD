import { RoundingIcon } from './RoundingIcon';
import { Check, Trash2, X } from 'lucide-react';
import type { FilletFeature } from './model';
import type { SweepMesh } from './sweep';

export function FilletEditor({
  feature,
  onChange,
  onApply,
  onCancel,
  busy,
  previewReady,
  error,
  edges,
  names,
}: {
  feature: FilletFeature;
  onChange: (feature: FilletFeature) => void;
  onApply: () => void;
  onCancel: () => void;
  busy: boolean;
  previewReady: boolean;
  error: string;
  edges: NonNullable<SweepMesh['cadEdges']>;
  names: string[];
}) {
  const missing = feature.edges.some((key) => !edges.some((edge) => edge.key === key));
  const nameValid = !!feature.name.trim() && !names.includes(feature.name.trim().toLowerCase());
  const valid =
    feature.radius > 0 &&
    Number.isFinite(feature.radius) &&
    feature.radius <= 1000000 &&
    feature.edges.length > 0 &&
    !missing &&
    nameValid;
  return (
    <form
      className="fillet-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && previewReady && !busy && !error) onApply();
      }}
    >
      <div className="panel-heading">
        <h2>Rounding</h2>
        <button type="button" className="icon-button" aria-label="Cancel fillet" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>
      <div className="properties-body">
        <p className="field-hint">
          Click body edges in the design space to select them. Click a selected edge again to remove it.
        </p>
        <label>
          Feature name
          <input
            aria-label="Fillet name"
            maxLength={60}
            value={feature.name}
            onChange={(e) => onChange({ ...feature, name: e.target.value })}
          />
        </label>
        <label>
          Radius
          <input
            aria-label="Fillet radius"
            type="number"
            min="0.000001"
            max="1000000"
            step="any"
            value={Number.isNaN(feature.radius) ? '' : feature.radius}
            onChange={(e) => onChange({ ...feature, radius: e.target.value ? Number(e.target.value) : NaN })}
          />
        </label>
        <p className="field-hint">Radius is half the rounding diameter, in model units.</p>
        <h3>Selected edges ({feature.edges.length})</h3>
        <ul className="fillet-edge-list">
          {feature.edges.map((key, i) => (
            <li key={key}>
              <RoundingIcon size={14} />
              <span>
                Edge {i + 1}
                {!edges.some((e) => e.key === key) ? ' · Missing' : ''}
              </span>
              <button
                type="button"
                aria-label={`Remove fillet edge ${i + 1}`}
                onClick={() => onChange({ ...feature, edges: feature.edges.filter((e) => e !== key) })}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        {!feature.edges.length && <p className="field-hint">Select one or more edges to round.</p>}
        {feature.edges.length > 0 && (
          <p className="field-hint" role="status">
            {busy
              ? 'Updating rounding preview…'
              : error
                ? 'Preview unavailable. Adjust the radius or selected edges.'
                : previewReady
                  ? 'Rounding preview — Apply to keep this result.'
                  : 'Enter a positive radius to preview rounding.'}
          </p>
        )}
        {missing && (
          <p className="form-error" role="alert">
            A selected edge has changed. Remove the missing reference and select its replacement.
          </p>
        )}
        {!nameValid && (
          <p className="form-error" role="alert">
            Enter a unique feature name.
          </p>
        )}
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
        <button className="primary-button" disabled={!valid || !previewReady || busy || !!error}>
          <Check size={14} />
          Apply fillet
        </button>
      </div>
    </form>
  );
}
