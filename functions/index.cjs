const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const webpush = require('web-push');
const { claimQuota, createHandlers, parseVapid } = require('./push.cjs');

initializeApp({ databaseURL: 'https://web-push-4u2c.firebaseio.com' });
const database = getDatabase();
const vapid = defineSecret('WEB_PUSH_VAPID');
const handlers = createHandlers({
  getVapid: () => parseVapid(vapid.value()),
  verifyToken: token => getAuth().verifyIdToken(token),
  readSubscription: async (uid, id) => (await database.ref(`subscriptions/${uid}/${id}`).get()).val(),
  deleteSubscription: async (uid, id, expired) => database.ref(`subscriptions/${uid}/${id}`).transaction(current => {
    if (current?.endpoint === expired.endpoint && current?.keys?.auth === expired.keys.auth
      && current?.keys?.p256dh === expired.keys.p256dh) return null;
    return;
  }),
  claimQuota: uid => claimQuota((path, update) => database.ref(path).transaction(update), uid, Date.now()),
  sendNotification: (subscription, body, options) => webpush.sendNotification(subscription, body, options)
});
const options = {
  region: 'us-central1', memory: '256MiB', maxInstances: 1, concurrency: 10,
  timeoutSeconds: 15, invoker: 'public', secrets: [vapid],
  serviceAccount: 'web-push-runtime@web-push-4u2c.iam.gserviceaccount.com'
};
exports.pushConfig = onRequest(options, handlers.config);
exports.testPush = onRequest(options, handlers.sendTest);
