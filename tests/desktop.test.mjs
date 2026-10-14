import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const { assetPath } = createRequire(import.meta.url)('../desktop/protocol.cjs');
test('desktop serves only bundled app files', () => {
  const root = path.resolve('dist');
  assert.equal(assetPath(root, 'mvcad://app/'), path.join(root, 'index.html'));
  assert.equal(assetPath(root, 'mvcad://app/assets/kernel.wasm'), path.join(root, 'assets/kernel.wasm'));
  for (const url of [
    'https://app/',
    'mvcad://other/',
    'mvcad://app/..%2f..%2fsecret',
    'mvcad://app/%5csecret',
    'mvcad://app/C:/secret',
    'mvcad://app/%00',
    'mvcad://user@app/',
    'invalid',
  ])
    assert.equal(assetPath(root, url), null, url);
});
