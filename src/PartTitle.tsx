import { useRef, useState } from 'react';
import { FileBox, Pencil } from 'lucide-react';

export function PartTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const editing = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const finish = (save: boolean, restoreFocus: boolean) => {
    if (!editing.current) return;
    const next = draft?.trim() ?? '';
    if (save && !next && restoreFocus) {
      setError('Enter a part name.');
      return;
    }
    editing.current = false;
    if (save && next && next !== name) onRename(next);
    setDraft(null);
    setError('');
    if (restoreFocus) requestAnimationFrame(() => button.current?.focus());
  };
  return (
    <div className="document-title">
      {draft === null ? (
        <button
          ref={button}
          className="document-name-button"
          aria-label="Rename part"
          title={`${name}.mvcad · Click to rename`}
          onClick={() => {
            editing.current = true;
            setDraft(name);
          }}
        >
          <FileBox size={16} />
          <span className="document-name">{name}</span>
          <span className="file-extension">.mvcad</span>
          <Pencil className="document-name-pencil" size={12} />
        </button>
      ) : (
        <>
          <FileBox size={16} />
          <input
            className="document-name-input"
            aria-label="Part name"
            aria-invalid={!!error}
            aria-describedby={error ? 'part-name-error' : undefined}
            autoFocus
            maxLength={100}
            value={draft}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
            onBlur={() => finish(true, false)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                finish(event.key === 'Enter', true);
              }
            }}
          />
          <span className="file-extension">.mvcad</span>
          {error && (
            <span className="part-name-error" id="part-name-error" role="alert">
              {error}
            </span>
          )}
        </>
      )}
    </div>
  );
}
