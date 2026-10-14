import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('firebase-tools/package.json'));
const gaxiosRequire = createRequire(cliRequire.resolve('gaxios'));
const uuid = gaxiosRequire('uuid');

test('CLI HTTP dependency rejects undersized UUID buffers while preserving normal generation', () => {
  for (const name of ['v3', 'v5']) {
    assert.throws(() => uuid[name]('test', uuid[name].DNS, new Uint8Array(1)), RangeError);
    assert.throws(() => uuid[name]('test', uuid[name].DNS, new Uint8Array(16), 1), RangeError);
    assert.equal(uuid.validate(uuid[name]('test', uuid[name].DNS)), true);
  }
  // gaxios uses v4 to frame multipart uploads; the override must retain this CommonJS API.
  assert.equal(uuid.version(uuid.v4()), 4);
});
