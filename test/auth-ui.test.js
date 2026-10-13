const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const code = buildSync({
  entryPoints: ['src/main.mjs'], bundle: true, platform: 'browser', format: 'cjs',
  external: ['firebase/*'], write: false
}).outputFiles[0].text;

async function loadPage() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', style: {}, handlers: {},
      classList: { toggle() {} },
      addEventListener(event, handler) { this.handlers[event] = handler; }
    });
    return elements.get(id);
  }
  const writes = [];
  const deletions = [];
  let callback;
  let browserSubscription = null;
  const auth = { currentUser: null };
  const registration = { pushManager: {
    async getSubscription() { return browserSubscription; },
    async subscribe() {
      browserSubscription = {
        endpoint: 'https://push.example/device', options: {},
        toJSON: () => ({ endpoint: 'https://push.example/device', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }),
        async unsubscribe() { browserSubscription = null; return true; }
      };
      return browserSubscription;
    }
  } };
  const modules = {
    'firebase/app': { initializeApp: () => ({}) },
    'firebase/auth': {
      getAuth: () => auth, GoogleAuthProvider: class {},
      onAuthStateChanged(_auth, handler) { callback = handler; },
      async signInWithPopup() { auth.currentUser = { uid: 'alice', displayName: 'Alice' }; await callback(auth.currentUser); },
      async signOut() { auth.currentUser = null; await callback(null); }
    },
    'firebase/database': {
      getDatabase: () => ({}), ref: (_db, path) => path,
      async set(path, value) { writes.push({ path, value }); },
      async remove(path) { deletions.push(path); }
    }
  };
  vm.runInNewContext(code, {
    require: name => modules[name], console, crypto, TextEncoder, atob, btoa,
    window: { PushManager: {}, Notification: { permission: 'granted' } },
    Notification: { permission: 'granted' },
    document: { getElementById: element, querySelector: element },
    navigator: {
      serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) },
      clipboard: { writeText: async () => {} }
    }
  });
  await callback(null);
  await new Promise(resolve => setImmediate(resolve));
  return { element, writes, deletions, auth, callback };
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
  const bytes = new Uint8Array(65); bytes[0] = 4;
  page.element('publicKey').value = Buffer.from(bytes).toString('base64url');
  let prevented = false;
  await page.element('keyForm').handlers.submit({ preventDefault() { prevented = true; } });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(page.writes.length, 1);
  assert.match(page.writes[0].path, /^subscriptions\/alice\/[a-f0-9]{64}$/);
  await page.element('signOut').handlers.click();
  assert.deepEqual(page.deletions, [page.writes[0].path]);
  assert.equal(page.auth.currentUser, null);
  assert.equal(page.element('json').textContent, '');
});
