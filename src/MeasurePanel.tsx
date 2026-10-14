import { Ruler, X } from 'lucide-react';
import { measureNumber as number, type MeasureSelection, type MeasureResult } from './measure';
export function MeasurePanel({
  selections,
  result,
  pending,
  error,
  onClear,
  onClose,
}: {
  selections: MeasureSelection[];
  result?: MeasureResult;
  pending: boolean;
  error: string;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="view-tool-panel measure-panel" role="region" aria-label="Measure">
      <div className="view-tool-heading">
        <strong>
          <Ruler size={16} /> Measure
        </strong>
        <button aria-label="Close Measure" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <p>Click a point or face. Shift-click a second item to measure distance.</p>
      {selections.map((selection, index) => (
        <div className="measure-selection" key={index}>
          <strong>
            {index ? 'B' : 'A'} · {selection.label}
          </strong>
          {selection.face ? (
            <dl>
              <dt>Area</dt>
              <dd data-testid={`measure-area-${index}`}>{number(selection.face.area)}</dd>
              <dt>{selection.face.sweepDiameter ? 'Sweep diameter' : 'Diameter'}</dt>
              <dd data-testid={`measure-diameter-${index}`}>
                {selection.face.diameter === undefined
                  ? 'No single diameter'
                  : number(selection.face.diameter)}
              </dd>
            </dl>
          ) : (
            <dl>
              {selection.position.map((value, axis) => (
                <span key={axis}>
                  <dt>{'XYZ'[axis]}</dt>
                  <dd data-testid={`measure-${index}-${'xyz'[axis]}`}>{String(value)}</dd>
                </span>
              ))}
            </dl>
          )}
        </div>
      ))}
      {pending && <p role="status">Measuring…</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div className="measure-result">
          <strong>{result.minimum ? 'Minimum distance' : 'Distance between picked locations'}</strong>
          <output data-testid="measure-distance">{number(result.distance)}</output>
          <dl>
            {result.from.map((value, axis) => (
              <span key={axis}>
                <dt>Δ{'XYZ'[axis]}</dt>
                <dd>{number(Math.abs(result.to[axis] - value))}</dd>
              </span>
            ))}
          </dl>
        </div>
      )}
      <p className="field-hint">Lengths in model units · areas in model units²</p>
      {selections.length > 0 && (
        <button className="secondary-button" onClick={onClear}>
          Clear measurement
        </button>
      )}
    </div>
  );
}
