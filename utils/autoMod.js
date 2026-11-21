const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');
const extra = require('../extraConfig');
const createStore = require('./jsonStore');
const { hasBypassRole } = require('./staffBypass');
const modStats = require('./modStats');
const langFilter = require('./langFilter');
const disputes = require('./disputes');
const requestPing = require('./requestPing');
const pingProt = require('./pingProt');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const MAX_TIMEOUT_MS = 28 * 24 * HOUR;
const KEEP_OFFENCES_MS = 7 * 24 * HOUR;

const offenceStore = createStore('automod_offences.json', {});
const spamHits = new Map();
const mentionHits = new Map();
const handled = new Set();
const busy = new Set();
const cooldownUntil = new Map();

const DEFAULTS = {
  enabled: true,
  logChannelId: '',
  contactText: 'please contact a higher staff member (an Admin or Manager) and they will review it.',
  exemptRoleIds: [],
  exemptChannelIds: [],
  authorizedMentionRoleIds: [],
  actionCooldownSeconds: 10,
  repeatLookbackHours: 24,
  spam: {
    enabled: true,
    messages: 10,
    windowSeconds: 15,
    timeoutMinutes: 30,
    repeatAddMinutes: 30,
  },
  everyone: {
    enabled: true,
    timeoutMinutes: 60,
    repeatAddMinutes: 60,
    punishAttempts: true,
  },
  mentions: {
    enabled: true,
    maxUsersPerMessage: 6,
    maxRolesPerMessage: 3,
    windowSeconds: 30,
    maxUsersInWindow: 12,
    maxRolesInWindow: 5,
    timeoutMinutes: 15,
    repeatAddMinutes: 15,
  },
  // /ping prot: pinging a protected person / role = message deleted + timeout.
  pingProt: {
    enabled: true,
    timeoutMinutes: 60,
    repeatAddMinutes: 0,
    includeReplies: false,
  },
  // Swearing at someone ("fuck you", "fuck @user"): 1st time = warning DM only,
  // then a 10 minute timeout that grows by 10 minutes every time they do it again.
  // Slurs (faggot / retard / nigga / nigger): 1 hour timeout straight away, +1 hour each repeat.
  language: {
    enabled: true,
    deleteMessage: true,
    lookbackHours: 72,
    targeted: { timeoutMinutes: 10, repeatAddMinutes: 10 },
    slurs: { timeoutMinutes: 60, repeatAddMinutes: 60 },
  },
};

function mergeDeep(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over || {})) {
    const plain = value && typeof value === 'object' && !Array.isArray(value);
    out[key] = plain && base[key] && typeof base[key] === 'object' ? mergeDeep(base[key], value) : value;
  }
  return out;
}

function validId(id) {
  return typeof id === 'string' && /^\d{15,25}$/.test(id);
}

function settings() {
  const cfg = mergeDeep(DEFAULTS, extra.autoMod || {});
  cfg.exemptRoleIds = (cfg.exemptRoleIds || []).filter(validId);
  cfg.exemptChannelIds = (cfg.exemptChannelIds || []).filter(validId);
  cfg.authorizedMentionRoleIds = (cfg.authorizedMentionRoleIds || []).filter(validId);
  return cfg;
}

function schematicChannelIds() {
  const list = extra.schematics?.categories || [];
  return list.flatMap((c) => [c.source, c.posting]).filter(validId);
}

function hasAnyRole(member, ids) {
  const roles = member?.roles?.cache;
  if (!roles || typeof roles.has !== 'function') return false;
  return ids.some((id) => roles.has(id));
}

function isExempt(message, cfg) {
  const member = message.member;
  if (!member) return false;
  if (message.guild && message.author.id === message.guild.ownerId) return true;
  if (hasBypassRole(member)) return true;
  if (hasAnyRole(member, cfg.exemptRoleIds)) return true;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}

function canMention(message, cfg) {
  if (isExempt(message, cfg)) return true;
  const member = message.member;
  if (!member) return false;
  if (hasAnyRole(member, cfg.authorizedMentionRoleIds)) return true;
  const perms = message.channel?.permissionsFor?.(member) || member.permissions;
  return Boolean(perms?.has(PermissionFlagsBits.MentionEveryone));
}

