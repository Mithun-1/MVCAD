import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';

type UpdateState = {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'current'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'error'
    | 'unavailable';
  currentVersion: string;
  version: string | null;
  percent: number;
  manual: boolean;
  message: string;
};
declare global {
  interface Window {
    mvcadDesktop?: {
      updateState(): Promise<UpdateState>;
      checkForUpdates(): Promise<UpdateState>;
      downloadUpdate(): Promise<UpdateState>;
      installUpdate(): Promise<UpdateState>;
      onUpdate(callback: (state: UpdateState) => void): () => void;
    };
  }
}

export function DesktopUpdates({ canRestart }: { canRestart: boolean }) {
  const [state, setState] = useState<UpdateState>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const api = window.mvcadDesktop;
  useEffect(() => {
    if (!api) return;
    let active = true;
    const receive = (value: UpdateState) => {
      if (active) setState(value);
    };
    const unsubscribe = api.onUpdate(receive);
    api
      .updateState()
      .then(receive)
      .catch(() => setError('Update service unavailable. Restart MVCAD to try again.'));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);
  if (!api) return null;
  const run = (action: () => Promise<UpdateState>) => {
    setError('');
    action()
      .then(setState)
      .catch(() => setError('Update service unavailable. Please try again.'));
  };
  const pending = state && ['checking', 'downloading', 'installing'].includes(state.status);
  const available = state && ['available', 'ready'].includes(state.status);
  return (
    <div className="desktop-updates">
      <button
        className={`desktop-update-button ${available ? 'update-available' : ''}`}
        onClick={() => {
          setOpen(!open);
          if (!open && (!state || ['idle', 'current', 'error'].includes(state.status)))
            run(api.checkForUpdates);
        }}
        aria-expanded={open}
        aria-label={available ? 'App update available' : 'Check app updates'}
      >
        <Download size={16} />
        {available
          ? 'Update available'
          : state?.status === 'downloading'
            ? `Updating ${Math.round(state.percent)}%`
            : 'Updates'}
      </button>
      {open && (
        <section className="desktop-update-panel" aria-label="App updates">
          <div className="view-tool-heading">
            <h2>App updates</h2>
            <button onClick={() => setOpen(false)} aria-label="Close app updates">
              <X size={16} />
            </button>
          </div>
          <p>Installed version: {state?.currentVersion ?? '…'}</p>
          <p role="status">
            {state?.status === 'checking'
              ? 'Checking for updates…'
              : state?.status === 'current'
                ? 'MVCAD is up to date.'
                : state?.status === 'available'
                  ? `Version ${state.version} is available.`
                  : state?.status === 'ready'
                    ? `Version ${state.version} is ready to install.`
                    : state?.status === 'downloading'
                      ? 'Downloading update…'
                      : state?.status === 'installing'
                        ? 'Restarting MVCAD…'
                        : state?.status === 'unavailable'
                          ? state.message
                          : ''}
          </p>
          {state?.status === 'downloading' && (
            <progress aria-label="App update progress" value={state.percent} max={100} />
          )}
          {(error || state?.status === 'error') && <p role="alert">{error || state?.message}</p>}
          {state?.manual && (
            <p>
              Mac updates currently require replacing MVCAD in Applications. Automatic installation requires
              an Apple-signed release.
            </p>
          )}
          {state?.status === 'available' && (
            <button className="primary-button" onClick={() => run(api.downloadUpdate)}>
              <Download size={14} />
              {state.manual ? 'Download latest Mac version' : 'Download update'}
            </button>
          )}
          {state?.status === 'ready' && (
            <>
              <p>Restart to install. Your saved document will reopen.</p>
              {!canRestart && (
                <p>Finish or cancel your active edit and save/export your document before restarting.</p>
              )}
              <button
                className="primary-button"
                disabled={!canRestart}
                onClick={() => run(api.installUpdate)}
              >
                <RefreshCw size={14} />
                Restart and update
              </button>
            </>
          )}
          {!pending && state?.status !== 'ready' && (
            <button className="wide-button" onClick={() => run(api.checkForUpdates)}>
              Check for updates
            </button>
          )}
        </section>
      )}
    </div>
  );
}
