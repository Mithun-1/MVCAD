import { useMemo, useState } from 'react';
import { Pin, Plus, Settings2, X } from 'lucide-react';
import { Vector3 } from 'three';
import { planeName, type Document, type EvaluatedPlane } from './model';
import {
  boxDimensions,
  setBoundingBox,
  type BoxSpacing,
  type SectionView,
  type ActiveSectionView,
} from './viewTools';

export type ViewTool = 'box' | 'spacing' | 'section' | null;
export function ViewControls({
  mode,
  doc,
  geometry,
  positions,
  section,
  spacing,
  busy,
  onSection,
  onKeepSection,
  onAddSection,
  onCommit,
  onClose,
}: {
  mode: ViewTool;
  doc: Document;
  geometry: EvaluatedPlane[];
  positions: ArrayLike<number>[];
  section?: SectionView;
  spacing?: BoxSpacing;
  busy: boolean;
  onSection: (value: SectionView) => void;
  onKeepSection: () => void;
  onAddSection: () => void;
  onCommit: (doc: Document) => void;
  onClose: () => void;
}) {
  const [dimensions, setDimensions] = useState(() => (boxDimensions(doc) ?? [100, 100, 100]).map(String));
  const [error, setError] = useState('');
  const plane = geometry.find((p) => p.id === section?.planeId) ?? geometry[0];
  const [rangeMin, rangeMax] = useMemo(() => sectionRange(doc, plane, positions), [doc, plane, positions]);
  const min = Math.min(rangeMin, section?.offset ?? 0),
    max = Math.max(rangeMax, section?.offset ?? 0);
  if (!mode) return null;
  const title = mode === 'box' ? 'Bounding Box' : mode === 'spacing' ? 'Check Spacing' : 'Section View';
  return (
    <div className="view-tool-panel" role="region" aria-label={title}>
      <div className="view-tool-heading">
        <strong>{title}</strong>
        <button aria-label={`Close ${title}`} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {mode === 'box' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              onCommit(
                setBoundingBox(
                  doc,
                  dimensions.map((v) => (v.trim() ? Number(v) : NaN)),
                ),
              );
              onClose();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {['Lx', 'Ly', 'Lz'].map((label, i) => (
            <label key={label}>
              {label}
              <input
                aria-label={label}
                type="number"
                step="any"
                min="0.000001"
                max="1000000"
                required
                value={dimensions[i]}
                onChange={(e) => {
                  setDimensions((old) => old.map((v, j) => (i === j ? e.target.value : v)));
                  setError('');
                }}
              />
            </label>
          ))}
          <p className="field-hint">Box extends from the origin to Lx, Ly, and Lz.</p>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <button className="primary-button" type="submit">
            Apply bounding box
          </button>
        </form>
      )}
      {mode === 'spacing' && (
        <div aria-live="polite">
          {busy ? (
            <p>Updating bodies…</p>
          ) : spacing ? (
            <>
              <p>
                Closest distance <strong data-testid="box-spacing">{spacing.distance.toPrecision(6)}</strong>
              </p>
              <p>
                Body {spacing.body + 1} → {spacing.face}
              </p>
              {spacing.distance < 1e-9 && <p>Body touches or crosses the box boundary.</p>}
              <p className="field-hint">
                Measured from the full body mesh to the finite box faces, in model units.
              </p>
            </>
          ) : (
            <p>
              {boxDimensions(doc)
                ? 'Generate a solid or surface body to check spacing.'
                : 'Create a bounding box first.'}
            </p>
          )}
        </div>
      )}
      {mode === 'section' && section && plane && (
        <>
          <label>
            Reference plane
            <select
              aria-label="Section plane"
              value={plane.id}
              onChange={(e) => onSection({ ...section, planeId: e.target.value, offset: 0 })}
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
          <label>
            Keep side
            <select
              aria-label="Section keep side"
              value={section.keepAbove ? 'above' : 'below'}
              onChange={(e) => onSection({ ...section, keepAbove: e.target.value === 'above' })}
            >
              <option value="above">Above plane (+ normal)</option>
              <option value="below">Below plane (− normal)</option>
            </select>
          </label>
          <label>
            Section offset
            <input
              type="range"
              aria-label="Section position"
              min={min}
              max={max}
              step={(max - min) / 1000}
              value={section.offset}
              onChange={(e) => onSection({ ...section, offset: Number(e.target.value) })}
            />
          </label>
          <input
            type="number"
            aria-label="Section offset"
            step="any"
            value={section.offset}
            onChange={(e) => {
              if (e.target.value && Number.isFinite(Number(e.target.value)))
                onSection({ ...section, offset: Number(e.target.value) });
            }}
          />
          <button className="keep-section-slider" onClick={onKeepSection}>
            <Pin size={13} />
            Keep slider in view
          </button>
          <button className="secondary-button add-section" onClick={onAddSection}>
            <Plus size={14} /> Add section view
          </button>
          <p className="field-hint">
            Each cut clips bodies, points, and curves. Closing removes only this cut.
          </p>
        </>
      )}
    </div>
  );
}

