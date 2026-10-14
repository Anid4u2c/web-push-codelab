import { withTimeout } from './timeout.mjs';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { getDatabase, get, query, limitToLast, orderByChild, onValue, ref, remove, set } from 'firebase/database';
import { createDiagnostics } from './diagnostics.mjs';
import { firebaseConfig } from './firebase-config.mjs';
import { loadPushPublicKey, sendMyTestNotification } from './push-api.mjs';
import { decodePublicKey, encodePublicKey, subscriptionId, subscriptionPath } from './subscriptions.mjs';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const diagnostics = createDiagnostics(document);
const signInButton = document.getElementById('signIn');
const signOutButton = document.getElementById('signOut');
const pushButton = document.querySelector('.js-push-btn');
const sendButton = document.getElementById('sendTest');
const retrySetupButton = document.getElementById('retryPushSetup');
const status = document.getElementById('status');
const account = document.getElementById('account');
const details = document.querySelector('.js-subscription-details');
const subscriptionJson = document.getElementById('json');
let registration;
let subscription = null;
let serverPublicKey = '';
let busy = false;
let subscriptionSaved = false;
let authReady = false;
let syncing = 0;
let databaseConnected = false;

function currentKeyMatches() {
  const existing = subscription?.options.applicationServerKey;
  return !!existing && encodePublicKey(existing) === serverPublicKey;
}

function render() {
  const user = auth.currentUser;
  const pending = busy || syncing > 0;
  diagnostics.update({
    'Site': globalThis.location?.origin || 'Local test',
    'Auth domain': firebaseConfig.authDomain,
    'Signed in': user ? 'Yes' : 'No',
    'Secure context': globalThis.isSecureContext ? 'Yes' : 'No',
    'Push supported': 'serviceWorker' in navigator && 'PushManager' in window ? 'Yes' : 'No',
    'Notification permission': window.Notification?.permission || 'Unsupported',
    'Service worker': registration?.active?.state || (registration ? 'Registered' : 'Not registered'),
    'Push backend': serverPublicKey ? 'Public key loaded' : 'Not ready',
    'Subscription': subscription ? 'Present in browser' : 'None',
    'Subscription storage': subscriptionSaved ? 'Saved for this account' : 'Not confirmed',
    'Database connection': databaseConnected ? 'Connected' : 'Disconnected or connecting',
    'Operation': busy ? 'In progress' : syncing ? 'Checking subscription' : 'Idle'
  });
  document.getElementById('notificationHelp').hidden = window.Notification?.permission !== 'denied';
  account.textContent = user ? `Signed in as ${user.displayName || user.email || 'Google user'}` : 'Sign in to manage your subscription.';
  document.getElementById('copyTestHistory').disabled = !user || !document.getElementById('testHistory').textContent;
  document.getElementById('loadTestHistory').disabled = !user || pending;
  if (!user) document.getElementById('testHistory').textContent = '';
  signInButton.hidden = !!user;
  signOutButton.hidden = !user;
  signInButton.disabled = pending || !authReady;
  signOutButton.disabled = pending;
  pushButton.disabled = pending || !user || !registration || !serverPublicKey || window.Notification?.permission === 'denied';
  pushButton.textContent = window.Notification?.permission === 'denied' ? 'Notifications blocked' : subscription ? (currentKeyMatches() ? 'Disable Push Messaging' : 'Update push subscription') : 'Enable Push Messaging';
  sendButton.disabled = pending || !user || !subscription || !subscriptionSaved || !currentKeyMatches();
  document.getElementById('controlHelp').textContent = pending ? 'An operation is in progress. Diagnostics remain available below.'
    : !user ? 'Sign in with Google first.'
    : !registration ? 'Waiting for the service worker. If this persists, reload the page.'
    : !serverPublicKey ? 'The push backend is not ready. Use Retry push setup.'
    : !subscription ? 'Enable push on this device before sending a test.'
    : !currentKeyMatches() ? 'Update this device’s push subscription before sending.'
    : !subscriptionSaved ? 'Your device subscription has not been saved. Use Retry subscription save.'
    : 'Ready to send a test notification to this device.';
  document.getElementById('retrySubscriptionSave').hidden = !user || !subscription || subscriptionSaved || !currentKeyMatches();
  document.getElementById('retrySubscriptionSave').disabled = pending;
  retrySetupButton.hidden = !!serverPublicKey;
  retrySetupButton.disabled = pending;
  details.classList.toggle('is-invisible', !user || !subscription);
  subscriptionJson.textContent = user && subscription ? JSON.stringify(subscription.toJSON(), null, 2) : '';
  if (!user || !subscription) {
    document.getElementById('subscriptionManualCopy').value = '';
    document.getElementById('subscriptionManualCopy').hidden = true;
    document.getElementById('subscriptionFeedback').textContent = '';
  }
}

