const { ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const createStore = require('./jsonStore');
const extra = require('../extraConfig');
const config = require('../config.json');
const { box, priv } = require('./box');
const { isAdmin, isMod, isSupport } = require('./permissions');

const cfg = extra.loa || {};
const MAX_DAYS = cfg.maxDays || 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// data/loa.json  ->  requests: id -> {
//   id, guildId, userId, reason, days, requestedAt, channelId, messageId,
//   status: 'pending' | 'active' | 'denied' | 'ended', decidedBy, decidedAt, endAt
// }
const store = createStore('loa.json', { requests: {} });

const isSet = (id) => !!id && !String(id).startsWith('PUT_');
const ts = (ms, style = 'F') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const hasRole = (member, ids) => (ids || []).some((id) => isSet(id) && member.roles.cache.has(id));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Who can ask for LOA: staff.
function canRequest(member) {
  return (
    isAdmin(member) ||
    isMod(member) ||
    isSupport(member) ||
    hasRole(member, config.ticketRoleIds) ||
    hasRole(member, cfg.requesterRoleIds)
  );
}

// Who can accept / deny: admins (+ any roles listed in extraConfig loa.reviewerRoleIds).
function canReview(member) {
  return isAdmin(member) || hasRole(member, cfg.reviewerRoleIds);
}

async function dm(client, userId, text) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(text);
  } catch {
    // DMs closed, nothing to do
  }
}

/* ---------- the message staff see ---------- */

