import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createUpdates } = createRequire(import.meta.url)('../desktop/updates.cjs');
function fixture(platform = 'win32', packaged = true) {
  const updater = new EventEmitter();
  let checks = 0,
    downloads = 0,
    installs = 0,
    opened = 0;
  updater.checkForUpdates = async () => {
    checks++;
    updater.emit('update-available', { version: '0.2.0' });
  };
  updater.downloadUpdate = async () => {
    downloads++;
    updater.emit('download-progress', { percent: 50 });
    updater.emit('update-downloaded', { version: '0.2.0' });
  };
  const states = [];
  const controller = createUpdates({
    updater,
    platform,
    packaged,
    version: '0.1.1',
    notify: (state) => states.push(state),
    openDownload: async () => opened++,
    install: async () => installs++,
  });
  return { updater, controller, states, counts: () => ({ checks, downloads, installs, opened }) };
}
test('Windows checks, downloads on request, then installs only on explicit restart', async () => {
  const f = fixture();
  await f.controller.install();
  await f.controller.download();
  assert.equal(f.counts().installs, 0);
  await f.controller.check();
  assert.equal(f.controller.state().status, 'available');
  assert.equal(f.counts().downloads, 0);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false);
  await f.controller.download();
  assert.equal(f.controller.state().status, 'ready');
  assert.ok(f.states.some((state) => state.status === 'downloading' && state.percent === 50));
  assert.equal(f.counts().installs, 0);
  await f.controller.install();
  await f.controller.install();
  assert.equal(f.counts().installs, 1);
});
test('failed download can be checked and retried without claiming it is ready', async () => {
  const f = fixture();
  await f.controller.check();
  f.updater.downloadUpdate = async () => {
    throw new Error('Network interrupted');
  };
  await f.controller.download();
  assert.equal(f.controller.state().status, 'error');
  assert.match(f.controller.state().message, /Network interrupted/);
  await f.controller.install();
  assert.equal(f.counts().installs, 0);
  await f.controller.check();
  assert.equal(f.controller.state().status, 'available');
});
test('Mac releases use manual download until Developer ID signing is configured', async () => {
  const f = fixture('darwin');
  await f.controller.check();
  await f.controller.download();
  await f.controller.install();
  assert.deepEqual(f.counts(), { checks: 1, downloads: 0, installs: 0, opened: 1 });
});
test('development app does not contact the release server', async () => {
  const f = fixture('win32', false);
  await f.controller.check();
  assert.equal(f.counts().checks, 0);
  assert.equal(f.controller.state().status, 'unavailable');
});