function showError(error) {
  diagnostics.record('Error', error);
  const messages = {
    'auth/unauthorized-domain': 'This domain is not authorized for Google sign-in in Firebase.',
    'auth/popup-blocked': 'Allow the sign-in popup and try again.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'PERMISSION_DENIED': 'Subscription access was denied. Check that the new database rules are deployed.'
  };
  status.textContent = messages[error.code] || error.message || 'The operation failed. Please try again.';
}

async function perform(action, label = 'Operation') {
  if (busy || syncing > 0) return;
  busy = true;
  status.textContent = '';
  diagnostics.record(`${label} started`);
  render();
  try {
    await action();
    diagnostics.record(`${label} completed`);
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    render();
  }
}

async function recordFor(current) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in before managing subscriptions.');
  const id = await subscriptionId(current.endpoint);
  if (auth.currentUser?.uid !== uid) throw new Error('Your account changed. Please try again.');
  return ref(database, subscriptionPath(uid, id));
}

async function saveCurrentSubscription() {
  const current = subscription;
  if (current) {
    const uid = auth.currentUser?.uid;
    subscriptionSaved = false;
    await withTimeout(set(await recordFor(current), current.toJSON()),
      'Saving the subscription timed out. Check your connection and database access, then retry the save.');
    if (subscription === current && auth.currentUser?.uid === uid) subscriptionSaved = true;
    diagnostics.record('Subscription saved');
  }
}

async function unsubscribe() {
  // Keep the local object until deletion succeeds so a failed database delete can be retried.
  if (!subscription) return;
  const record = await recordFor(subscription);
  const active = await registration.pushManager.getSubscription();
  if (active && !await active.unsubscribe()) throw new Error('Could not unsubscribe. Please try again.');
  await withTimeout(remove(record), 'Removing the subscription timed out. Check your connection and try again.');
  subscription = null;
  subscriptionSaved = false;
}

async function subscribe() {
  const key = decodePublicKey(serverPublicKey);
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Allow notifications to enable push messaging.');
  }
  if (subscription) {
    const existing = subscription.options.applicationServerKey;
    if (!existing || encodePublicKey(existing) !== encodePublicKey(key)) await unsubscribe();
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key
    });
  }
  await saveCurrentSubscription();
  status.textContent = 'Subscription saved. You can now send yourself a test notification.';
}

signInButton.addEventListener('click', () => perform(() => signInWithPopup(auth, new GoogleAuthProvider()), 'Google sign-in'));
signOutButton.addEventListener('click', () => perform(async () => {
  await unsubscribe();
  await signOut(auth);
  status.textContent = 'Signed out and unsubscribed on this browser.';
}));
pushButton.addEventListener('click', () => perform(async () => {
  if (subscription && currentKeyMatches()) {
    await unsubscribe();
    status.textContent = 'Unsubscribed on this browser.';
  } else {
    await subscribe();
  }
}));
sendButton.addEventListener('click', () => perform(async () => {
  await sendMyTestNotification(auth.currentUser, subscription);
  status.textContent = 'The push service accepted your test notification. Check your device notifications.';
}, 'Send test notification'));
document.getElementById('loadTestHistory').addEventListener('click', () => perform(async () => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in to review your tests.');
  const snapshot = await withTimeout(get(query(ref(database, `pushTests/${uid}`), orderByChild('createdAt'), limitToLast(20))),
    'Loading test history timed out. Check the database connection.');
  if (auth.currentUser?.uid !== uid) return;
  const records = Object.values(snapshot.val() || {}).sort((a, b) => b.createdAt - a.createdAt);
  document.getElementById('testHistory').textContent = records.length ? JSON.stringify(records, null, 2) : 'No recorded tests yet.';
}, 'Load test history'));
async function loadBackendKey() {
  serverPublicKey = await loadPushPublicKey();
  diagnostics.record('Backend public key loaded');
  render();
}
retrySetupButton.addEventListener('click', () => perform(loadBackendKey, 'Load push setup'));

