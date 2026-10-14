import { withTimeout } from './timeout.mjs';
import { decodePublicKey, subscriptionId } from './subscriptions.mjs';

export async function loadPushPublicKey(fetcher = fetch) {
  const response = await fetcher('/api/push/config', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Push setup is not available yet. Try again after the backend is deployed.');
  const { publicKey } = await response.json();
  decodePublicKey(publicKey);
  return publicKey;
}

export async function sendMyTestNotification(user, subscription, fetcher = fetch) {
  if (!user || !subscription) throw new Error('Sign in and subscribe this device first.');
  const id = await subscriptionId(subscription.endpoint);
  const token = await withTimeout(user.getIdToken(), 'Sign-in verification timed out. Check your connection and sign in again.');
  const response = await fetcher('/api/push/test', {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscriptionId: id })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The test notification could not be sent.');
}
