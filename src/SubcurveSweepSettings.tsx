import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

function Setting({
  label,
  value,
  percent = false,
  disabled = false,
  onApply,
}: {
  label: string;
  value: number;
  percent?: boolean;
  disabled?: boolean;
  onApply: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const number = Number(draft),
    valid = draft.trim() !== '' && Number.isFinite(number) && number >= 0 && (!percent || number <= 50);
  const id = `subcurve-${label.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <form
      className={`subcurve-setting ${disabled ? 'unconnected-setting' : ''}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && valid && number !== value) onApply(number);
      }}
    >
      <label htmlFor={id}>
        {label}
        {percent ? ' (%)' : ''}
      </label>
      <div className="diameter-input-row">
        <input
          id={id}
          type="number"
          min="0"
          max={percent ? 50 : undefined}
          step="any"
          value={draft}
          disabled={disabled}
          title={disabled ? 'No subcurve connection at this end.' : undefined}
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={!disabled && draft !== '' && !valid}
          aria-describedby={!disabled && draft !== '' && !valid ? `${id}-error` : undefined}
        />
        <button
          className="wide-button diameter-apply"
          type="submit"
          aria-label={`Apply ${label.toLowerCase()}`}
          title={`Apply ${label.toLowerCase()}`}
          disabled={disabled || !valid || number === value}
        >
          <Check size={17} aria-hidden="true" />
        </button>
      </div>
      {!disabled && draft !== '' && !valid && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {percent ? 'Enter a percentage from 0 to 50.' : 'Enter a diameter of zero or greater.'}
        </p>
      )}
    </form>
  );
}

export function SubcurveSweepSettings({
  settings,
  onApply,
}: {
  settings: { startCutoff: number; endCutoff: number; connected: [boolean, boolean] };
  onApply: (property: 'startCutoff' | 'endCutoff', value: number) => void;
}) {
  return (
    <div className="subcurve-sweep-settings">
      <Setting
        label="Start cutoff"
        value={settings.startCutoff}
        percent
        disabled={!settings.connected[0]}
        onApply={(v) => onApply('startCutoff', v)}
      />
      <Setting
        label="End cutoff"
        value={settings.endCutoff}
        percent
        disabled={!settings.connected[1]}
        onApply={(v) => onApply('endCutoff', v)}
      />
    </div>
  );
}
