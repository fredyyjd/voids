const { AuditLogEvent, EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { addTempBan, scheduleUnban } = require('./tempBanManager');

/* =========================================================
   ANTI-NUKE

   - Kicks  `kickLimit` people inside the time window -> banned for `kickBanDays` day(s)
   - Bans   `banLimit`  people inside the time window -> banned for `banBanDays`  day(s)

   Defaults below are used when config.json has no "antiNuke" block.
   Optional config.json block:

   "antiNuke": {
     "enabled": true,
     "windowMinutes": 10,
     "kickLimit": 10,
     "kickBanDays": 1,
     "banLimit": 5,
     "banBanDays": 5,
     "alertChannelId": "CHANNEL_ID",
     "ignoreBots": false,
     "whitelistedUserIds": ["USER_OR_BOT_ID"]
   }

   Never punished: the server owner, this bot, and anyone in
   whitelistedUserIds. Other bots ARE counted (a hacked or rogue
   bot is a common way servers get nuked) - put your own trusted
   bots' IDs in whitelistedUserIds, or set "ignoreBots": true to
   skip all other bots.
========================================================= */

const DAY_MS = 24 * 60 * 60 * 1000;

function settings() {
  const s = config.antiNuke || {};
  return {
    enabled: s.enabled !== false,
    windowMs: (s.windowMinutes || 10) * 60 * 1000,
    kickLimit: s.kickLimit || 10,
    kickBanDays: s.kickBanDays || 1,
    banLimit: s.banLimit || 5,
    banBanDays: s.banBanDays || 5,
    alertChannelId: s.alertChannelId || config.modLogChannelId,
    ignoreBots: s.ignoreBots === true,
    whitelist: (s.whitelistedUserIds || []).filter(
      (id) => id && typeof id === 'string' && !id.startsWith('PUT_')
    ),
  };
}

// guildId:userId:type -> [timestamps]
const actions = new Map();
// guildId:userId -> already being punished
const punishing = new Set();

async function sendAlert(guild, cfg, embed) {
  const id = cfg.alertChannelId;
  if (!id || typeof id !== 'string' || id.startsWith('PUT_')) return;

  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel && channel.isTextBased?.()) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

async function punish(guild, executorId, type, count, cfg) {
  const key = `${guild.id}:${executorId}`;
  if (punishing.has(key)) return;
  punishing.add(key);

  const isKick = type === 'kick';
  const days = isKick ? cfg.kickBanDays : cfg.banBanDays;
  const verb = isKick ? 'kicked' : 'banned';
  const reason = `Anti-nuke: ${verb} ${count} members within ${Math.round(cfg.windowMs / 60000)} minutes`;

  try {
    const user = await guild.client.users.fetch(executorId).catch(() => null);

    if (user) {
      await user
        .send(
          `You have been banned from **${guild.name}** for ${days} day(s).\n` +
          `Reason: ${reason}`
        )
        .catch(() => {});
    }

    let success = true;
    let errorText = null;

    try {
      await guild.members.ban(executorId, { reason });

      const unbanAt = Date.now() + days * DAY_MS;
      addTempBan(guild.id, executorId, unbanAt);
      scheduleUnban(guild.client, guild.id, executorId, unbanAt);
    } catch (err) {
      success = false;
      errorText = err.message;
      console.error('[ANTI-NUKE] Failed to ban offender:', err);
    }

    // Reset this person's counters so they are not punished twice.
    actions.delete(`${guild.id}:${executorId}:kick`);
    actions.delete(`${guild.id}:${executorId}:ban`);

    const embed = new EmbedBuilder()
      .setTitle(success ? 'Anti-Nuke Triggered' : 'Anti-Nuke Triggered — BAN FAILED')
      .setColor(success ? '#ED4245' : '#FEE75C')
      .addFields(
        { name: 'Offender', value: `<@${executorId}> (${user?.tag || executorId})`, inline: true },
        { name: 'Action', value: `${verb} ${count} members`, inline: true },
        { name: 'Punishment', value: success ? `Banned for ${days} day(s)` : 'None (see below)', inline: true }
      )
      .setTimestamp();

    if (!success) {
      embed.addFields({
        name: 'Why it failed',
        value:
          `${String(errorText).slice(0, 900)}\n\n` +
          "Move the bot's role above the offender's highest role and make sure it has **Ban Members**.",
      });
    }

    await sendAlert(guild, cfg, embed);
  } finally {
    punishing.delete(key);
  }
}

// type: 'kick' | 'ban'
async function recordAction(guild, executorId, type) {
  const cfg = settings();

  if (!cfg.enabled || !guild || !executorId) return;
  if (executorId === guild.ownerId) return;
  if (cfg.whitelist.includes(executorId)) return;

  const key = `${guild.id}:${executorId}:${type}`;
  const now = Date.now();

  const list = (actions.get(key) || []).filter((t) => now - t <= cfg.windowMs);
  list.push(now);
  actions.set(key, list);

  const limit = type === 'kick' ? cfg.kickLimit : cfg.banLimit;

  if (list.length >= limit) {
    await punish(guild, executorId, type, list.length, cfg);
  }
}

// Keep the map from growing forever.
function startCleanup() {
  setInterval(() => {
    const cfg = settings();
    const now = Date.now();

    for (const [key, list] of actions) {
      const fresh = list.filter((t) => now - t <= cfg.windowMs);
      if (fresh.length) actions.set(key, fresh);
      else actions.delete(key);
    }
  }, 10 * 60 * 1000).unref?.();
}

function register(client) {
  startCleanup();

  // Needs the "View Audit Log" permission and the GuildModeration intent.
  client.on('guildAuditLogEntryCreate', async (entry, guild) => {
    try {
      let type = null;

      if (entry.action === AuditLogEvent.MemberKick) type = 'kick';
      else if (entry.action === AuditLogEvent.MemberBanAdd) type = 'ban';
      else return;

      const executorId = entry.executorId;
      if (!executorId) return;

      // Ignore this bot (its /kick and /ban are counted straight from
      // the commands, its honeypot / anti-raid kicks are automatic).
      if (executorId === client.user.id) return;

      // Other bots are counted unless ignoreBots is on.
      if (settings().ignoreBots) {
        const executor = await client.users.fetch(executorId).catch(() => null);
        if (executor?.bot) return;
      }

      await recordAction(guild, executorId, type);
    } catch (err) {
      console.error('[ANTI-NUKE] Error handling audit log entry:', err);
    }
  });

  console.log('[ANTI-NUKE] Listening for mass kicks / bans.');
}

module.exports = { register, recordAction };
