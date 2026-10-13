import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref, remove, set } from 'firebase/database';

let environment;
const id = 'a'.repeat(64);
const path = `subscriptions/alice/${id}`;
const record = {
  endpoint: 'https://push.example/device-one',
  expirationTime: null,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }
};

before(async () => {
  assert.match(process.env.FIREBASE_DATABASE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):[0-9]+$/, 'Use a local database emulator.');
  environment = await initializeTestEnvironment({
    projectId: 'demo-web-push',
    database: { rules: await readFile('database.rules.json', 'utf8') }
  });
});
after(async () => { await environment?.cleanup(); });
beforeEach(async () => { await environment.clearDatabase(); });

function database(uid) {
  return (uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()).database();
}

test('owner can create, read, update and delete a subscription', async () => {
  const reference = ref(database('alice'), path);
  await assertSucceeds(set(reference, record));
  assert.equal((await assertSucceeds(get(reference))).val().endpoint, record.endpoint);
  await assertSucceeds(set(reference, { ...record, expirationTime: 123 }));
  await assertSucceeds(remove(reference));
});

test('anonymous and other accounts cannot access subscriptions', async () => {
  await assertSucceeds(set(ref(database('alice'), path), record));
  for (const uid of [null, 'bob']) {
    const reference = ref(database(uid), path);
    await assertFails(get(reference));
    await assertFails(set(reference, record));
    await assertFails(remove(reference));
  }
  await assertFails(get(ref(database('alice'), 'subscriptions')));
});

test('global legacy records and unrelated paths are denied', async () => {
  for (const legacy of ['subscription', 'publicKey', 'other']) {
    await assertFails(set(ref(database('alice'), legacy), { key: 'value' }));
    await assertFails(get(ref(database('alice'), legacy)));
  }
});

test('malformed endpoints, keys, ids and extra fields are denied', async () => {
  const reference = ref(database('alice'), path);
  for (const invalid of [
    { ...record, endpoint: 'http://push.example/test' },
    { ...record, endpoint: 'https://' },
    { ...record, endpoint: 'https://push.example/' + 'a'.repeat(2048) },
    { ...record, keys: { ...record.keys, auth: 'short' } },
    { ...record, keys: { ...record.keys, p256dh: 'short' } },
    { ...record, keys: { ...record.keys, extra: true } },
    { ...record, admin: true },
    { endpoint: record.endpoint },
    { ...record, expirationTime: -1 }
  ]) {
    await assertFails(set(reference, invalid));
  }
  await assertFails(set(ref(database('alice'), 'subscriptions/alice/not-a-hash'), record));
});

test('owner can store multiple devices without replacing another device', async () => {
  const db = database('alice');
  await assertSucceeds(set(ref(db, path), record));
  const second = `subscriptions/alice/${'b'.repeat(64)}`;
  await assertSucceeds(set(ref(db, second), { ...record, endpoint: 'https://push.example/device-two' }));
  await assertSucceeds(remove(ref(db, second)));
  assert.equal((await get(ref(db, path))).val().endpoint, record.endpoint);
});
