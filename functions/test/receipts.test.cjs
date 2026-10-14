const test = require('node:test');
const assert = require('node:assert/strict');
const { newTest, compareAnswer, createReceiptHandler } = require('../receipts.cjs');
function fixture() {
  const testCase = newTest('a'.repeat(64));
  let stored = testCase.record;
  const handler = createReceiptHandler({
    readCapability: async id => id === testCase.testId ? { uid: 'alice', tokenHash: testCase.tokenHash, expiresAt: stored.expiresAt } : null,
    updateTest: async (uid, id, update) => {
      assert.equal(uid, 'alice'); assert.equal(id, testCase.testId);
      const next = update(stored);
      if (next) stored = next;
      return { committed: !!next };
    }
  });
  const request = { method: 'POST', body: { testId: testCase.testId, receiptToken: testCase.receiptToken,
    receiverSubscriptionId: 'a'.repeat(64), action: 'yes', clientTime: Date.now(), navigation: 'existing tab' } };
  async function send(body = request.body) {
    const res = { code: 200, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ ...request, body }, res);
    return res;
  }
  return { testCase, send, request, record: () => stored };
}
test('test identity contains no endpoint, private key or account identifier in review record', () => {
  const f = fixture();
  assert.match(f.testCase.testId, /^[a-f0-9]{32}$/);
  assert.match(f.testCase.receiptToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(f.record()).includes(f.testCase.receiptToken), false);
});
test('receipt compares same/different subscriptions without claiming physical device identity', () => {
  assert.equal(compareAnswer('a', 'a', 'yes'), 'consistent');
  assert.equal(compareAnswer('a', 'a', 'no'), 'response mismatch');
  assert.equal(compareAnswer('a', 'b', 'no'), 'consistent');
  assert.equal(compareAnswer('a', 'b', 'yes'), 'response mismatch');
  assert.equal(compareAnswer('a', null, 'yes'), 'not evaluated');
});
test('valid first answer records server time and focus result; duplicates cannot flip it', async () => {
  const f = fixture();
  assert.equal((await f.send()).body.recorded, true);
  assert.equal(f.record().response.answerComparison, 'consistent');
  assert.equal(f.record().response.navigation, 'existing tab');
  assert.equal((await f.send({ ...f.request.body, action: 'no' })).body.recorded, false);
  assert.equal(f.record().response.action, 'yes');
  assert.equal((await f.send({ ...f.request.body, action: 'received' })).body.recorded, true);
  assert.ok(f.record().receipt.recordedAt);
});
test('wrong capability, expired receipt and injected ownership are rejected', async () => {
  const f = fixture();
  assert.equal((await f.send({ ...f.request.body, receiptToken: 'B'.repeat(43) })).code, 403);
  assert.equal((await f.send({ ...f.request.body, uid: 'bob' })).code, 400);
  assert.equal((await f.send({ ...f.request.body, receiverSubscriptionId: 'https://private-endpoint' })).code, 400);
  f.record().expiresAt = Date.now() - 1;
  assert.equal((await f.send()).code, 403);
});
