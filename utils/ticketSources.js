const createStore = require('./jsonStore');

const store = createStore('ticket_sources.json', {});
const sending = new Set();
const MAX_AGE = 120 * 24 * 60 * 60 * 1000;

function prune() {
  const all = store.all();
  const now = Date.now();
  let changed = false;

  for (const [key, value] of Object.entries(all)) {
    if (!value?.at || now - value.at > MAX_AGE) {
      delete all[key];
      changed = true;
    }
  }

  if (changed) store.overwriteAll(all);
}

function recordSource(channelId, data) {
  prune();
  store.set(channelId, { ...data, at: Date.now(), paymentSent: false });
}

function getSource(channelId) {
  return store.get(channelId) || null;
}

function isClaimButtonTicket(channelId) {
  return getSource(channelId)?.source === 'claim_button';
}

async function sendPaymentMessage(channel, userId, hostId) {
  if (!channel || !userId || !hostId) return false;
  if (sending.has(channel.id)) return false;

  const record = getSource(channel.id);
  if (!record || record.source !== 'claim_button' || record.paymentSent) return false;

  sending.add(channel.id);

  try {
    await channel.send({
      content: `Hey <@${userId}>, <@${hostId}> will pay you soon!`,
      allowedMentions: { parse: [], users: [userId, hostId] },
    });
    store.set(channel.id, { ...record, paymentSent: true });
    return true;
  } catch (err) {
    console.error('[ticket] could not send payment message:', err);
    return false;
  } finally {
    sending.delete(channel.id);
  }
}

function removeSource(channelId) {
  store.delete(channelId);
}

module.exports = { recordSource, getSource, isClaimButtonTicket, sendPaymentMessage, removeSource };
