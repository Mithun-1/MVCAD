// Dependency injection keeps the update state machine testable without installing an update.
function createUpdates({ updater, version, packaged, platform, notify, openDownload, install }) {
  let state = {
    status: 'idle',
    currentVersion: version,
    version: null,
    percent: 0,
    manual: platform === 'darwin',
    message: '',
  };
  const publish = (changes) => {
    state = { ...state, ...changes };
    notify(state);
    return state;
  };
  const fail = (error) =>
    publish({ status: 'error', message: error?.message || 'Could not check for updates. Please try again.' });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.on('checking-for-update', () => publish({ status: 'checking', message: '' }));
  updater.on('update-available', (info) =>
    publish({ status: 'available', version: info.version, percent: 0, message: '' }),
  );
  updater.on('update-not-available', () => publish({ status: 'current', version: null, message: '' }));
  updater.on('download-progress', (progress) =>
    publish({ status: 'downloading', percent: Math.max(0, Math.min(100, progress.percent)) }),
  );
  updater.on('update-downloaded', (info) =>
    publish({ status: 'ready', version: info.version, percent: 100 }),
  );
  updater.on('error', fail);
  return {
    state: () => state,
    async check() {
      if (['checking', 'downloading', 'ready', 'installing'].includes(state.status)) return state;
      if (!packaged)
        return publish({
          status: 'unavailable',
          message: 'Updates are available in the installed desktop app.',
        });
      publish({ status: 'checking', message: '' });
      try {
        await updater.checkForUpdates();
      } catch (error) {
        fail(error);
      }
      return state;
    },
    async download() {
      if (state.status !== 'available') return state;
      if (state.manual) {
        try {
          await openDownload();
        } catch (error) {
          fail(error);
        }
        return state;
      }
      publish({ status: 'downloading', percent: 0, message: '' });
      try {
        await updater.downloadUpdate();
      } catch (error) {
        fail(error);
      }
      return state;
    },
    async install() {
      if (state.status !== 'ready' || state.manual) return state;
      publish({ status: 'installing' });
      try {
        await install();
      } catch (error) {
        fail(error);
      }
      return state;
    },
  };
}
module.exports = { createUpdates };
