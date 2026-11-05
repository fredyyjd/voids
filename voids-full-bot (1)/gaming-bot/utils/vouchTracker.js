const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/* =========================================================
   VOUCH TRACKER

   Watches the vouch channels for:   vouch @user optional comment
   - every one is saved (also old ones, found by scanning the channel)
   - you can't vouch yourself
   - the same message is never counted twice
   - the same person can vouch the same user again, but only once per
     COOLDOWN (a faster one is ignored, not counted)
   - the vouched person gets a DM with a "Mute Alerts" button
   - /vouch lb and /vouch see read from what is saved here

   data file: {
     vouches: { [messageId]: { voucherId, targetId, comment, channelId, guildId, ts } },
     muted:   [userId, ...],
     scanned: { [channelId]: newestScannedMessageId }
   }
========================================================= */

const VOUCH_CHANNEL_IDS = ['1527240245928656916', '1492831213277151234'];

const MUTE_BUTTON_ID = 'vouchalerts_mute';
const MAX_COMMENT = 500;
const MAX_SCAN_PAGES = 5000; // 100 messages each, per channel (500k messages)

// The same person vouching the same user again within this time doesn't count.
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const FILE = path.join(DATA_DIR, 'vouches.json');

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      vouches: data.vouches || {},
      muted: data.muted || [],
      scanned: data.scanned || {},
    };
  } catch {
    return { vouches: {}, muted: [], scanned: {} };
  }
}

// Kept in memory, written to disk whenever it changes.
const state = load();

// "voucher>target" -> [timestamps of counted vouches], for the cooldown check
const pairKey = (voucherId, targetId) => `${voucherId}>${targetId}`;
const pairTimes = new Map();

function indexAdd(v) {
  const key = pairKey(v.voucherId, v.targetId);
  if (!pairTimes.has(key)) pairTimes.set(key, []);
  pairTimes.get(key).push(v.ts);
}

function indexRemove(v) {
  const times = pairTimes.get(pairKey(v.voucherId, v.targetId));
  const i = times ? times.indexOf(v.ts) : -1;
  if (i !== -1) times.splice(i, 1);
}

for (const v of Object.values(state.vouches)) indexAdd(v);

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch (err) {
    console.error('[vouch] could not save:', err);
  }
}


/* =========================================================
   PARSING + STORING
========================================================= */

// "vouch @user great trade" -> { targetId, comment }
function parseVouch(content) {
  const match = String(content || '')
    .trim()
    .match(/^vouch\s+<@!?(\d{15,25})>\s*([\s\S]*)$/i);

  if (!match) return null;

  return {
    targetId: match[1],
    comment: match[2].trim().slice(0, MAX_COMMENT),
  };
}

// Turns a message into a vouch candidate, or null when it isn't in the
// "vouch @user comment" format. Doesn't save anything.
function candidateFrom(message) {
  if (!VOUCH_CHANNEL_IDS.includes(message.channelId)) return null;
  if (!message.author || message.author.bot) return null;

  const parsed = parseVouch(message.content);
  if (!parsed) return null;

  return {
    messageId: message.id,
    voucherId: message.author.id,
    targetId: parsed.targetId,
    comment: parsed.comment,
    channelId: message.channelId,
    guildId: message.guildId || null,
    ts: message.createdTimestamp,
  };
}

// Applies the rules and saves the vouch when it passes.
// Returns { record } or { reason: 'dupe' | 'self' | 'cooldown' }.
function tryRecord(candidate) {
  if (state.vouches[candidate.messageId]) return { reason: 'dupe' };
  if (candidate.targetId === candidate.voucherId) return { reason: 'self' };

  const times = pairTimes.get(pairKey(candidate.voucherId, candidate.targetId)) || [];
  if (times.some((t) => t <= candidate.ts && candidate.ts - t < COOLDOWN_MS)) {
    return { reason: 'cooldown' };
  }

  const { messageId, ...record } = candidate;
  state.vouches[messageId] = record;
  indexAdd(record);
  save();

  return { record };
}

// Live messages: { record } when counted, { reason } when ignored,
// {} when the message isn't a vouch at all.
function recordFromMessage(message) {
  const candidate = candidateFrom(message);
  return candidate ? tryRecord(candidate) : {};
}

function removeVouches(messageIds) {
  let changed = false;

  for (const id of messageIds) {
    if (state.vouches[id]) {
      indexRemove(state.vouches[id]);
      delete state.vouches[id];
      changed = true;
    }
  }

  if (changed) save();
}


/* =========================================================
   READING
========================================================= */

function countFor(userId) {
  let n = 0;
  for (const v of Object.values(state.vouches)) if (v.targetId === userId) n++;
  return n;
}

// Newest first.
function vouchesFor(userId) {
  return Object.entries(state.vouches)
    .filter(([, v]) => v.targetId === userId)
    .map(([messageId, v]) => ({ messageId, ...v }))
    .sort((a, b) => b.ts - a.ts);
}

