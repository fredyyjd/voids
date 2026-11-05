const { AuditLogEvent, EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { addTempBan, scheduleUnban } = require('./tempBanManager');

/* =========================================================
   ANTI-NUKE (harsher)

   Inside the time window, one person doing any of these:

     kick    members   kickLimit           (default 3)
     ban     members   banLimit            (default 3)
     delete  channels  channelDeleteLimit  (default 3)
     delete  roles     roleDeleteLimit     (default 3)
     create  webhooks  webhookCreateLimit  (default 3)

   gets BANNED. Ban length: kickBanDays / banBanDays / punishDays
   (days). 0 or missing = permanent ban. Set a limit to 0 to switch
   that one off.

   Optional config.json block:

   "antiNuke": {
     "enabled": true,
     "windowMinutes": 10,
     "kickLimit": 3,   "kickBanDays": 0,
     "banLimit": 3,    "banBanDays": 0,
     "channelDeleteLimit": 3,
     "roleDeleteLimit": 3,
     "webhookCreateLimit": 3,
     "punishDays": 0,
     "alertChannelId": "CHANNEL_ID",
     "ignoreBots": false,
     "whitelistedUserIds": ["USER_OR_BOT_ID"]
   }

   Never punished: the server owner, this bot, and anyone in
   whitelistedUserIds. Other bots ARE counted (a hacked or rogue bot is
   a common way servers get nuked) - put your own trusted bots' IDs in
   whitelistedUserIds, or set "ignoreBots": true to skip all other bots.
========================================================= */

const DAY_MS = 24 * 60 * 60 * 1000;

// type -> what it is called in alerts, config key for the limit, default limit
const TYPES = {
  kick: { noun: 'members kicked', limitKey: 'kickLimit', daysKey: 'kickBanDays', def: 3 },
  ban: { noun: 'members banned', limitKey: 'banLimit', daysKey: 'banBanDays', def: 3 },
  channelDelete: { noun: 'channels deleted', limitKey: 'channelDeleteLimit', def: 3 },
  roleDelete: { noun: 'roles deleted', limitKey: 'roleDeleteLimit', def: 3 },
  webhookCreate: { noun: 'webhooks created', limitKey: 'webhookCreateLimit', def: 3 },
};

const AUDIT_TYPES = new Map([
  [AuditLogEvent.MemberKick, 'kick'],
  [AuditLogEvent.MemberBanAdd, 'ban'],
  [AuditLogEvent.ChannelDelete, 'channelDelete'],
  [AuditLogEvent.RoleDelete, 'roleDelete'],
  [AuditLogEvent.WebhookCreate, 'webhookCreate'],
]);

function settings() {
  const s = config.antiNuke || {};
  const limits = {};
  const days = {};

  for (const [type, t] of Object.entries(TYPES)) {
    limits[type] = s[t.limitKey] ?? t.def;
    days[type] = (t.daysKey && s[t.daysKey]) ?? s.punishDays ?? 0;
  }

  return {
    enabled: s.enabled !== false,
    windowMs: (s.windowMinutes || 10) * 60 * 1000,
    limits,
    days,
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

  const days = cfg.days[type];
  const permanent = !days || days <= 0;
  const what = TYPES[type].noun;
  const reason = `Anti-nuke: ${count} ${what} within ${Math.round(cfg.windowMs / 60000)} minutes`;

  try {
    const user = await guild.client.users.fetch(executorId).catch(() => null);

    if (user) {
      await user
        .send(
          `You have been banned from **${guild.name}**${permanent ? '' : ` for ${days} day(s)`}.\n` +
            `Reason: ${reason}`
        )
        .catch(() => {});
    }

    let success = true;
    let errorText = null;

    try {
      await guild.members.ban(executorId, { reason });

      if (!permanent) {
        const unbanAt = Date.now() + days * DAY_MS;
        addTempBan(guild.id, executorId, unbanAt);
        scheduleUnban(guild.client, guild.id, executorId, unbanAt);
      }
    } catch (err) {
      success = false;
      errorText = err.message;
      console.error('[ANTI-NUKE] Failed to ban offender:', err);
    }

    // Reset this person's counters so they are not punished twice.
    for (const t of Object.keys(TYPES)) actions.delete(`${guild.id}:${executorId}:${t}`);

    const embed = new EmbedBuilder()
      .setTitle(success ? 'Anti-Nuke Triggered' : 'Anti-Nuke Triggered - BAN FAILED')
      .setColor(success ? '#ED4245' : '#FEE75C')
      .addFields(
        { name: 'Offender', value: `<@${executorId}> (${user?.tag || executorId})`, inline: true },
        { name: 'Action', value: `${count} ${what}`, inline: true },
        {
          name: 'Punishment',
          value: success ? (permanent ? 'Permanent ban' : `Banned for ${days} day(s)`) : 'None (see below)',
          inline: true,
        }
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

// type: 'kick' | 'ban' | 'channelDelete' | 'roleDelete' | 'webhookCreate'
async function recordAction(guild, executorId, type) {
  const cfg = settings();

  if (!cfg.enabled || !guild || !executorId || !TYPES[type]) return;
  if (executorId === guild.ownerId) return;
  if (cfg.whitelist.includes(executorId)) return;

  const limit = cfg.limits[type];
  if (!limit || limit <= 0) return;

  const key = `${guild.id}:${executorId}:${type}`;
  const now = Date.now();

  const list = (actions.get(key) || []).filter((t) => now - t <= cfg.windowMs);
  list.push(now);
  actions.set(key, list);

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
      const type = AUDIT_TYPES.get(entry.action);
      if (!type) return;

      const executorId = entry.executorId;
      if (!executorId) return;

      // Ignore this bot (its /kick and /ban are counted straight from the
      // commands, its ticket / honeypot / anti-raid actions are automatic).
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

  console.log('[ANTI-NUKE] Listening for mass kicks / bans / deletes / webhooks.');
}

module.exports = { register, recordAction };
