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

/* eslint-env browser, serviceworker, es6 */

'use strict';
/* eslint-disable max-len */

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push Received.');
  console.log(`[Service Worker] Push had this data: "${event.data.text()}"`);

  let body = event.data.text() || 'Yay it works.';

  const title = 'Push Codelab';
  const options = {
    body: body,
    icon: 'images/icon.png',
    badge: 'images/badge.png',
    tag: 'request',
    actions: [
      {action: 'yes', title: 'Yes', icon: 'images/yes.png'},
      {action: 'no', title: 'No', icon: 'images/no.png'}
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Notification click Received.');

  event.notification.close();

  event.waitUntil(
    clients.openWindow('https://developers.google.com/web/')
  );

});

self.addEventListener('pushsubscriptionchange', function(event) {
	console.log('[Service Worker]: \'pushsubscriptionchange\' event fired.');
	event.waitUntil(
		self.registration.pushManager.subscribe({ userVisibleOnly: true })
			.then(function(subscription) {
				console.log('[Service Worker] New subscription: ', subscription);
				console.log('Subscribed after expiration', subscription.endpoint);
				return fetch('register', {
					method: 'post',
					headers: {
						'Content-type': 'application/json'
					},
					body: JSON.stringify({
						endpoint: subscription.endpoint
					})
				});
			})
	);
});

/* eslint-enable max-len */