function stripCode(content) {
  return String(content || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
}

function everyoneUsed(message, cfg) {
  if (message.mentions?.everyone) return true;
  if (!cfg.everyone.punishAttempts) return false;
  return /(^|[^\w])@(everyone|here)\b/i.test(stripCode(message.content));
}

function eligible(message) {
  if (!message.guild || !message.author || !message.member) return false;
  if (message.author.bot || message.webhookId || message.system) return false;
  if (message.author.id === message.client.user?.id) return false;
  return true;
}

function handlesEveryone(message) {
  try {
    const cfg = settings();
    if (!cfg.enabled || !cfg.everyone.enabled) return false;
    if (!eligible(message)) return false;
    if (!everyoneUsed(message, cfg)) return false;
    if (requestPing.authorizes(message)) return false;
    return !canMention(message, cfg);
  } catch {
    return false;
  }
}

function typingGameRunning(channelId) {
  try {
    const kit = require('./gameKit');
    return kit.gamesChannelId() === channelId && kit.typingActive(channelId);
  } catch {
    return false;
  }
}

function recentOffences(key, cfg, { hours = cfg.repeatLookbackHours, kinds = null, exclude = null } = {}) {
  const lookback = hours * HOUR;
  const now = Date.now();
  return (offenceStore.get(key) || []).filter(
    (o) => now - o.t <= lookback && (!kinds || kinds.includes(o.kind)) && (!exclude || !exclude.includes(o.kind))
  );
}

function addOffence(key, kind) {
  const now = Date.now();
  const list = (offenceStore.get(key) || []).filter((o) => now - o.t <= KEEP_OFFENCES_MS);
  list.push({ t: now, kind });
  offenceStore.set(key, list);
}

// A language warning is not a punishment, so it does not make other timeouts longer.
function genericPrior(key, cfg) {
  return recentOffences(key, cfg, { exclude: ['language_warn'] }).length;
}

const clip = (text, n) => {
  const t = String(text ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function messageText(message) {
  const text = String(message.content || '').trim();
  if (text) return clip(text, 300);
  return message.attachments?.size ? '[attachment]' : '';
}

function durationFor(prior, baseMinutes, addMinutes) {
  const ms = (baseMinutes + addMinutes * prior) * MIN;
  return Math.min(ms, MAX_TIMEOUT_MS);
}

function formatDuration(ms) {
  const minutes = Math.round(ms / MIN);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} hour${hours === 1 ? '' : 's'}`;
  return rest ? `${h} ${rest} minutes` : h;
}

function logChannelId(cfg) {
  const candidates = [
    cfg.logChannelId,
    extra.pingGuard?.alertChannelId,
    config.antiNuke?.alertChannelId,
    config.modLogChannelId,
  ];
  return candidates.find(validId) || null;
}

async function sendLog(guild, cfg, embed) {
  const id = logChannelId(cfg);
  if (!id) return;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel && channel.isTextBased?.()) await channel.send({ embeds: [embed] }).catch(() => {});
}

async function deleteTracked(guild, entries) {
  const byChannel = new Map();
  for (const entry of entries) {
    if (!byChannel.has(entry.channelId)) byChannel.set(entry.channelId, new Set());
    byChannel.get(entry.channelId).add(entry.messageId);
  }

  for (const [channelId, ids] of byChannel) {
    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.messages) continue;

    const list = [...ids];
    if (list.length > 1 && typeof channel.bulkDelete === 'function') {
      const ok = await channel.bulkDelete(list, true).then(() => true).catch(() => false);
      if (ok) continue;
    }

    for (const id of list) await channel.messages.delete(id).catch(() => {});
  }
}

function buildDm(guild, reason, ms, until, punId) {
  const embed = new EmbedBuilder()
    .setColor('#ED4245')
    .setDescription(
      `You were timed out in **${guild.name}** for **${formatDuration(ms)}**.\n` +
        `**Reason:** ${reason}\n` +
        `Your timeout ends <t:${Math.floor(until / 1000)}:R>.\n\n` +
        'Our automatic moderation system is currently in **beta**, so it can make mistakes. ' +
        'If you think this was a mistake, press **Contact higher ups** below.'
    );
  return { embeds: [embed], components: [disputes.contactRow(punId)] };
}

function buildWarnDm(guild, userId) {
  const embed = new EmbedBuilder()
    .setColor('#FEE75C')
    .setDescription(
      `Hey <@${userId}>, I see you sent an inappropriate message. This is a **warning**, keep language kind so the server stays safe.`
    )
    .setFooter({ text: guild.name });
  return { embeds: [embed] };
}

async function takeAction(message, cfg, opts) {
  const {
    kind,
    title,
    reason,
    trackedEntries,
    baseMinutes = 0,
    addMinutes = 0,
    extraFields = [],
    decide = null,
    deleteOffending = true,
  } = opts;

  const guild = message.guild;
  const userId = message.author.id;
  const key = `${guild.id}:${userId}`;

  const until = cooldownUntil.get(key) || 0;
  if (Date.now() < until) {
    handled.add(message.id);
    await message.delete().catch(() => {});
    return;
  }

  if (busy.has(key)) {
    handled.add(message.id);
    await message.delete().catch(() => {});
    return;
  }

  busy.add(key);
  handled.add(message.id);

  try {
    const entries = [...(trackedEntries || [])];
    if (!entries.some((e) => e.messageId === message.id)) {
      entries.push({ channelId: message.channelId, messageId: message.id, content: messageText(message) });
    }

    // What they actually said, saved before the messages are deleted.
    const evidence = entries
      .filter((e) => e.content)
      .slice(-10)
      .map((e) => ({ text: clip(e.content, 300), channelId: e.channelId }));

    if (deleteOffending) await deleteTracked(guild, entries);

    const decision = decide ? decide(key) : null;
    const prior = decision ? decision.prior : genericPrior(key, cfg);
    const warnOnly = Boolean(decision?.warnOnly);
    const offenceKind = decision?.offenceKind || kind;
    const logTitle = decision?.title || title;
    const ms = warnOnly ? 0 : decision && decision.ms != null ? decision.ms : durationFor(prior, baseMinutes, addMinutes);
    const endsAt = Date.now() + ms;

    let timedOut = false;
    let failure = null;

    if (!warnOnly) {
      try {
        const member = message.member || (await guild.members.fetch(userId).catch(() => null));
        if (!member) throw new Error('Member not found');
        if (member.moderatable === false) throw new Error('I cannot moderate this member (their role is above mine or they are an Administrator).');
        await member.timeout(ms, `Auto moderation: ${reason}`.slice(0, 450));
        timedOut = true;
      } catch (err) {
        failure = err.message;
        console.error('[AUTOMOD] timeout failed:', err.message);
      }
    }

    addOffence(key, offenceKind);
    modStats.record(offenceKind, userId, { ok: warnOnly ? true : timedOut });
    cooldownUntil.set(key, Date.now() + cfg.actionCooldownSeconds * 1000);
    spamHits.delete(key);
    mentionHits.delete(key);

    let dmSent = false;
    if (warnOnly) {
      dmSent = await message.author.send(buildWarnDm(guild, userId)).then(() => true).catch(() => false);
    } else if (timedOut) {
      // Saved so the "Contact higher ups" button can show staff what happened.
      const punId = disputes.recordPunishment({
        guildId: guild.id,
        userId,
        kind: offenceKind,
        reason,
        timeoutText: formatDuration(ms),
        evidence,
      });
      dmSent = await message.author
        .send(buildDm(guild, reason, ms, endsAt, punId))
        .then(() => true)
        .catch(() => false);
    }

    const ok = warnOnly || timedOut;
    const embed = new EmbedBuilder()
      .setTitle(ok ? logTitle : `${logTitle} - TIMEOUT FAILED`)
      .setColor(warnOnly ? '#FEE75C' : timedOut ? '#ED4245' : '#FEE75C')
      .addFields(
        { name: 'User', value: `<@${userId}> (${message.author.tag})`, inline: true },
        { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
        { name: 'Timeout', value: warnOnly ? 'Warning only' : timedOut ? formatDuration(ms) : 'None', inline: true },
        { name: 'Reason', value: reason.slice(0, 1000) },
        {
          name: 'Messages',
          value: clip(evidence.map((e) => `• ${e.text.replace(/\n/g, ' ')}`).join('\n') || '*No text*', 1000),
        },
        { name: 'Messages deleted', value: deleteOffending ? String(entries.length) : '0', inline: true },
        { name: 'Previous offences (recent)', value: String(prior), inline: true },
        { name: 'DM sent', value: dmSent ? 'Yes' : 'No (DMs closed or timeout failed)', inline: true },
        ...extraFields
      )
      .setFooter({ text: 'Auto moderation (beta)' })
      .setTimestamp();

    if (failure) embed.addFields({ name: 'Why it failed', value: String(failure).slice(0, 900) });

    await sendLog(guild, cfg, embed);
  } finally {
    busy.delete(key);
    setTimeout(() => handled.delete(message.id), 60 * 1000).unref?.();
  }
}

function pushHit(map, key, entry, windowMs) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((h) => now - h.t <= windowMs);
  list.push(entry);
  map.set(key, list);
  return list;
}

function countMentions(message) {
  let users = 0;
  const seen = new Set();

  for (const user of message.mentions.users.values()) {
    if (user.bot || user.id === message.author.id) continue;
    seen.add(user.id);
  }

  const repliedTo = message.mentions.repliedUser?.id;
  if (repliedTo && message.reference && seen.has(repliedTo)) {
    const rawMention = new RegExp(`<@!?${repliedTo}>`).test(message.content || '');
    if (!rawMention) seen.delete(repliedTo);
  }

  users = seen.size;
  const roles = message.mentions.roles?.size || 0;
  return { users, roles, userIds: [...seen] };
}

async function checkProtectedPing(message, cfg) {
  const p = cfg.pingProt;
  if (!p.enabled) return false;
  if (!message.mentions.users.size && !message.mentions.roles?.size) return false;

  const hit = pingProt.findHits(message, {
    includeReplies: p.includeReplies,
    skipRoleId: requestPing.grantedRoleId(message),
  });
  if (!hit) return false;

  const who = [...hit.roles.map((id) => `<@&${id}>`), ...hit.users.map((id) => `<@${id}>`)].join(' ');

  await takeAction(message, cfg, {
    kind: 'ping_protection',
    title: 'Auto Mod: Protected Ping',
    reason: 'You pinged someone who has ping protection.',
    baseMinutes: p.timeoutMinutes,
    addMinutes: p.repeatAddMinutes,
    trackedEntries: [{ channelId: message.channelId, messageId: message.id, content: messageText(message) }],
    extraFields: [{ name: 'Protected', value: clip(who, 1000) }],
  });
  return true;
}

async function checkEveryone(message, cfg) {
  if (!cfg.everyone.enabled) return false;
  if (!everyoneUsed(message, cfg)) return false;
  if (canMention(message, cfg)) return false;
  // An @everyone / @here that management approved through /request ping (used once).
  if (requestPing.authorizes(message)) return false;

  await takeAction(message, cfg, {
    kind: 'everyone',
    title: 'Auto Mod: @everyone / @here',
    reason: 'You used @everyone or @here without permission.',
    baseMinutes: cfg.everyone.timeoutMinutes,
    addMinutes: cfg.everyone.repeatAddMinutes,
    trackedEntries: [{ channelId: message.channelId, messageId: message.id, content: messageText(message) }],
  });
  return true;
}

async function checkMentions(message, cfg) {
  const m = cfg.mentions;
  if (!m.enabled) return false;
  if (!message.mentions.users.size && !message.mentions.roles?.size) return false;
  if (canMention(message, cfg)) return false;

  const key = `${message.guild.id}:${message.author.id}`;
  const { users, roles, userIds } = countMentions(message);
  if (!users && !roles) return false;

  const entry = {
    t: Date.now(),
    channelId: message.channelId,
    messageId: message.id,
    content: messageText(message),
    users: userIds,
    roles: roles ? [...message.mentions.roles.keys()] : [],
  };

  const hits = pushHit(mentionHits, key, entry, m.windowSeconds * 1000);
  const windowUsers = new Set(hits.flatMap((h) => h.users)).size;
  const windowRoles = new Set(hits.flatMap((h) => h.roles)).size;

  let reason = null;
  if (m.maxUsersPerMessage > 0 && users > m.maxUsersPerMessage) {
    reason = `You mentioned too many people in one message (${users}).`;
  } else if (m.maxRolesPerMessage > 0 && roles > m.maxRolesPerMessage) {
    reason = `You mentioned too many roles in one message (${roles}).`;
  } else if (m.maxUsersInWindow > 0 && windowUsers > m.maxUsersInWindow) {
    reason = `You mentioned too many different people in ${m.windowSeconds} seconds (${windowUsers}).`;
  } else if (m.maxRolesInWindow > 0 && windowRoles > m.maxRolesInWindow) {
    reason = `You mentioned too many different roles in ${m.windowSeconds} seconds (${windowRoles}).`;
  }

  if (!reason) return false;

  await takeAction(message, cfg, {
    kind: 'mentions',
    title: 'Auto Mod: Mention Abuse',
    reason,
    baseMinutes: m.timeoutMinutes,
    addMinutes: m.repeatAddMinutes,
    trackedEntries: hits,
  });
  return true;
}

async function checkSpam(message, cfg) {
  const s = cfg.spam;
  if (!s.enabled || s.messages < 2) return false;

  const excluded = new Set([...cfg.exemptChannelIds, ...schematicChannelIds()]);
  if (excluded.has(message.channelId)) return false;
  if (typingGameRunning(message.channelId)) return false;

  const key = `${message.guild.id}:${message.author.id}`;
  const hits = pushHit(
    spamHits,
    key,
    { t: Date.now(), channelId: message.channelId, messageId: message.id, content: messageText(message) },
    s.windowSeconds * 1000
  );

  if (hits.length < s.messages) return false;

  await takeAction(message, cfg, {
    kind: 'spam',
    title: 'Auto Mod: Spam',
    reason: `You sent ${hits.length} messages in ${s.windowSeconds} seconds (spam).`,
    baseMinutes: s.timeoutMinutes,
    addMinutes: s.repeatAddMinutes,
    trackedEntries: hits,
    extraFields: [{ name: 'Messages in window', value: String(hits.length), inline: true }],
  });
  return true;
}

async function checkLanguage(message, cfg) {
  const l = cfg.language;
  if (!l.enabled) return false;
  if (cfg.exemptChannelIds.includes(message.channelId)) return false;
  if (!message.content) return false;

  const hit = langFilter.check(message.content);
  if (!hit) return false;

  if (hit.type === 'slur') {
    await takeAction(message, cfg, {
      kind: 'slur',
      title: 'Auto Mod: Slur',
      reason: 'You used a slur or hateful language, which is not allowed here.',
      deleteOffending: l.deleteMessage,
      decide: (key) => {
        const prior = recentOffences(key, cfg, { hours: l.lookbackHours, kinds: ['slur'] }).length;
        return {
          prior,
          ms: durationFor(prior, l.slurs.timeoutMinutes, l.slurs.repeatAddMinutes),
          offenceKind: 'slur',
        };
      },
    });
    return true;
  }

  await takeAction(message, cfg, {
    kind: 'language',
    title: 'Auto Mod: Inappropriate Language',
    reason: 'You sent an inappropriate message (swearing at someone).',
    deleteOffending: l.deleteMessage,
    decide: (key) => {
      const prior = recentOffences(key, cfg, { hours: l.lookbackHours, kinds: ['language_warn', 'language'] }).length;
      if (prior === 0) {
        return { prior, warnOnly: true, offenceKind: 'language_warn', title: 'Auto Mod: Language Warning' };
      }
      return {
        prior,
        ms: durationFor(prior - 1, l.targeted.timeoutMinutes, l.targeted.repeatAddMinutes),
        offenceKind: 'language',
      };
    },
  });
  return true;
}

async function checkMessage(message) {
  const cfg = settings();
  if (!cfg.enabled) return;
  if (!eligible(message)) return;
  if (handled.has(message.id)) return;
  if (isExempt(message, cfg)) return;

  const key = `${message.guild.id}:${message.author.id}`;
  if (Date.now() < (cooldownUntil.get(key) || 0) && (busy.has(key) || everyoneUsed(message, cfg))) {
    handled.add(message.id);
    await message.delete().catch(() => {});
    return;
  }

  if (await checkProtectedPing(message, cfg)) return;
  if (await checkEveryone(message, cfg)) return;
  if (await checkMentions(message, cfg)) return;
  if (await checkLanguage(message, cfg)) return;
  await checkSpam(message, cfg);
}

function startCleanup() {
  setInterval(() => {
    const cfg = settings();
    const now = Date.now();
    const spamWindow = cfg.spam.windowSeconds * 1000;
    const mentionWindow = cfg.mentions.windowSeconds * 1000;

    for (const [map, windowMs] of [[spamHits, spamWindow], [mentionHits, mentionWindow]]) {
      for (const [key, list] of map) {
        const fresh = list.filter((h) => now - h.t <= windowMs);
        if (fresh.length) map.set(key, fresh);
        else map.delete(key);
      }
    }

    for (const [key, until] of cooldownUntil) {
      if (until < now) cooldownUntil.delete(key);
    }
  }, 5 * MIN).unref?.();
}

module.exports = { checkMessage, handlesEveryone, startCleanup, settings };