function sectionRange(
  doc: Document,
  plane: EvaluatedPlane | undefined,
  positions: ArrayLike<number>[],
): [number, number] {
  let min = 0,
    max = 100;
  if (plane) {
    const normal = new Vector3(...plane.frame.slice(9, 12)),
      origin = new Vector3(...plane.frame.slice(0, 3));
    const values: number[] = [0];
    const box = boxDimensions(doc);
    if (box)
      for (const x of [0, box[0]])
        for (const y of [0, box[1]])
          for (const z of [0, box[2]]) values.push(new Vector3(x, y, z).sub(origin).dot(normal));
    // Compute the range without accumulating large point-cloud arrays.
    min = Math.min(...values);
    max = Math.max(...values);
    const point = new Vector3();
    for (const array of positions)
      for (let i = 0; i < array.length; i += 3) {
        const v = point.fromArray(array, i).sub(origin).dot(normal);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    if (max - min < 1e-6) {
      min -= 50;
      max += 50;
    }
  }

  return [min, max];
}

function SectionSlider({
  section,
  doc,
  geometry,
  positions,
  onSection,
  onEdit,
  onRemove,
}: {
  section: ActiveSectionView;
  doc: Document;
  geometry: EvaluatedPlane[];
  positions: ArrayLike<number>[];
  onSection: (value: ActiveSectionView) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const plane = geometry.find((p) => p.id === section.planeId);
  const [rangeMin, rangeMax] = useMemo(() => sectionRange(doc, plane, positions), [doc, plane, positions]);
  const min = Math.min(rangeMin, section.offset),
    max = Math.max(rangeMax, section.offset);
  const name = planeName(doc, section.planeId);
  return (
    <div className="section-slider-card" role="group" aria-label={name + ' section slider'}>
      <span title={name + (section.keepAbove ? ' · Keep above' : ' · Keep below')}>
        {name} {section.keepAbove ? '↑' : '↓'}
      </span>
      <input
        type="range"
        aria-label="Section position"
        min={min}
        max={max}
        step={(max - min) / 1000}
        value={section.offset}
        onChange={(e) => onSection({ ...section, offset: Number(e.target.value) })}
      />
      <output>{Number(section.offset.toPrecision(5))}</output>
      <button aria-label="Edit section view" title="Edit section view" onClick={() => onEdit(section.id)}>
        <Settings2 size={14} />
      </button>
      <button
        aria-label="Remove section view"
        title="Remove section view"
        onClick={() => onRemove(section.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function SectionSliders({
  sections,
  ...props
}: {
  sections: ActiveSectionView[];
  doc: Document;
  geometry: EvaluatedPlane[];
  positions: ArrayLike<number>[];
  onSection: (value: ActiveSectionView) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (!sections.length) return null;
  return (
    <div className="section-slider-dock" role="region" aria-label="Section sliders">
      {sections.map((section) => (
        <SectionSlider key={section.id} section={section} {...props} />
      ))}
    </div>
  );
}
