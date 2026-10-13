const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadWorker() {
  const handlers = {};
  const notifications = [];
  const windows = [];
  vm.runInNewContext(fs.readFileSync('app/sw.js', 'utf8'), {
    console: { log() {} },
    URL,
    self: {
      addEventListener(name, handler) { handlers[name] = handler; },
      registration: {
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
  return { handlers, notifications, windows };
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
