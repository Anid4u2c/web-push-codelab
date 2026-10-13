import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { getDatabase, ref, remove, set } from 'firebase/database';
import { firebaseConfig } from './firebase-config.mjs';
import { decodePublicKey, encodePublicKey, subscriptionId, subscriptionPath } from './subscriptions.mjs';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const signInButton = document.getElementById('signIn');
const signOutButton = document.getElementById('signOut');
const pushButton = document.querySelector('.js-push-btn');
const keyForm = document.getElementById('keyForm');
const keyInput = document.getElementById('publicKey');
const updateButton = document.getElementById('updatePublicKey');
const status = document.getElementById('status');
const account = document.getElementById('account');
const details = document.querySelector('.js-subscription-details');
const subscriptionJson = document.getElementById('json');
let registration;
let subscription = null;
let busy = false;
let authReady = false;
let syncing = 0;

function render() {
  const user = auth.currentUser;
  const pending = busy || syncing > 0;
  account.textContent = user ? `Signed in as ${user.displayName || user.email || 'Google user'}` : 'Sign in to manage your subscription.';
  signInButton.hidden = !!user;
  signOutButton.hidden = !user;
  signInButton.disabled = pending || !authReady;
  signOutButton.disabled = pending;
  pushButton.disabled = pending || !user || !registration || window.Notification?.permission === 'denied';
  pushButton.textContent = window.Notification?.permission === 'denied' ? 'Notifications blocked' : subscription ? 'Disable Push Messaging' : 'Enable Push Messaging';
  keyInput.disabled = pending || !user || !registration;
  updateButton.disabled = pending || !user || !registration;
  details.classList.toggle('is-invisible', !user || !subscription);
  subscriptionJson.textContent = user && subscription ? JSON.stringify(subscription.toJSON(), null, 2) : '';
}

function showError(error) {
  const messages = {
    'auth/unauthorized-domain': 'This domain is not authorized for Google sign-in in Firebase.',
    'auth/popup-blocked': 'Allow the sign-in popup and try again.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'PERMISSION_DENIED': 'Subscription access was denied. Check that the new database rules are deployed.'
  };
  status.textContent = messages[error.code] || error.message || 'The operation failed. Please try again.';
}

async function perform(action) {
  if (busy || syncing > 0) return;
  busy = true;
  status.textContent = '';
  render();
  try {
    await action();
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
  if (current) await set(await recordFor(current), current.toJSON());
}

async function unsubscribe() {
  // Keep the local object until deletion succeeds so a failed database delete can be retried.
  if (!subscription) return;
  const record = await recordFor(subscription);
  const active = await registration.pushManager.getSubscription();
  if (active && !await active.unsubscribe()) throw new Error('Could not unsubscribe. Please try again.');
  await remove(record);
  subscription = null;
}

async function subscribe() {
  const key = decodePublicKey(keyInput.value.trim());
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
  status.textContent = 'Subscription saved to your account. A message sender is still required.';
}

signInButton.addEventListener('click', () => perform(() => signInWithPopup(auth, new GoogleAuthProvider())));
signOutButton.addEventListener('click', () => perform(async () => {
  await unsubscribe();
  await signOut(auth);
  keyInput.value = '';
  status.textContent = 'Signed out and unsubscribed on this browser.';
}));
pushButton.addEventListener('click', () => perform(async () => {
  if (subscription) {
    await unsubscribe();
    status.textContent = 'Unsubscribed on this browser.';
  } else {
    await subscribe();
  }
}));
keyForm.addEventListener('submit', event => {
  event.preventDefault();
  return perform(subscribe);
});
document.getElementById('copyToClipboard').addEventListener('click', () => perform(async () => {
  if (!subscription || !auth.currentUser) throw new Error('Sign in and subscribe first.');
  await navigator.clipboard.writeText(subscriptionJson.textContent);
  status.textContent = 'Subscription copied. Keep it private.';
}));

async function reconcile(user) {
  syncing += 1;
  render();
  try {
    const current = await registration.pushManager.getSubscription();
    if (auth.currentUser?.uid !== user.uid) return;
    subscription = current;
    if (current?.options.applicationServerKey) keyInput.value = encodePublicKey(current.options.applicationServerKey);
    await saveCurrentSubscription();
  } catch (error) {
    if (auth.currentUser?.uid === user.uid) showError(error);
  } finally {
    syncing -= 1;
    render();
  }
}

onAuthStateChanged(auth, async user => {
  authReady = true;
  subscription = null;
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
    await navigator.serviceWorker.ready;
    if (auth.currentUser) {
      await reconcile(auth.currentUser);
    }
  } catch (error) {
    showError(error);
  }
  render();
}

// Unsupported browsers may not expose Notification at all.
if (!('Notification' in window)) {
  status.textContent = 'This browser does not support notifications.';
  pushButton.disabled = true;
} else {
  start();
}
