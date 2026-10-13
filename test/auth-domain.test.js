const assert = require('node:assert/strict');
const test = require('node:test');

test('authentication prefers web.app and retains intentional firebaseapp.com visits', async () => {
  const { authDomainForHost } = await import('../src/firebase-config.mjs');
  assert.equal(authDomainForHost('web-push-4u2c.web.app'), 'web-push-4u2c.web.app');
  assert.equal(authDomainForHost('web-push-4u2c.firebaseapp.com'), 'web-push-4u2c.firebaseapp.com');
  assert.equal(authDomainForHost('localhost'), 'web-push-4u2c.web.app');
  assert.equal(authDomainForHost('untrusted.example'), 'web-push-4u2c.web.app');
});