// [{ userId, count }] biggest first.
function leaderboard() {
  const counts = new Map();
  for (const v of Object.values(state.vouches)) {
    counts.set(v.targetId, (counts.get(v.targetId) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count);
}

const totalVouches = () => Object.keys(state.vouches).length;

const messageUrl = (v) =>
  v.guildId ? `https://discord.com/channels/${v.guildId}/${v.channelId}/${v.messageId}` : null;


/* =========================================================
   DM ALERT + MUTE BUTTON
========================================================= */

const isMuted = (userId) => state.muted.includes(userId);

function muteAlerts(userId) {
  if (!state.muted.includes(userId)) {
    state.muted.push(userId);
    save();
  }
}

function muteRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(MUTE_BUTTON_ID)
      .setLabel(disabled ? 'Alerts Muted' : 'Mute Alerts')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

async function sendAlert(client, record) {
  if (isMuted(record.targetId)) return;

  const count = countFor(record.targetId);

  try {
    const user = await client.users.fetch(record.targetId);
    await user.send({
      content: `You just got vouched by <@${record.voucherId}> in <#${record.channelId}>, you now have **${count}** vouch${count === 1 ? '' : 'es'}.`,
      components: [muteRow()],
    });
  } catch {
    // DMs closed, nothing to do
  }
}


/* =========================================================
   SCANNING THE CHANNELS
   First run reads the whole history (newest -> oldest). After that
   only messages newer than the last scanned one are read, so
   vouches made while the bot was offline are still picked up.
========================================================= */

const maxId = (batch) => batch.reduce((a, m) => (BigInt(m.id) > BigInt(a) ? m.id : a), batch.first().id);
const minId = (batch) => batch.reduce((a, m) => (BigInt(m.id) < BigInt(a) ? m.id : a), batch.first().id);

// Reads the channel and returns the vouch-looking messages plus the newest
// message id seen. They are applied oldest -> newest afterwards, so the
// cooldown works the same way it would have live.
async function readChannel(client, channelId, { full }) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages) {
    console.warn(`[vouch] can't read channel ${channelId}`);
    return null;
  }

  const last = full ? null : state.scanned[channelId];
  let newest = last || null;
  const found = [];
  let pages = 0;

  const take = (batch) => {
    for (const message of batch.values()) {
      if (!newest || BigInt(message.id) > BigInt(newest)) newest = message.id;
      const candidate = candidateFrom(message);
      if (candidate) found.push(candidate);
    }
  };

  const progress = () => {
    pages++;
    if (pages % 50 === 0) console.log(`[vouch] ${channelId}: read ${pages * 100} messages...`);
  };

  if (last) {
    let after = last;
    for (let page = 0; page < MAX_SCAN_PAGES; page++) {
      const batch = await channel.messages.fetch({ limit: 100, after }).catch(() => null);
      if (!batch || !batch.size) break;
      take(batch);
      after = maxId(batch);
      progress();
    }
  } else {
    let before;
    for (let page = 0; page < MAX_SCAN_PAGES; page++) {
      const batch = await channel.messages
        .fetch(before ? { limit: 100, before } : { limit: 100 })
        .catch(() => null);
      if (!batch || !batch.size) break;
      take(batch);
      before = minId(batch);
      progress();
      if (batch.size < 100) break;
    }
  }

  found.sort((a, b) => (BigInt(a.messageId) > BigInt(b.messageId) ? 1 : -1));
  return { found, newest };
}

let scanning = false;

// full = true ignores where the last scan stopped and reads the whole history
// again (vouches already saved are skipped, so nothing is counted twice).
// Returns { added, skipped } or null if a scan is already running.
async function scanAll(client, { full = false } = {}) {
  if (scanning) return null;
  scanning = true;

  const totals = { added: 0, skipped: 0 };

  try {
    for (const channelId of VOUCH_CHANNEL_IDS) {
      const result = await readChannel(client, channelId, { full });
      if (!result) continue;

      let added = 0;
      for (const candidate of result.found) {
        const outcome = tryRecord(candidate);
        if (outcome.record) added++;
        else if (outcome.reason !== 'dupe') totals.skipped++;
      }

      if (result.newest) state.scanned[channelId] = result.newest;
      save();

      totals.added += added;
      console.log(`[vouch] scanned ${channelId}: ${added} new vouches`);
    }
  } finally {
    scanning = false;
  }

  return totals;
}

module.exports = {
  VOUCH_CHANNEL_IDS,
  MUTE_BUTTON_ID,
  COOLDOWN_MS,
  parseVouch,
  recordFromMessage,
  removeVouches,
  countFor,
  vouchesFor,
  leaderboard,
  totalVouches,
  messageUrl,
  muteAlerts,
  muteRow,
  sendAlert,
  scanAll,
};
