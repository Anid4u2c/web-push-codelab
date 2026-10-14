const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadWorker() {
  const handlers = {};
  const notifications = [];
  const windows = [];
  const receipts = [];
  vm.runInNewContext(fs.readFileSync('app/sw.js', 'utf8'), {
    console: { log() {} },
    URL, crypto, TextEncoder, AbortSignal,
    fetch: async (_url, options) => { receipts.push(JSON.parse(options.body)); return { ok: true }; },
    self: {
      addEventListener(name, handler) { handlers[name] = handler; },
      registration: {
        pushManager: { getSubscription: async () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/device-test' }) },
        scope: 'https://web-push-4u2c.web.app/',
        showNotification(title, options) {
          notifications.push({ title, options });
          return Promise.resolve();
        }
      }
    },
    clients: {
      openWindow(url) {
        windows.push(url);
        return Promise.resolve();
      }
    }
  });
  return { handlers, notifications, windows, receipts };
}

for (const [label, data, expected] of [
  ['missing', null, 'Yay it works.'],
  ['empty', { text: () => '' }, 'Yay it works.'],
  ['text', { text: () => 'Hello' }, 'Hello']
]) {
  test(`push handles ${label} payload`, async () => {
    const worker = loadWorker();
    let completion;
    worker.handlers.push({ data, waitUntil(promise) { completion = promise; } });
    assert.ok(completion);
    await completion;
    assert.equal(worker.notifications.length, 1);
    assert.equal(worker.notifications[0].options.body, expected);
  });
}

test('notification click closes the notification and opens the app', async () => {
  const worker = loadWorker();
  let closed = false;
  let completion;
  worker.handlers.notificationclick({
    notification: { close() { closed = true; } },
    waitUntil(promise) { completion = promise; }
  });
  assert.ok(completion);
  await completion;
  assert.equal(closed, true);
  assert.deepEqual(worker.windows, ['https://web-push-4u2c.web.app/']);
});


test('tracked notification records receiving subscription and the clicked answer separately', async () => {
  const worker = loadWorker();
  let completion;
  worker.handlers.push({ data: { text: () => JSON.stringify({ version: 1, testId: 'a'.repeat(32), receiptToken: 'B'.repeat(43) }) },
    waitUntil(promise) { completion = promise; } });
  await completion;
  const notification = worker.notifications[0];
  assert.equal(notification.options.body, 'Did you send this test notification from the browser on this device?');
  assert.match(worker.receipts[0].receiverSubscriptionId, /^[a-f0-9]{64}$/);
  assert.equal(worker.receipts[0].action, 'received');
  worker.handlers.notificationclick({ action: 'no', notification: { close() {}, data: notification.options.data },
    waitUntil(promise) { completion = promise; } });
  await completion;
  assert.equal(worker.receipts[1].action, 'no');
  assert.equal(worker.receipts[1].navigation, 'new tab');
  assert.equal(worker.receipts[1].testId, worker.receipts[0].testId);
});
