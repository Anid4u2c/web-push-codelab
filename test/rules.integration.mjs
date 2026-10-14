import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import push from '../functions/push.cjs';
import { get, ref, remove, set, runTransaction } from 'firebase/database';

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
  for (const legacy of ['subscription', 'publicKey', 'other', '_pushLimits']) {
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

test('quota transactions allow only one concurrent send per user and honor the global cap', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.database();
    const transaction = (path, update) => runTransaction(ref(db, path), update, { applyLocally: false });
    const now = Date.UTC(2026, 0, 1);
    const results = await Promise.all([
      push.claimQuota(transaction, 'alice', now),
      push.claimQuota(transaction, 'alice', now)
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await get(ref(db, '_pushLimits/global'))).val().count, 1);
    await set(ref(db, '_pushLimits/global'), { day: '2026-01-01', count: 500 });
    assert.equal(await push.claimQuota(transaction, 'bob', now), false);
  });
});


test('test history is owner-readable and server-write-only; receipt capabilities stay private', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'pushTests/alice/test-one'), { createdAt: 123, senderSubscriptionId: id });
    await set(ref(context.database(), '_pushTestReceipts/test-one'), { tokenHash: 'private-capability-hash' });
  });
  await assertSucceeds(get(ref(database('alice'), 'pushTests/alice')));
  for (const uid of ['alice', 'bob', null]) {
    await assertFails(set(ref(database(uid), 'pushTests/alice/test-one'), { createdAt: 456 }));
    await assertFails(remove(ref(database(uid), 'pushTests/alice/test-one')));
    await assertFails(get(ref(database(uid), '_pushTestReceipts/test-one')));
  }
  await assertFails(get(ref(database('bob'), 'pushTests/alice')));
  await assertFails(get(ref(database(null), 'pushTests/alice')));
});


test('receipt transaction reads existing record before using a missing-record abort', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'pushTests/alice/cold-cache'), { createdAt: 123 });
  });
  await environment.withSecurityRulesDisabled(async context => {
    const reference = ref(context.database(), 'pushTests/alice/cold-cache');
    await get(reference);
    const result = await runTransaction(reference, current => current ? { ...current, response: { action: 'yes' } } : null);
    assert.equal(result.committed, true);
    assert.equal(result.snapshot.val().response.action, 'yes');
  });
});
