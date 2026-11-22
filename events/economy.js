const economy = require('../utils/economy');
const achievements = require('../utils/achievements');
const staffCfg = require('../utils/staffConfig');
const { EMOJI, COUNTING, ACTIVITY } = require('../utils/economyConfig');

const PREFIX = 'v!';

// Try the custom emoji first, fall back to a normal one if the bot cannot use it.
async function react(message, custom, fallback) {
  try {
    await message.react(custom);
  } catch {
    await message.react(fallback).catch(() => {});
  }
}

/* =========================================================
   COUNTING
   Correct next number -> tick, +VB. Wrong number -> cross, the
   count carries on. Right number but you counted too recently
   -> loading emoji and it is not counted.
========================================================= */

async function handleCounting(message, counting) {
  const text = (message.content || '').trim();
  const number = /^\d{1,12}$/.test(text) ? Number(text) : null;

  if (number !== counting.current + 1) {
    await react(message, EMOJI.cross, '❌');
    return;
  }

  const id = message.author.id;
  const u = economy.user(id);
  const now = Date.now();

  if (now - u.lastCount < COUNTING.cooldownMs) {
    await react(message, EMOJI.loading, '⏳');
    return;
  }

  // Everything that decides the count happens before the first await, so two
  // people sending the same number at once cannot both be right.
  counting.current = number;
  counting.lastUserId = id;
  u.lastCount = now;
  u.counts += 1;
  economy.addVb(id, COUNTING.reward);
  const unlocked = achievements.unlock(id, 'counts');

  await react(message, EMOJI.tick, '✅');
  if (unlocked.length) await achievements.announce(message.channel, message.author, unlocked);
}

/* =========================================================
   CHAT ACTIVITY
   Real messages only. Short ones, spam, copies of your last
   message and anything sent too fast do not count.
========================================================= */

function isExcludedChannel(channel) {
  if (!channel) return true;
  const ids = [channel.id];
  if (channel.isThread?.() && channel.parentId) ids.push(channel.parentId);
  if (ids.some((id) => staffCfg.excludedMessageChannelIds.includes(id))) return true;

  if (staffCfg.excludeTicketChannels) {
    const category = channel.isThread?.() ? channel.parent?.parentId : channel.parentId;
    if (category && staffCfg.ticketCategoryIds.has(category)) return true;
  }
  return false;
}

const dayKey = () => new Date().toISOString().slice(0, 10);

function cleanText(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/<(?:@[!&]?|#)\d+>/g, ' ')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function handleActivity(message) {
  if (message.type !== 0 && message.type !== 19) return;

  const text = cleanText(message.content);
  if (text.length < ACTIVITY.minChars) return;
  if ((message.content || '').toLowerCase().startsWith(PREFIX)) return;
  if (isExcludedChannel(message.channel)) return;

  const u = economy.user(message.author.id);
  const now = Date.now();
  const normalized = text.toLowerCase();

  if (now - u.chat.at < ACTIVITY.minGapMs) return;
  if (normalized === u.chat.last) return;

  u.chat.at = now;
  u.chat.last = normalized.slice(0, 60);
  u.msgs += 1;
  u.chat.n += 1;

  if (u.chat.n >= ACTIVITY.everyMessages) {
    u.chat.n = 0;

    const today = dayKey();
    if (u.chat.day !== today) {
      u.chat.day = today;
      u.chat.earned = 0;
    }

    if (u.chat.earned + ACTIVITY.reward <= ACTIVITY.dailyCapVb) {
      u.chat.earned += ACTIVITY.reward;
      economy.addVb(message.author.id, ACTIVITY.reward);
    }
  }

  economy.touch();

  const unlocked = achievements.unlock(message.author.id, 'msgs');
  if (unlocked.length) await achievements.announce(message.channel, message.author, unlocked);
}

async function handle(message) {
  if (!message.guild || !message.author || message.author.bot || message.webhookId || message.system) return;

  const counting = economy.counting();
  if (counting.channelId && message.channelId === counting.channelId) {
    await handleCounting(message, counting);
    return;
  }

  await handleActivity(message);
}

module.exports = {
  name: 'economy',

  register(client) {
    client.on('messageCreate', (message) => {
      handle(message).catch((err) => console.error('[economy] message error:', err));
    });
  },
};