function reviewPayload(req) {
  const lines = [
    '## LOA request',
    `**staff:** <@${req.userId}>\n**length:** ${plural(req.days, 'day')}\n**reason:** ${req.reason}`,
  ];

  if (req.status === 'pending') {
    lines.push(`-# requested ${ts(req.requestedAt, 'R')}`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`loa_accept:${req.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`loa_deny:${req.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
    );

    return box(lines, { rows: [row] });
  }

  if (req.status === 'denied') {
    lines.push(`❌ denied by <@${req.decidedBy}>`);
  } else if (req.status === 'active') {
    lines.push(`✅ accepted by <@${req.decidedBy}>\non LOA until ${ts(req.endAt, 'F')} (${ts(req.endAt, 'R')})`);
  } else {
    lines.push(`✅ accepted by <@${req.decidedBy}>\nLOA ended ${ts(req.endAt, 'R')}`);
  }

  return box(lines);
}

/* ---------- /loa request ---------- */

async function submitRequest(interaction) {
  if (cfg.enabled === false) return interaction.reply(priv(box('LOA requests are turned off right now.')));
  if (!interaction.inGuild()) return interaction.reply(priv(box('Use this in the server.')));

  if (!canRequest(interaction.member)) {
    return interaction.reply(priv(box("❌ Only staff can request LOA.")));
  }

  const days = Math.min(Math.max(interaction.options.getInteger('days') || 1, 1), MAX_DAYS);
  const reason = String(interaction.options.getString('reason') || '').trim().slice(0, 500);

  const requests = store.get('requests') || {};
  const now = Date.now();

  const open = Object.values(requests).find(
    (r) =>
      r.userId === interaction.user.id &&
      (r.status === 'pending' || (r.status === 'active' && r.endAt > now))
  );

  if (open) {
    return interaction.reply(
      priv(
        box(
          open.status === 'pending'
            ? '❌ You already have a LOA request waiting to be reviewed.'
            : `❌ You are already on LOA until ${ts(open.endAt, 'F')}.`
        )
      )
    );
  }

  if (!isSet(cfg.channelId)) {
    return interaction.reply(priv(box("❌ The LOA channel isn't set up yet. Tell an admin.")));
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = await interaction.guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return interaction.editReply(box("❌ Couldn't find the LOA channel. Tell an admin."));
  }

  const req = {
    id: interaction.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    reason,
    days,
    requestedAt: now,
    channelId: channel.id,
    messageId: null,
    status: 'pending',
  };

  let sent;
  try {
    sent = await channel.send(reviewPayload(req));
  } catch (err) {
    console.error('[loa] could not send request:', err);
    return interaction.editReply(box("❌ Couldn't send your request. Tell an admin."));
  }

  req.messageId = sent.id;
  requests[req.id] = req;
  store.set('requests', requests);

  await interaction.editReply(
    box(`✅ Your LOA request (${plural(days, 'day')}) was sent. You'll get a DM when it's decided.`)
  );
}

/* ---------- Accept / Deny buttons ---------- */

const busy = new Set();

async function handleDecision(interaction) {
  const [action, id] = interaction.customId.split(':');

  if (!interaction.inGuild() || !canReview(interaction.member)) {
    return interaction.reply(priv(box('❌ Only admins can accept or deny LOA.')));
  }

  const requests = store.get('requests') || {};
  const req = requests[id];

  if (!req) return interaction.reply(priv(box("❌ I can't find that request anymore.")));
  if (req.status !== 'pending' || busy.has(id)) {
    return interaction.reply(priv(box(`❌ That request was already ${req.status === 'pending' ? 'handled' : req.status}.`)));
  }

  busy.add(id);

  try {
    await interaction.deferUpdate();

    if (action === 'loa_deny') {
      req.status = 'denied';
      req.decidedBy = interaction.user.id;
      req.decidedAt = Date.now();

      requests[id] = req;
      store.set('requests', requests);

      await interaction.editReply(reviewPayload(req));
      dm(interaction.client, req.userId, 'Your LOA request was denied.');
      return;
    }

    // Accept: give the LOA role for the length of time they asked for.
    if (!isSet(cfg.roleId)) {
      return interaction.followUp(
        priv(box("❌ The LOA role isn't set up yet. Put its ID in extraConfig.js (loa.roleId)."))
      );
    }

    const member = await interaction.guild.members.fetch(req.userId).catch(() => null);
    if (!member) {
      return interaction.followUp(priv(box("❌ That person isn't in the server anymore.")));
    }

    try {
      await member.roles.add(cfg.roleId, `LOA accepted by ${interaction.user.tag || interaction.user.id}`);
    } catch (err) {
      console.error('[loa] could not give the LOA role:', err);
      return interaction.followUp(
        priv(box("❌ Couldn't give the LOA role. Make sure my role is above it and I can manage roles."))
      );
    }

    req.status = 'active';
    req.decidedBy = interaction.user.id;
    req.decidedAt = Date.now();
    req.endAt = req.decidedAt + req.days * DAY_MS;

    requests[id] = req;
    store.set('requests', requests);

    await interaction.editReply(reviewPayload(req));
    dm(
      interaction.client,
      req.userId,
      `Your LOA request was accepted. You're on LOA until ${ts(req.endAt, 'F')}.`
    );
  } finally {
    busy.delete(id);
  }
}

/* ---------- ending LOAs when the time is up ---------- */

async function checkExpired(client) {
  if (!client.isReady()) return;

  const requests = store.get('requests') || {};
  const now = Date.now();
  let changed = false;

  for (const req of Object.values(requests)) {
    // Tidy up old finished requests.
    if ((req.status === 'denied' || req.status === 'ended') && now - (req.decidedAt || 0) > 90 * DAY_MS) {
      delete requests[req.id];
      changed = true;
      continue;
    }

    if (req.status !== 'active' || req.endAt > now) continue;

    let finished = true;

    try {
      const guild = client.guilds.cache.get(req.guildId) || (await client.guilds.fetch(req.guildId));
      const member = await guild.members.fetch(req.userId).catch(() => null);

      if (member && isSet(cfg.roleId) && member.roles.cache.has(cfg.roleId)) {
        await member.roles.remove(cfg.roleId, 'LOA ended');
      }
    } catch (err) {
      req.fails = (req.fails || 0) + 1;
      console.error(`[loa] could not end LOA for ${req.userId} (try ${req.fails}):`, err);
      finished = req.fails >= 5; // keep trying a few times
    }

    if (finished) {
      req.status = 'ended';
      changed = true;
      dm(client, req.userId, "Your LOA has ended. Welcome back!");
    } else {
      changed = true;
    }
  }

  if (changed) store.set('requests', requests);
}

module.exports = { submitRequest, handleDecision, checkExpired, canRequest, canReview };
