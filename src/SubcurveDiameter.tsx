import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

export function SubcurveDiameter({
  value,
  onAssign,
}: {
  value: number | 'mixed' | undefined;
  onAssign: (diameter: number) => void;
}) {
  const [draft, setDraft] = useState(typeof value === 'number' ? String(value) : '');
  useEffect(() => {
    setDraft(typeof value === 'number' ? String(value) : '');
  }, [value]);
  const diameter = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(diameter) && diameter > 0;
  return (
    <form
      className="subcurve-diameter"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && diameter !== value) onAssign(diameter);
      }}
    >
      <label htmlFor="subcurve-diameter">Diameter</label>
      <div className="diameter-input-row">
        <input
          id="subcurve-diameter"
          type="number"
          step="any"
          min="0"
          placeholder={value === 'mixed' ? 'Mixed diameters' : 'Not assigned'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={draft !== '' && !valid}
          aria-describedby={draft !== '' && !valid ? 'diameter-error' : undefined}
        />
        <button
          type="submit"
          className="wide-button diameter-apply"
          aria-label="Assign diameter"
          title="Apply diameter"
          disabled={!valid || diameter === value}
        >
          <Check size={17} aria-hidden="true" />
        </button>
      </div>
      {draft !== '' && !valid && (
        <p id="diameter-error" className="field-error" role="alert">
          Enter a diameter greater than zero.
        </p>
      )}
    </form>
  );
}
