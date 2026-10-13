const assert = require('node:assert/strict');
const test = require('node:test');

const helpers = import('../src/subscriptions.mjs');

test('subscription paths are isolated by owner and endpoint', async () => {
  const { subscriptionId, subscriptionPath } = await helpers;
  const id = await subscriptionId('https://push.example/device-one');
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(await subscriptionId('https://push.example/device-one'), id);
  assert.notEqual(await subscriptionId('https://push.example/device-two'), id);
  assert.notEqual(subscriptionPath('alice', id), subscriptionPath('bob', id));
  for (const uid of ['', 'alice/bob', 'alice.bob', 'alice[bob]']) {
    assert.throws(() => subscriptionPath(uid, id));
  }
  assert.throws(() => subscriptionPath('alice', '../bob'));
});

test('VAPID key conversion preserves a public key and rejects malformed input', async () => {
  const { encodePublicKey, decodePublicKey } = await helpers;
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  const encoded = encodePublicKey(bytes);
  assert.deepEqual(decodePublicKey(encoded), bytes);
  for (const invalid of ['', 'private key', 'AAAA', '-----BEGIN PRIVATE KEY-----']) {
    assert.throws(() => decodePublicKey(invalid));
  }
});
