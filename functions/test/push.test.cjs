const assert = require('node:assert/strict');
const { createECDH, createHash } = require('node:crypto');
const test = require('node:test');
const { claimQuota, createHandlers, parseVapid, validSubscription } = require('../push.cjs');

function pair() {
  const key = createECDH('prime256v1');
  do { key.generateKeys(); } while (key.getPrivateKey().length !== 32);
  return { publicKey: key.getPublicKey().toString('base64url'), privateKey: key.getPrivateKey().toString('base64url') };
}
function sample(endpoint = 'https://fcm.googleapis.com/fcm/send/device-one') {
  const encryption = pair();
  const record = { endpoint, keys: { p256dh: encryption.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') } };
  return { record, id: createHash('sha256').update(endpoint).digest('hex') };
}
function response() {
  return { code: 200, headers: {}, status(code) { this.code = code; return this; },
    set(name, value) { this.headers[name] = value; return this; }, json(value) { this.body = value; return this; } };
}
function fixture(overrides = {}) {
  const { record, id } = sample();
  const sends = [];
  const reads = [];
  const deleted = [];
  const keys = pair();
  const handlers = createHandlers({
    getVapid: () => keys,
    verifyToken: async () => ({ uid: 'alice', firebase: { sign_in_provider: 'google.com' } }),
    readSubscription: async (uid, requested) => { reads.push({ uid, id: requested }); return uid === 'alice' && requested === id ? record : null; },
    claimQuota: async () => true,
    deleteSubscription: async (...args) => deleted.push(args),
    sendNotification: async (...args) => sends.push(args),
    ...overrides
  });
  const req = { method: 'POST', get: () => 'Bearer test-id-token', body: { subscriptionId: id } };
  return { handlers, req, keys, id, record, sends, reads, deleted };
}

test('configuration returns only the public key and rejects wrong HTTP methods', async () => {
  const f = fixture();
  const res = response();
  await f.handlers.config({ method: 'GET' }, res);
  assert.deepEqual(res.body, { publicKey: f.keys.publicKey });
  assert.ok(!JSON.stringify(res.body).includes(f.keys.privateKey));
  const denied = response();
  await f.handlers.config({ method: 'POST' }, denied);
  assert.equal(denied.code, 405);
});

test('VAPID configuration verifies that public and private keys match', () => {
  const keys = pair();
  assert.deepEqual(parseVapid(JSON.stringify(keys)), keys);
  assert.throws(() => parseVapid(JSON.stringify({ ...keys, publicKey: pair().publicKey })));
  assert.throws(() => parseVapid('not-json'));
});

test('sender verifies Google identity and reads only that identity’s device', async () => {
  const f = fixture();
  const res = response();
  await f.handlers.sendTest(f.req, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { sent: true });
  assert.deepEqual(f.reads, [{ uid: 'alice', id: f.id }]);
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0][0].endpoint, f.record.endpoint);
  assert.equal(f.sends[0][2].vapidDetails.privateKey, f.keys.privateKey);
});

test('missing, invalid, and anonymous authentication cannot send', async () => {
  for (const override of [
    { verifyToken: async () => { throw new Error('Invalid token'); } },
    { verifyToken: async () => ({ uid: 'alice', firebase: { sign_in_provider: 'anonymous' } }) }
  ]) {
    const f = fixture(override); const res = response();
    await f.handlers.sendTest(f.req, res);
    assert.ok([401, 403].includes(res.code));
    assert.equal(f.sends.length, 0);
  }
  const f = fixture(); const res = response();
  await f.handlers.sendTest({ ...f.req, get: () => undefined }, res);
  assert.equal(res.code, 401);
});

test('another user cannot send to Alice’s device, and callers cannot override ownership or payload', async () => {
  const f = fixture({ verifyToken: async () => ({ uid: 'bob', firebase: { sign_in_provider: 'google.com' } }) });
  const res = response(); await f.handlers.sendTest(f.req, res);
  assert.equal(res.code, 404); assert.equal(f.sends.length, 0);
  for (const field of ['uid', 'endpoint', 'message']) {
    const own = fixture(); const denied = response();
    await own.handlers.sendTest({ ...own.req, body: { ...own.req.body, [field]: 'override' } }, denied);
    assert.equal(denied.code, 400); assert.equal(own.sends.length, 0);
  }
});

test('destination validation prevents requests to private hosts, credentials and arbitrary APIs', () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/test', 'https://127.0.0.1/test',
    'https://169.254.169.254/latest/meta-data/', 'https://internal.example/test',
    'https://fcm.googleapis.com.evil.example/test', 'https://user:password@fcm.googleapis.com/test',
    'https://fcm.googleapis.com:444/test', 'https://evil.notify.windows.com.evil.example/test'
  ]) {
    const { record, id } = sample(endpoint);
    assert.equal(validSubscription(record, id), false);
  }
  for (const endpoint of ['https://web.push.apple.com/token', 'https://updates.push.services.mozilla.com/wpush/v2/token', 'https://wns2.notify.windows.com/w/?token=abc']) {
    const { record, id } = sample(endpoint);
    assert.equal(validSubscription(record, id), true);
  }
  const { record } = sample(); assert.equal(validSubscription(record, 'a'.repeat(64)), false);
});

test('quota denies rapid repeat sends and caps global daily sends', async () => {
  const storage = new Map();
  const transaction = async (path, update) => {
    const next = update(storage.get(path));
    if (next === undefined) return { committed: false };
    storage.set(path, next); return { committed: true };
  };
  const now = Date.UTC(2026, 0, 1);
  assert.equal(await claimQuota(transaction, 'alice', now), true);
  assert.equal(await claimQuota(transaction, 'alice', now + 1000), false);
  assert.equal(await claimQuota(transaction, 'alice', now + 30_000), true);
  storage.set('_pushLimits/global', { day: '2026-01-01', count: 500 });
  assert.equal(await claimQuota(transaction, 'bob', now), false);
  assert.equal(await claimQuota(transaction, 'charlie', now + 86_400_000), true);
});

test('rate limit blocks dispatch and provider 410 prunes the expired owned record', async () => {
  const limited = fixture({ claimQuota: async () => false });
  const res = response(); await limited.handlers.sendTest(limited.req, res);
  assert.equal(res.code, 429); assert.equal(limited.sends.length, 0);
  const expired = fixture({ sendNotification: async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); } });
  const gone = response(); await expired.handlers.sendTest(expired.req, gone);
  assert.equal(gone.code, 410);
  assert.equal(expired.deleted[0][0], 'alice'); assert.equal(expired.deleted[0][1], expired.id);
});

test('unexpected provider failures do not expose endpoint, credentials or raw errors', async () => {
  const f = fixture({ sendNotification: async () => { throw new Error('private-token https://secret.example'); } });
  const res = response(); await f.handlers.sendTest(f.req, res);
  assert.equal(res.code, 503); assert.doesNotMatch(JSON.stringify(res.body), /private-token|secret.example/);
});

test('Web Push library produces encrypted payloads and VAPID authentication without exposing the private key', () => {
  const webpush = require('web-push');
  const { record } = sample();
  const keys = pair();
  const text = 'Encrypted test notification';
  const request = webpush.generateRequestDetails(record, text, {
    TTL: 60, vapidDetails: { subject: 'https://web-push-4u2c.web.app/', ...keys }
  });
  assert.equal(request.endpoint, record.endpoint);
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  assert.match(request.headers.Authorization, /^vapid /);
  assert.ok(!request.body.includes(Buffer.from(text)));
  assert.ok(!JSON.stringify(request.headers).includes(keys.privateKey));
});
