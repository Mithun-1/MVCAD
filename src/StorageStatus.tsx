import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { requestPersistentStorage } from './projectStorage';

const bytes = (value: number) =>
  value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
export function StorageStatus({ saveStatus, onRetry }: { saveStatus: string; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<{ usage?: number; quota?: number; persistent?: boolean }>({});
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = async () => {
    try {
      const [estimate, persistent] = await Promise.all([
        navigator.storage?.estimate?.(),
        navigator.storage?.persisted?.(),
      ]);
      setDetails({ ...estimate, persistent });
    } catch {
      setDetails({});
    }
  };
  useEffect(() => {
    if (open) void refresh();
  }, [open, saveStatus]);
  return (
    <>
      <button
        className="storage-trigger"
        aria-label="Browser storage"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Storage
      </button>
      {open && (
        <section className="storage-panel" aria-label="Browser storage details">
          <div className="panel-heading">
            <h2>Browser storage</h2>
            <button aria-label="Close storage" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="storage-panel-body">
            <p>
              {details.usage !== undefined && details.quota !== undefined
                ? `${bytes(details.usage)} used of approximately ${bytes(details.quota)}`
                : 'Storage estimate unavailable.'}
            </p>
            <p>
              {details.persistent
                ? 'Persistent storage enabled.'
                : 'Storage is currently managed by your browser.'}
            </p>
            <p className="field-hint">
              Projects and reference assets are saved on this device. Export MVCAD files for backups; clearing
              site data removes local saves.
            </p>
            {!details.persistent && (
              <button
                className="wide-button"
                disabled={requesting}
                onClick={async () => {
                  setRequesting(true);
                  const granted = await requestPersistentStorage();
                  setMessage(
                    granted
                      ? 'Persistent storage enabled.'
                      : 'The browser did not grant persistence. Autosave still works, but browser cleanup may remove it.',
                  );
                  await refresh();
                  setRequesting(false);
                }}
              >
                {requesting ? 'Requesting…' : 'Keep data on this device'}
              </button>
            )}
            <button className="wide-button" disabled={saveStatus === 'Saving…'} onClick={onRetry}>
              Retry save
            </button>
            {message && <p role="status">{message}</p>}
          </div>
        </section>
      )}
    </>
  );
}
