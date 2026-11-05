const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const extra = require('../extraConfig');

/* =========================================================
   PING GUARD
   - 3 real @everyone / @here pings in 10 minutes  -> ban
   - 3 quick drop role pings in 1 minute           -> 10 minute timeout
   Limits live in extraConfig.js. Never punished: the server owner, this
   bot, antiNuke.whitelistedUserIds (config.json) and pingGuard.whitelistedUserIds.
   Bots / webhooks are ignored.
========================================================= */

const MIN = 60 * 1000;

function settings() {
  const g = extra.pingGuard || {};
  const e = g.everyone || {};
  const q = g.quickDrop || {};
  const valid = (id) => id && typeof id === 'string' && !id.startsWith('PUT_');
  return {
    enabled: g.enabled !== false,
    everyoneLimit: e.limit ?? 3,
    everyoneWindow: (e.windowMinutes ?? 10) * MIN,
    quickRoleId: valid(q.roleId) ? q.roleId : null,
    quickLimit: q.limit ?? 3,
    quickWindow: (q.windowMinutes ?? 1) * MIN,
    quickTimeout: (q.timeoutMinutes ?? 10) * MIN,
    alertChannelId: [g.alertChannelId, config.antiNuke?.alertChannelId, config.modLogChannelId].find(valid) || null,
    whitelist: [...(g.whitelistedUserIds || []), ...(config.antiNuke?.whitelistedUserIds || [])].filter(valid),
  };
}

// guildId:userId -> [{ t, channelId, messageId }]
const everyoneHits = new Map();
const quickHits = new Map();
const punishing = new Set();

function record(map, key, entry, windowMs) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((h) => now - h.t <= windowMs);
  list.push(entry);
  map.set(key, list);
  return list;
}

async function sendAlert(guild, cfg, embed) {
  if (!cfg.alertChannelId) return;
  const channel = await guild.channels.fetch(cfg.alertChannelId).catch(() => null);
  if (channel && channel.isTextBased?.()) await channel.send({ embeds: [embed] }).catch(() => {});
}

async function deleteHits(guild, hits) {
  for (const hit of hits) {
    const channel = guild.channels.cache.get(hit.channelId);
    if (channel) await channel.messages.delete(hit.messageId).catch(() => {});
  }
}

async function punish(message, kind, hits, cfg) {
  const guild = message.guild;
  const userId = message.author.id;
  const key = `${guild.id}:${userId}`;
  if (punishing.has(key)) return;
  punishing.add(key);

  try {
    const isBan = kind === 'everyone';
    const reason = isBan
      ? `Ping guard: ${hits.length} @everyone/@here pings within ${Math.round(cfg.everyoneWindow / MIN)} minutes`
      : `Ping guard: ${hits.length} quick drop pings within ${Math.round(cfg.quickWindow / MIN)} minute(s)`;

    // Clean up the spam first.
    await deleteHits(guild, hits);

    let success = true;
    let errorText = null;

    try {
      if (isBan) {
        await message.author
          .send(`You have been banned from **${guild.name}**.\nReason: ${reason}`)
          .catch(() => {});
        await guild.members.ban(userId, { reason, deleteMessageSeconds: 10 * 60 });
      } else {
        const member = message.member || (await guild.members.fetch(userId).catch(() => null));
        if (!member) throw new Error('Member not found');
        await member.timeout(cfg.quickTimeout, reason);
        await message.author
          .send(
            `You have been timed out in **${guild.name}** for ${Math.round(cfg.quickTimeout / MIN)} minutes.\nReason: ${reason}`
          )
          .catch(() => {});
      }
    } catch (err) {
      success = false;
      errorText = err.message;
      console.error('[PING-GUARD] punishment failed:', err);
    }

    everyoneHits.delete(key);
    quickHits.delete(key);

    const embed = new EmbedBuilder()
      .setTitle(success ? 'Ping Guard Triggered' : 'Ping Guard Triggered - PUNISHMENT FAILED')
      .setColor(success ? '#ED4245' : '#FEE75C')
      .addFields(
        { name: 'User', value: `<@${userId}> (${message.author.tag})`, inline: true },
        { name: 'Pings', value: `${hits.length} ${isBan ? '@everyone/@here' : 'quick drop'}`, inline: true },
        {
          name: 'Punishment',
          value: success ? (isBan ? 'Banned' : `Timed out ${Math.round(cfg.quickTimeout / MIN)}m`) : 'None (see below)',
          inline: true,
        }
      )
      .setTimestamp();

    if (!success) {
      embed.addFields({
        name: 'Why it failed',
        value:
          `${String(errorText).slice(0, 900)}\n\n` +
          "Move the bot's role above theirs and give it **Ban Members** / **Moderate Members**. " +
          'Members with Administrator cannot be timed out.',
      });
    }

    await sendAlert(guild, cfg, embed);
  } finally {
    punishing.delete(key);
  }
}

async function checkPings(message) {
  const cfg = settings();
  if (!cfg.enabled) return;
  if (!message.guild || !message.author || message.author.bot || message.webhookId) return;

  const userId = message.author.id;
  if (userId === message.guild.ownerId) return;
  if (cfg.whitelist.includes(userId)) return;

  const key = `${message.guild.id}:${userId}`;
  const entry = { t: Date.now(), channelId: message.channelId, messageId: message.id };

  // mentions.everyone is only true when the ping really went out.
  if (message.mentions.everyone && cfg.everyoneLimit > 0) {
    const hits = record(everyoneHits, key, entry, cfg.everyoneWindow);
    if (hits.length >= cfg.everyoneLimit) return punish(message, 'everyone', hits, cfg);
  }

  if (cfg.quickRoleId && cfg.quickLimit > 0 && message.mentions.roles.has(cfg.quickRoleId)) {
    const hits = record(quickHits, key, entry, cfg.quickWindow);
    if (hits.length >= cfg.quickLimit) return punish(message, 'quickDrop', hits, cfg);
  }
}

function startCleanup() {
  setInterval(() => {
    const cfg = settings();
    const now = Date.now();
    for (const [map, windowMs] of [[everyoneHits, cfg.everyoneWindow], [quickHits, cfg.quickWindow]]) {
      for (const [key, list] of map) {
        const fresh = list.filter((h) => now - h.t <= windowMs);
        if (fresh.length) map.set(key, fresh);
        else map.delete(key);
      }
    }
  }, 10 * MIN).unref?.();
}

module.exports = { checkPings, startCleanup };
