export function subscriptionPath(uid, id) {
  if (!uid || /[.#$[\]/]/.test(uid) || !/^[a-f0-9]{64}$/.test(id)) {
    throw new Error('Invalid subscription owner or identifier.');
  }
  return `subscriptions/${uid}/${id}`;
}

export async function subscriptionId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function decodePublicKey(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Enter a valid VAPID public key.');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Enter a valid VAPID public key.');
  return bytes;
}

export function encodePublicKey(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
