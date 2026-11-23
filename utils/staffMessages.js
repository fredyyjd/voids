const cfg = require('./staffConfig');

const rules = cfg.messages;
const MIN = 60 * 1000;

const URL_RE = /https?:\/\/\S+/gi;
const MENTION_RE = /<(?:@[!&]?|#)\d+>/g;
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;
const UNICODE_EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
const COMMAND_RE = /^[!./$?\-+]\w+/;

// Human messages seen per channel, used to tell a conversation from a monologue.
const channelLog = new Map(); // channelId -> [{ authorId, at }]
const userLog = new Map(); // userId -> { times: [], recent: [] }
const counted = new Map(); // messageId -> { userId, at, week, day }

function reset() {
  channelLog.clear();
  userLog.clear();
  counted.clear();
}

function clean(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(URL_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(CUSTOM_EMOJI_RE, ' ')
    .replace(UNICODE_EMOJI_RE, ' ')
    .replace(/[*_~`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(text) {
  return clean(text)
    .toLowerCase()
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// Is the text itself meaningful? Returns null when it is, otherwise the reason.
function junkReason(text) {
  const cleaned = clean(text);
  if (!cleaned) return 'empty';
  if (COMMAND_RE.test(cleaned) && cleaned.split(' ').length <= 3) return 'command';

  const letters = (cleaned.match(/[\p{L}\p{N}]/gu) || []).length;
  if (letters < rules.minChars) return 'too short';
  if (letters / cleaned.length < 0.5) return 'mostly symbols';

  const words = cleaned
    .toLowerCase()
    .split(' ')
    .filter((w) => (w.match(/[\p{L}\p{N}]/gu) || []).length >= 2);
  if (words.length < rules.minWords) return 'too few words';

  if (words.length >= 4 && new Set(words).size / words.length < 0.5) return 'repeated words';
  if (/(.)\1{5,}/u.test(cleaned)) return 'repeated characters';

  // Keyboard smash: a long latin word with almost no vowels.
  const latin = cleaned.toLowerCase().match(/[a-z]+/g) || [];
  const smash = latin.some((w) => w.length >= 8 && (w.match(/[aeiouy]/g) || []).length / w.length < 0.15);
  if (smash) return 'gibberish';

  return null;
}

function observe(message, now = Date.now()) {
  if (!message?.channelId || !message.author || message.author.bot || message.webhookId) return;
  const list = channelLog.get(message.channelId) || [];
  list.push({ authorId: message.author.id, at: now });
  if (list.length > 8) list.shift();
  channelLog.set(message.channelId, list);
}

function hasConversationPartner(message, now) {
  const repliedTo = message.mentions?.repliedUser;
  if (message.reference && repliedTo && !repliedTo.bot && repliedTo.id !== message.author.id) return true;

  const window = rules.conversationWindowMinutes * MIN;
  const list = channelLog.get(message.channelId) || [];

  // The current message was already observed, so only look at the others.
  return list.slice(0, -1).some((e) => e.authorId !== message.author.id && now - e.at <= window);
}

function isExcludedChannel(channel) {
  if (!channel) return false;
  const ids = new Set([channel.id]);
  if (typeof channel.isThread === 'function' && channel.isThread() && channel.parentId) ids.add(channel.parentId);

  if ([...ids].some((id) => cfg.excludedMessageChannelIds.includes(id))) return true;

  if (cfg.excludeTicketChannels) {
    const category = channel.isThread?.() ? channel.parent?.parentId : channel.parentId;
    if (category && cfg.ticketCategoryIds.has(category)) return true;
  }
  return false;
}

// Decides whether one message is genuine activity. Returns { ok, reason }.
// Call observe() for every human message first.
function evaluate(message, now = Date.now()) {
  if (!message.guild || !message.author || message.author.bot || message.webhookId || message.system) {
    return { ok: false, reason: 'not a member message' };
  }
  if (message.type !== 0 && message.type !== 19) return { ok: false, reason: 'system message' };
  if (isExcludedChannel(message.channel)) return { ok: false, reason: 'excluded channel' };

  const junk = junkReason(message.content);
  if (junk) return { ok: false, reason: junk };

  if (!hasConversationPartner(message, now)) return { ok: false, reason: 'no conversation' };

  const entry = userLog.get(message.author.id) || { times: [], recent: [] };
  entry.times = entry.times.filter((t) => now - t < 24 * 60 * MIN);

  const last = entry.times[entry.times.length - 1] || 0;
  if (now - last < rules.minGapSeconds * 1000) return { ok: false, reason: 'too fast' };
  if (entry.times.filter((t) => now - t < 60 * MIN).length >= rules.maxPerHour) return { ok: false, reason: 'hourly cap' };
  if (entry.times.length >= rules.maxPerDay) return { ok: false, reason: 'daily cap' };

  const norm = normalize(message.content);
  if (entry.recent.some((r) => r === norm || (norm.length >= 12 && r.includes(norm)))) {
    return { ok: false, reason: 'duplicate' };
  }

  entry.times.push(now);
  entry.recent.push(norm);
  if (entry.recent.length > 6) entry.recent.shift();
  userLog.set(message.author.id, entry);

  return { ok: true };
}

function remember(messageId, info) {
  counted.set(messageId, info);
  if (counted.size > 5000) {
    const cutoff = Date.now() - 30 * MIN;
    for (const [id, e] of counted) if (e.at < cutoff) counted.delete(id);
  }
}

function forget(messageId, now = Date.now()) {
  const info = counted.get(messageId);
  if (!info) return null;
  counted.delete(messageId);
  return now - info.at <= 30 * MIN ? info : null;
}

function cleanup(now = Date.now()) {
  for (const [id, list] of channelLog) {
    const fresh = list.filter((e) => now - e.at <= rules.conversationWindowMinutes * MIN);
    if (fresh.length) channelLog.set(id, fresh);
    else channelLog.delete(id);
  }
  for (const [id, entry] of userLog) {
    if (!entry.times.some((t) => now - t < 24 * 60 * MIN)) userLog.delete(id);
  }
  for (const [id, e] of counted) if (now - e.at > 30 * MIN) counted.delete(id);
}

module.exports = { observe, evaluate, remember, forget, cleanup, junkReason, normalize, reset };