async function reconcile(user) {
  syncing += 1;
  render();
  try {
    const current = await withTimeout(registration.pushManager.getSubscription(), 'Checking the browser subscription timed out. Reload the page.');
    if (auth.currentUser?.uid !== user.uid) return;
    subscription = current;
    if (current && !currentKeyMatches()) {
      status.textContent = 'This browser has an older subscription. Click Update push subscription to use the new sender.';
    } else {
      await saveCurrentSubscription();
    }
  } catch (error) {
    if (auth.currentUser?.uid === user.uid) showError(error);
  } finally {
    syncing -= 1;
    render();
  }
}

onAuthStateChanged(auth, async user => {
  authReady = true;
  document.getElementById('testHistory').textContent = '';
  document.getElementById('testHistoryManualCopy').value = '';
  document.getElementById('testHistoryManualCopy').hidden = true;
  document.getElementById('testHistoryFeedback').textContent = '';
  diagnostics.record(user ? 'Auth state: signed in' : 'Auth state: signed out');
  subscription = null;
  subscriptionSaved = false;
  render();
  if (user && registration) await reconcile(user);
});

async function start() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    status.textContent = 'This browser does not support Web Push.';
    return;
  }
  try {
    registration = await navigator.serviceWorker.register('sw.js');
    await withTimeout(navigator.serviceWorker.ready, 'The service worker did not become ready. Reload the page.');
    diagnostics.record('Service worker ready');
    try { await loadBackendKey(); } catch (error) { showError(error); }
    if (auth.currentUser) {
      await reconcile(auth.currentUser);
    }
  } catch (error) {
    showError(error);
  }
  render();
}

document.getElementById('retrySubscriptionSave').addEventListener('click', () => perform(saveCurrentSubscription, 'Save subscription'));

document.getElementById('clearDiagnostics').addEventListener('click', () => diagnostics.clear());
async function copyText(text, feedbackId, manualId, success) {
  const feedback = document.getElementById(feedbackId);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await withTimeout(navigator.clipboard.writeText(text), 'Clipboard timed out.', 5000);
    feedback.textContent = success;
  } catch {
    const manual = document.getElementById(manualId);
    manual.value = text;
    manual.hidden = false;
    manual.focus();
    manual.select();
    feedback.textContent = 'Clipboard access failed. Copy the selected text below.';
  }
}
document.getElementById('copyDiagnostics').addEventListener('click', () =>
  copyText(diagnostics.text(), 'diagnosticsFeedback', 'diagnosticsManualCopy', 'Diagnostics copied.'));
document.getElementById('copyTestHistory').addEventListener('click', () => {
  if (!auth.currentUser || !document.getElementById('testHistory').textContent) return;
  return copyText(document.getElementById('testHistory').textContent, 'testHistoryFeedback', 'testHistoryManualCopy', 'Test history copied.');
});
document.getElementById('copyToClipboard').addEventListener('click', () => {
  if (!subscription || !auth.currentUser) return;
  return copyText(subscriptionJson.textContent, 'subscriptionFeedback', 'subscriptionManualCopy', 'Subscription copied. Keep it private.');
});
onValue(ref(database, '.info/connected'), snapshot => {
  databaseConnected = snapshot.val() === true;
  diagnostics.record(databaseConnected ? 'Database connected' : 'Database disconnected');
  render();
});
document.getElementById('downloadDiagnostics').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([diagnostics.text()], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'push-diagnostics.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Unsupported browsers may not expose Notification at all.
if (!('Notification' in window)) {
  status.textContent = 'This browser does not support notifications.';
  pushButton.disabled = true;
} else {
  start();
}

render();

if (navigator.serviceWorker?.addEventListener) {
  navigator.serviceWorker.addEventListener('message', event => {
    const value = event.data;
    if (value?.type !== 'push-receipt-status' || !['received', 'yes', 'no', 'open'].includes(value.action)) return;
    const result = ['saved', 'already recorded', 'network failure'].includes(value.result) ? value.result
      : /^HTTP [1-5][0-9]{2}$/.test(value.result || '') ? value.result : 'unknown';
    diagnostics.record(`Notification ${value.action} receipt: ${result}`);
  });
}
