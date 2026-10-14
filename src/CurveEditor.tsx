import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, MousePointer2, Plus, Spline, X } from 'lucide-react';
import type { Document } from './model';
import { curveError, createPointResolver, MAX_CURVE_POINTS, type CurveFeature } from './curves';

export type CurveDraft = { feature: CurveFeature; active: number; replace: boolean; editing: boolean };
type Props = {
  doc: Document;
  draft: CurveDraft;
  onChange: (draft: CurveDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  engineError: string;
};
export function CurveEditor({ doc, draft, onChange, onSave, onCancel, busy, engineError }: Props) {
  const { feature, active } = draft;
  const resolve = useMemo(() => createPointResolver(doc), [doc.pointSets]);
  const node = feature.nodes[active];
  const point = resolve(node?.point ?? null);
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const error =
    curveError(doc, feature) ||
    ([
      'origin',
      ...Object.values(doc.baseNames),
      ...doc.planes.map((p) => p.name),
      ...doc.pointSets.map((p) => p.name),
      ...doc.curves.filter((p) => p.id !== feature.id).map((p) => p.name),
      ...(doc.groups ?? []).map((p) => p.name),
    ].some((name) => name.toLowerCase() === feature.name.trim().toLowerCase())
      ? 'A feature with this name already exists.'
      : '');
  const update = (changes: Partial<CurveFeature>) =>
    onChange({ ...draft, feature: { ...feature, ...changes } });
  const insert = (index: number) => {
    if (feature.nodes.length >= MAX_CURVE_POINTS) return;
    const nodes = [...feature.nodes];
    nodes.splice(index, 0, {
      id: crypto.randomUUID(),
      point: null,
      connection: node?.connection ?? 'spline',
    });
    onChange({ ...draft, feature: { ...feature, nodes }, active: index, replace: true });
    setMenu(null);
  };
  const remove = (index: number) => {
    const nodes = feature.nodes.filter((_, i) => i !== index);
    onChange({
      ...draft,
      feature: { ...feature, nodes },
      active: Math.max(0, Math.min(index, nodes.length - 1)),
      replace: false,
    });
    setMenu(null);
  };
  const move = (delta: number) => {
    const nodes = [...feature.nodes];
    [nodes[active], nodes[active + delta]] = [nodes[active + delta], nodes[active]];
    onChange({ ...draft, feature: { ...feature, nodes }, active: active + delta });
  };
  return (
    <form
      className="curve-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!error && !busy && !engineError) onSave();
      }}
    >
      <div className="panel-heading">
        <h2>{draft.editing ? 'Edit curve through points' : 'Curve through points'}</h2>
        <button type="button" aria-label="Cancel curve" className="icon-button" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>
      <div className="curve-editor-body">
        <div className="feature-type">
          <Spline size={20} />
          <strong>Curve through points</strong>
        </div>
        <label htmlFor="curve-name">Feature name</label>
        <input
          id="curve-name"
          value={feature.name}
          maxLength={60}
          onChange={(e) => update({ name: e.target.value })}
        />
        <p className="curve-pick-hint" role="status">
          {draft.replace
            ? `Click a point in the workspace for row ${active + 1}.`
            : 'Click points in the workspace to extend the curve.'}
        </p>
        <div className="curve-controls">
          <div className="curve-point-list" role="listbox" aria-label="Curve points">
            {feature.nodes.map((entry, index) => (
              <button
                type="button"
                key={entry.id}
                role="option"
                aria-selected={index === active}
                onClick={() => onChange({ ...draft, active: index, replace: true })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onChange({ ...draft, active: index, replace: true });
                  setMenu({ index, x: e.clientX, y: e.clientY });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Delete') {
                    e.preventDefault();
                    e.stopPropagation();
                    remove(index);
                  } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMenu({ index, x: rect.left, y: rect.bottom });
                  }
                }}
              >
                <span>{index + 1}.</span>
                <span>{resolve(entry.point)?.name ?? 'Select point…'}</span>
              </button>
            ))}
            <button
              className="curve-add-point"
              type="button"
              disabled={feature.nodes.length >= MAX_CURVE_POINTS}
              onClick={() => insert(feature.nodes.length)}
            >
              <Plus size={14} /> Add point
            </button>
          </div>
          <div className="curve-point-settings">
            <span className="field-hint">Point</span>
            <div className="curve-point-reference">
              {point
                ? `${doc.pointSets.find((s) => s.id === node.point?.setId)?.name} / ${point.name}`
                : 'Select a point in the workspace'}
            </div>
            <button
              type="button"
              className="wide-button"
              disabled={!node}
              onClick={() => onChange({ ...draft, replace: true })}
            >
              <MousePointer2 size={14} /> Select point
            </button>
            <fieldset disabled={!node || active === 0}>
              <legend>Connect to previous point by</legend>
              {(['spline', 'line'] as const).map((mode) => (
                <label key={mode}>
                  <input
                    type="radio"
                    name="connection"
                    checked={node?.connection === mode}
                    onChange={() =>
                      update({
                        nodes: feature.nodes.map((n, i) => (i === active ? { ...n, connection: mode } : n)),
                      })
                    }
                  />
                  {mode === 'spline' ? 'Spline' : 'Straight line'}
                </label>
              ))}
            </fieldset>
            <div className="curve-reorder">
              <button
                type="button"
                aria-label="Move point up"
                title="Move point up"
                disabled={!node || active === 0}
                onClick={() => move(-1)}
              >
                <ArrowUp size={18} />
              </button>
              <button
                type="button"
                aria-label="Move point down"
                title="Move point down"
                disabled={!node || active === feature.nodes.length - 1}
                onClick={() => move(1)}
              >
                <ArrowDown size={18} />
              </button>
            </div>
          </div>
        </div>
        {(error || engineError) && (
          <p className="form-error" role="alert">
            {error || engineError}
          </p>
        )}
        <p className="field-hint">
          Right-click a row to delete or insert a point. Curves stay linked to their source points.
        </p>
      </div>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={!!error || busy || !!engineError}>
          <Check size={15} />
          {draft.editing ? 'Apply changes' : 'Create curve'}
        </button>
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="plane-context-menu"
          role="menu"
          aria-label="Curve point actions"
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 230)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 150)),
          }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              setMenu(null);
            }
            if (e.key === 'Delete') {
              e.preventDefault();
              remove(menu.index);
            }
          }}
        >
          <button type="button" role="menuitem" onClick={() => remove(menu.index)}>
            Delete<kbd aria-hidden="true">Del</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={feature.nodes.length >= MAX_CURVE_POINTS}
            onClick={() => insert(menu.index)}
          >
            Insert point above
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={feature.nodes.length >= MAX_CURVE_POINTS}
            onClick={() => insert(menu.index + 1)}
          >
            Insert point below
          </button>
        </div>
      )}
    </form>
  );
}
