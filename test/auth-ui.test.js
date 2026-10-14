const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const code = buildSync({
  entryPoints: ['src/main.mjs'], bundle: true, platform: 'browser', format: 'cjs',
  external: ['firebase/*'], write: false
}).outputFiles[0].text;

async function loadPage(hostname = 'web-push-4u2c.web.app', options = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', style: {}, handlers: {},
      focus() {}, select() {},
      classList: { toggle() {} },
      addEventListener(event, handler) { this.handlers[event] = handler; }
    });
    return elements.get(id);
  }
  let initializedConfig;
  const requests = [];
  const bytes = new Uint8Array(65); bytes[0] = 4;
  const publicKey = Buffer.from(bytes).toString('base64url');
  const writes = [];
  const deletions = [];
  let callback;
  let browserSubscription = null;
  const auth = { currentUser: null };
  const registration = { pushManager: {
    async getSubscription() { return browserSubscription; },
    async subscribe(options) {
      browserSubscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', options,
        toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }),
        async unsubscribe() { browserSubscription = null; return true; }
      };
      return browserSubscription;
    }
  } };
  const modules = {
    'firebase/app': { initializeApp: config => { initializedConfig = config; return {}; } },
    'firebase/auth': {
      getAuth: () => auth, GoogleAuthProvider: class {},
      onAuthStateChanged(_auth, handler) { callback = handler; },
      async signInWithPopup() { auth.currentUser = { uid: 'alice', displayName: 'Alice', getIdToken: async () => 'test-id-token' }; await callback(auth.currentUser); },
      async signOut() { auth.currentUser = null; await callback(null); }
    },
    'firebase/database': {
      getDatabase: () => ({}), ref: (_db, path) => path,
      async set(path, value) { writes.push({ path, value }); if (options.hangSave) await new Promise(() => {}); },
      async remove(path) { deletions.push(path); }
    }
  };
  vm.runInNewContext(code, {
    require: name => modules[name], console, crypto, TextEncoder, atob, btoa, AbortSignal,
    setTimeout: (handler, delay) => setTimeout(handler, options.hangSave ? 20 : delay), clearTimeout,
    location: { hostname },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => url.endsWith('/config') ? { publicKey } : { sent: true } }; },
    window: { PushManager: {}, Notification: { permission: 'granted' } },
    Notification: { permission: 'granted' },
    document: { getElementById: element, querySelector: element },
    navigator: {
      serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) },
      clipboard: { writeText: async () => { if (options.failClipboard) throw new Error('Denied'); } }
    }
  });
  await callback(null);
  await new Promise(resolve => setImmediate(resolve));
  return { element, writes, deletions, auth, callback, initializedConfig, requests };
}

test('signed-out initialization makes no subscription writes; Google sign-in enables controls', async () => {
  const page = await loadPage();
  assert.equal(page.writes.length, 0);
  assert.equal(page.element('.js-push-btn').disabled, true);
  await page.element('signIn').handlers.click();
  assert.equal(page.auth.currentUser.uid, 'alice');
  assert.equal(page.element('.js-push-btn').disabled, false);
});

test('subscription writes are owned by signed-in user and sign-out deletes only that record', async () => {
  const page = await loadPage();
  await page.element('signIn').handlers.click();
  await page.element('.js-push-btn').handlers.click();
  assert.equal(page.writes.length, 1);
  assert.match(page.writes[0].path, /^subscriptions\/alice\/[a-f0-9]{64}$/);
  await page.element('signOut').handlers.click();
  assert.deepEqual(page.deletions, [page.writes[0].path]);
  assert.equal(page.auth.currentUser, null);
  assert.equal(page.element('json').textContent, '');
});

test('Firebase initializes with the domain actually opened in the browser', async () => {
  for (const domain of ['web-push-4u2c.web.app', 'web-push-4u2c.firebaseapp.com']) {
    const page = await loadPage(domain);
    assert.equal(page.initializedConfig.authDomain, domain);
  }
});

test('public key loads automatically and self-test sends only this device ID', async () => {
  const page = await loadPage();
  assert.equal(page.requests[0].url, '/api/push/config');
  assert.equal(page.element('sendTest').disabled, true);
  await page.element('signIn').handlers.click();
  await page.element('.js-push-btn').handlers.click();
  assert.equal(page.element('sendTest').disabled, false);
  await page.element('sendTest').handlers.click();
  const request = page.requests.at(-1);
  assert.equal(request.url, '/api/push/test');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-id-token');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(Object.keys(body), ['subscriptionId']);
  assert.match(body.subscriptionId, /^[a-f0-9]{64}$/);
});


test('diagnostics copying remains available while a database save is pending and has a manual fallback', async () => {
  const page = await loadPage(undefined, { hangSave: true, failClipboard: true });
  await page.element('signIn').handlers.click();
  const save = page.element('.js-push-btn').handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  await page.element('copyDiagnostics').handlers.click();
  assert.match(page.element('diagnosticsFeedback').textContent, /Clipboard access failed/);
  assert.equal(page.element('diagnosticsManualCopy').hidden, false);
  assert.match(page.element('diagnosticsManualCopy').value, /Operation: In progress/);
  await save;
  assert.equal(page.element('signOut').disabled, false);
  assert.equal(page.element('sendTest').disabled, true);
  assert.equal(page.element('retrySubscriptionSave').hidden, false);
  assert.match(page.element('status').textContent, /timed out/);
});
