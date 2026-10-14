/*
*
*  Push Notifications codelab
*  Copyright 2015 Google Inc. All rights reserved.
*
*  Licensed under the Apache License, Version 2.0 (the "License");
*  you may not use this file except in compliance with the License.
*  You may obtain a copy of the License at
*
*      https://www.apache.org/licenses/LICENSE-2.0
*
*  Unless required by applicable law or agreed to in writing, software
*  distributed under the License is distributed on an "AS IS" BASIS,
*  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*  See the License for the specific language governing permissions and
*  limitations under the License
*
*/


'use strict';


self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function receiverId() {
  const subscription = await self.registration.pushManager.getSubscription();
  if (!subscription) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function notifyReceipt(action, result) {
  const windows = clients.matchAll ? await clients.matchAll({ type: 'window', includeUncontrolled: true }) : [];
  for (const client of windows) {
    if (client.url?.startsWith(self.registration.scope)) client.postMessage({ type: 'push-receipt-status', action, result });
  }
}

async function report(data, action, navigation = 'not requested') {
  if (!data?.testId || !data?.receiptToken) return;
  try {
    const response = await fetch(new URL('api/push/receipt', self.registration.scope), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testId: data.testId, receiptToken: data.receiptToken,
        receiverSubscriptionId: data.receiverSubscriptionId ?? null, action,
        clientTime: Date.now(), navigation }),
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.json().catch(() => ({}));
    await notifyReceipt(action, response.ok ? (body.recorded ? 'saved' : 'already recorded') : `HTTP ${response.status}`);
  } catch {
    await notifyReceipt(action, 'network failure');
    // Delivery/click records are best effort. Never log the capability or subscription.
    console.log('[Service Worker] Receipt could not be submitted.');
  }
}

self.addEventListener('push', function(event) {
  event.waitUntil((async () => {
    const text = (event.data && event.data.text()) || 'Yay it works.';
    let payload;
    try { payload = JSON.parse(text); } catch { /* Historical senders used plain text. */ }
    const tracked = payload?.version === 1 && /^[a-f0-9]{32}$/.test(payload.testId)
      && /^[A-Za-z0-9_-]{43}$/.test(payload.receiptToken);
    let id = null;
    if (tracked) {
      try { id = await receiverId(); } catch { /* Unknown subscription is recorded explicitly. */ }
    }
    const data = tracked ? { testId: payload.testId, receiptToken: payload.receiptToken, receiverSubscriptionId: id } : {};
    await self.registration.showNotification('Push Codelab', {
      body: tracked ? 'Did you send this test notification from the browser on this device?' : text,
      icon: 'images/icon.png', badge: 'images/badge.png',
      tag: tracked ? payload.testId : 'request', data,
      actions: [{ action: 'yes', title: 'Yes', icon: 'images/yes.png' },
        { action: 'no', title: 'No', icon: 'images/no.png' }]
    });
    await report(data, 'received');
  })());
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL('./', self.registration.scope).href;
    const windows = clients.matchAll ? await clients.matchAll({ type: 'window', includeUncontrolled: true }) : [];
    const existing = windows.find(client => client.url.split('#')[0] === url);
    let navigation = 'failed';
    try {
      if (existing) { await existing.focus(); navigation = 'existing tab'; }
      else { await clients.openWindow(url); navigation = 'new tab'; }
    } catch { /* Preserve the answer even if the browser cannot open the site. */ }
    await report(event.notification.data, ['yes', 'no'].includes(event.action) ? event.action : 'open', navigation);
  })());
});

// Chrome's own Unsubscribe action is controlled by the browser, not this handler.
// Reconcile subscriptions when the app is next opened.
