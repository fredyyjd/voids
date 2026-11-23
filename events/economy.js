const economy = require('../utils/economy');
const achievements = require('../utils/achievements');
const staffCfg = require('../utils/staffConfig');
const achBoard = require('../utils/achBoard');
const vbGuard = require('../utils/vbGuard');
const { EMOJI, COUNTING, ACTIVITY, ACHIEVEMENT_CHANNEL_ID } = require('../utils/economyConfig');

const PREFIX = 'v!';

// Try the custom emoji first, fall back to a normal one if the bot cannot use it.
async function react(message, custom, fallback) {
  try {
    return await message.react(custom);
  } catch {
    return message.react(fallback).catch(() => null);
  }
}

// Same as v!to: take the loading emoji off, then put the tick or the cross on.
async function markDone(message, loading, ok) {
  if (loading) await loading.users.remove(message.client.user.id).catch(() => {});
  await react(message, ok ? EMOJI.tick : EMOJI.cross, ok ? '✅' : '❌');
}

/* =========================================================
   COUNTING
   Correct next number -> tick, +VB. Wrong number -> cross, the
   count carries on. Right number but you counted too recently
   -> loading emoji, then your message is deleted so the next
   person can send that number.
========================================================= */

async function handleCounting(message, counting) {
  const text = (message.content || '').trim();
  const number = /^\d{1,12}$/.test(text) ? Number(text) : null;
  const id = message.author.id;
  const now = Date.now();

  // Everything that decides the count happens before the first await, so two
  // people sending the same number at once cannot both be right.
  let outcome = 'wrong';
  let unlocked = [];
  let usedPass = false;

  if (number === counting.current + 1) {
    const u = economy.user(id);
    const onCooldown = now - u.lastCount < COUNTING.cooldownMs;

    if (onCooldown && !(u.pass > 0)) {
      outcome = 'cooldown';
    } else {
      if (onCooldown) {
        u.pass -= 1;
        usedPass = true;
      }

      outcome = 'ok';
      counting.current = number;
      counting.lastUserId = id;
      u.lastCount = now;
      u.counts += 1;
      economy.earn(id, COUNTING.reward);
      unlocked = achievements.unlock(id, 'counts');
    }
  }

  // Loading emoji while it is handled, like v!to.
  const loading = await react(message, EMOJI.loading, '⏳');

  // Counted too soon: loading for a moment, then the message is deleted so the
  // next person can send that same number. (If it cannot be deleted, the loading stays.)
  if (outcome === 'cooldown') {
    await new Promise((r) => setTimeout(r, 800));
    await message.delete().catch(() => {});
    return;
  }

  await markDone(message, loading, outcome === 'ok');
  if (usedPass) await message.react('⏩').catch(() => {});
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

  const check = vbGuard.inspect(u, normalized, now);

  if (check.points && vbGuard.addPoints(u, check.points, now)) {
    await vbGuard.punish(message, u);
    return;
  }

  if (check.skip) return;

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

    const reward = economy.scaled(message.author.id, ACTIVITY.reward);
    const cap = ACTIVITY.dailyCapVb * economy.boostMult();

    if (u.chat.earned + reward <= cap + 1e-9) {
      u.chat.earned = Math.round((u.chat.earned + reward) * 10) / 10;
      economy.addVb(message.author.id, reward);
    }
  }

  economy.touch();

  const unlocked = achievements.unlock(message.author.id, 'msgs');
  if (unlocked.length) await achievements.announce(message.channel, message.author, unlocked);
}

async function handle(message) {
  if (!message.guild || !message.author || message.author.bot || message.webhookId || message.system) return;

  // Someone posted in the achievements channel: keep the leaderboard at the bottom.
  if (message.channelId === ACHIEVEMENT_CHANNEL_ID) achBoard.schedule(message.client);

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
    client.once('ready', () => achBoard.ensure(client).catch((err) => console.error('[achievements] board setup failed:', err.message)));

    client.on('messageCreate', (message) => {
      handle(message).catch((err) => console.error('[economy] message error:', err));
    });
  },
};
