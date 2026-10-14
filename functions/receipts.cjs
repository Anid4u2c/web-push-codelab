const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const question = 'Did you send this test notification from the browser on this device?';
const hash = value => createHash('sha256').update(value).digest('hex');
function newTest(subscriptionId, now = Date.now()) {
  const testId = randomBytes(16).toString('hex');
  const receiptToken = randomBytes(32).toString('base64url');
  return { testId, receiptToken, tokenHash: hash(receiptToken), record: {
    testId, senderSubscriptionId: subscriptionId, targetSubscriptionId: subscriptionId,
    createdAt: now, expiresAt: now + 86400000, deliveryStatus: 'pending', question
  } };
}
function compareAnswer(sender, receiver, action) {
  if (!receiver || !['yes', 'no'].includes(action)) return 'not evaluated';
  return (sender === receiver) === (action === 'yes') ? 'consistent' : 'response mismatch';
}
function createReceiptHandler(deps) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    const data = req.body;
    if (!data || Object.keys(data).some(key => !['testId', 'receiptToken', 'receiverSubscriptionId', 'action', 'clientTime', 'navigation'].includes(key))
      || !/^[a-f0-9]{32}$/.test(data.testId || '') || !/^[A-Za-z0-9_-]{43}$/.test(data.receiptToken || '')
      || !['received', 'yes', 'no', 'open'].includes(data.action)
      || !(data.receiverSubscriptionId === null || /^[a-f0-9]{64}$/.test(data.receiverSubscriptionId || ''))
      || !['not requested', 'existing tab', 'new tab', 'failed'].includes(data.navigation)
      || !Number.isSafeInteger(data.clientTime) || data.clientTime < 0) return res.status(400).json({ error: 'Invalid receipt.' });
    try {
      const capability = await deps.readCapability(data.testId);
      const now = Date.now();
      if (!capability || capability.expiresAt < now
        || !/^[a-f0-9]{64}$/.test(capability.tokenHash || '')
        || !timingSafeEqual(Buffer.from(capability.tokenHash, 'hex'), Buffer.from(hash(data.receiptToken), 'hex'))) {
        return res.status(403).json({ error: 'Receipt expired or invalid.' });
      }
      const result = await deps.updateTest(capability.uid, data.testId, current => {
        if (!current || current.expiresAt < now) return;
        const field = data.action === 'received' ? 'receipt' : 'response';
        if (current[field]) return; // First receipt and first answer are immutable; duplicates cannot flip the result.
        return { ...current, [field]: {
          action: data.action, reportedReceiverSubscriptionId: data.receiverSubscriptionId,
          clientTime: data.clientTime, recordedAt: now, navigation: data.navigation,
          sameBrowserSubscription: data.receiverSubscriptionId === null ? 'unknown' : current.senderSubscriptionId === data.receiverSubscriptionId,
          answerComparison: compareAnswer(current.senderSubscriptionId, data.receiverSubscriptionId, data.action)
        } };
      });
      return res.json({ recorded: !!result.committed });
    } catch {
      return res.status(503).json({ error: 'Receipt could not be recorded.' });
    }
  };
}
module.exports = { newTest, compareAnswer, createReceiptHandler };
