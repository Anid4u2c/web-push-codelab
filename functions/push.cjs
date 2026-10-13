const { createECDH, createHash } = require('node:crypto');

const contact = 'https://web-push-4u2c.web.app/';
const message = 'Your Web Push demo is working. This notification was sent to your own device.';

function parseVapid(value) {
  try {
    const pair = JSON.parse(value);
    if (!/^[A-Za-z0-9_-]{43}$/.test(pair.privateKey) || !/^[A-Za-z0-9_-]{87}$/.test(pair.publicKey)) throw new Error();
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(pair.privateKey, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== pair.publicKey) throw new Error();
    return { publicKey: pair.publicKey, privateKey: pair.privateKey };
  } catch {
    throw new Error('The backend VAPID secret is invalid.');
  }
}

function validSubscription(record, id) {
  if (!record || typeof record.endpoint !== 'string' || record.endpoint.length > 2048) return false;
  let url;
  try { url = new URL(record.endpoint); } catch { return false; }
  const provider = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname)
    || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
  if (!provider || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.pathname === '/') return false;
  if (createHash('sha256').update(record.endpoint).digest('hex') !== id) return false;
  const keys = record.keys;
  if (!keys || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth)) return false;
  return Buffer.from(keys.p256dh, 'base64url')[0] === 4;
}

async function claimQuota(transaction, uid, now) {
  const user = await transaction(`_pushLimits/users/${uid}`, current => {
    if (current?.nextAllowedAt > now) return;
    return { nextAllowedAt: now + 30_000 };
  });
  if (!user.committed) return false;
  const day = new Date(now).toISOString().slice(0, 10);
  const global = await transaction('_pushLimits/global', current => {
    const count = current?.day === day ? current.count : 0;
    if (!Number.isInteger(count) || count >= 500) return;
    return { day, count: count + 1 };
  });
  return global.committed;
}

function createHandlers(deps) {
  async function config(req, res) {
    if (req.method !== 'GET') return res.status(405).set('Allow', 'GET').json({ error: 'Use GET.' });
    try {
      const { publicKey } = deps.getVapid();
      return res.set('Cache-Control', 'public, max-age=300, s-maxage=300').json({ publicKey });
    } catch {
      return res.status(503).json({ error: 'Push configuration is not available yet.' });
    }
  }

  async function sendTest(req, res) {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json({ error: 'Use POST.' });
    const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '');
    if (!match) return res.status(401).json({ error: 'Sign in to send a test notification.' });
    let token;
    try { token = await deps.verifyToken(match[1]); } catch {
      return res.status(401).json({ error: 'Sign in again before sending a notification.' });
    }
    if (token.firebase?.sign_in_provider !== 'google.com' || typeof token.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(token.uid)) {
      return res.status(403).json({ error: 'Google sign-in is required.' });
    }
    const data = req.body;
    if (!data || Object.keys(data).length !== 1 || !/^[a-f0-9]{64}$/.test(data.subscriptionId)) {
      return res.status(400).json({ error: 'Supply only this device’s subscription ID.' });
    }
    const id = data.subscriptionId;
    let record;
    let sending = false;
    try {
      record = await deps.readSubscription(token.uid, id);
      if (!record) return res.status(404).json({ error: 'Subscribe this device first.' });
      if (!validSubscription(record, id)) return res.status(400).json({ error: 'This subscription is not supported. Subscribe again using a supported browser.' });
      if (!await deps.claimQuota(token.uid)) return res.status(429).json({ error: 'Please wait 30 seconds before another test. The demo also has a daily send limit.' });
      const pair = deps.getVapid();
      sending = true;
      await deps.sendNotification(record, message, {
        TTL: 60, timeout: 5000,
        vapidDetails: { subject: contact, ...pair }
      });
      return res.json({ sent: true });
    } catch (error) {
      if (sending && [404, 410].includes(error.statusCode)) {
        // A concurrent refresh must not be deleted: storage handles compare-and-delete.
        try { await deps.deleteSubscription(token.uid, id, record); } catch {
          return res.status(503).json({ error: 'The expired subscription could not be removed. Please try again.' });
        }
        return res.status(410).json({ error: 'This subscription expired. Disable push and subscribe again.' });
      }
      return res.status(503).json({ error: 'The push service could not accept the notification. Please try again later.' });
    }
  }
  return { config, sendTest };
}

module.exports = { claimQuota, createHandlers, parseVapid, validSubscription };
