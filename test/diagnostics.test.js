const assert = require('node:assert/strict');
const test = require('node:test');

test('diagnostics omit identities, raw errors and subscription secrets and bound the log', async () => {
  const { createDiagnostics } = await import('../src/diagnostics.mjs');
  const output = { textContent: '' };
  const debug = createDiagnostics({ getElementById: () => output });
  debug.update({ 'Signed in': 'Yes', email: 'private@example.com', endpoint: 'https://secret.example/token' });
  debug.record('Error', { code: 'auth/popup-blocked', message: 'secret-token', email: 'private@example.com' });
  assert.match(debug.text(), /auth\/popup-blocked/);
  assert.doesNotMatch(debug.text(), /private@example|secret-token|secret.example/);
  debug.record('Error', { code: 'sensitive-unknown-code', message: 'secret' });
  assert.doesNotMatch(debug.text(), /sensitive-unknown-code/);
  for (let index = 0; index < 30; index++) debug.record(`Event ${index}`);
  assert.doesNotMatch(debug.text(), /Event 0\n/);
  assert.match(debug.text(), /Event 29/);
  debug.clear();
  assert.doesNotMatch(debug.text(), /Event 29/);
  assert.match(debug.text(), /Signed in: Yes/);
});
