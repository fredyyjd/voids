const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const createStore = require('./jsonStore');
const extra = require('../extraConfig');
const { COLOR } = require('./theme');
const { hasMaxPerms, isSupport, isMod } = require('./permissions');
const { hasBypassRole } = require('./staffBypass');

/* =========================================================
   /request ping
   1. Staff run /request ping -> only they see an embed explaining each ping
      and a dropdown to pick one.
   2. The pick is sent to the management channel with Accept / Deny.
   3. Accepted -> they can use that ONE ping once. The moment they send it
      the grant is used up, and they have to request again.
   Auto mod / ping guard call authorizes() so the approved ping is not punished.
========================================================= */

const cfg = () => extra.request || {};

// data/ping_requests.json: requestId -> { userId, type, status, used, ... }
const store = createStore('ping_requests.json', {});

const HOUR = 60 * 60 * 1000;
const GREEN = 0x57f287;
const RED = 0xed4245;

const validId = (id) => typeof id === 'string' && /^\d{15,25}$/.test(id);

// Every ping you can request. Role pings use the ids from extraConfig.request.roles.
function types() {
  const r = cfg().roles || {};
  const role = (id) => (validId(id) ? `<@&${id}>` : 'the role');
  return {
    everyone: {
      label: '@everyone',
      text: '@everyone',
      short: 'Pings everyone, VIPs and famous people too',
      info: 'Pings **everyone** in the server, including VIPs and famous people.',
    },
    here: {
      label: '@here',
      text: '@here',
      short: 'Pings online members, can include VIPs / famous',
      info: 'Pings all **online** members, so it can include VIPs and famous people.',
    },
    member: {
      label: '@member',
      roleId: r.member,
      short: 'Everyone with the Member role (not VIPs / famous)',
      info: `Pings everyone with the ${role(r.member)} role, which is the whole server other than VIPs and famous people.`,
    },
    announcement: {
      label: '@announcement',
      roleId: r.announcement,
      short: 'Announcement ping role, usually not VIPs / famous',
      info: `Pings everyone with the ${role(r.announcement)} role. Can be anyone, but usually not VIPs or famous people.`,
    },
    staffstreams: {
      label: '@staff streams',
      roleId: r.staffStreams,
      short: 'Staff streams role, usually not VIPs / famous',
      info: `Pings everyone with the ${role(r.staffStreams)} role. Usually doesn't include VIPs or famous people.`,
    },
    partnership: {
      label: 'Partnership ping',
      roleId: r.partnership,
      short: 'Partnership ping role',
      info: `Pings everyone with the ${role(r.partnership)} partnership ping role.`,
    },
  };
}

function pingText(type) {
  const t = types()[type];
  if (!t) return '';
  return t.roleId ? `<@&${t.roleId}>` : t.text;
}

function allowedFor(type) {
  const t = types()[type];
  return t && t.roleId ? { roles: [t.roleId] } : { parse: ['everyone'] };
}

/* ---------- who can do what ---------- */

function hasAnyRole(member, ids) {
  const roles = member?.roles?.cache;
  if (!roles) return false;
  return (ids || []).some((id) => validId(id) && roles.has(id));
}

// Staff role or max perms.
function canRequest(member) {
  if (!member) return false;
  if (hasMaxPerms(member) || isSupport(member) || isMod(member)) return true;
  return hasAnyRole(member, cfg().requesterRoleIds);
}

// Management: max perms, the bypass roles, or the extra reviewer roles.
function canReview(member) {
  if (!member) return false;
  if (hasMaxPerms(member) || hasBypassRole(member)) return true;
  return hasAnyRole(member, cfg().reviewerRoleIds);
}

/* ---------- requests / grants ---------- */

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// pending (not stale) or accepted-and-unused (not expired) = still counts as their one ping
function isLive(req, now = Date.now()) {
  if (!req) return false;
  if (req.status === 'pending') return now - req.createdAt < 24 * HOUR;
  if (req.status === 'accepted') return !req.used && now < (req.expiresAt || 0);
  return false;
}

function liveRequestFor(userId) {
  return Object.values(store.all()).find((r) => r.userId === userId && isLive(r)) || null;
}

function prune() {
  const all = store.all();
  const cutoff = Date.now() - 14 * 24 * HOUR;
  let changed = false;
  for (const [id, r] of Object.entries(all)) {
    if (!isLive(r) && (r.decidedAt || r.createdAt || 0) < cutoff) {
      delete all[id];
      changed = true;
    }
  }
  if (changed) store.overwriteAll(all);
}

/* ---------- the embed only the requester sees ---------- */

function buildInfoEmbed() {
  const t = types();
  const lines = Object.values(t).map((x) => `**${x.label}**\n${x.info}`);
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Ping Request')
    .setDescription(
      `${lines.join('\n\n')}\n\n` +
        'Pick the ping you want from the dropdown.\n\n' +
        "-# It sends a request to management. If it gets accepted you can use your @ ping once, anymore and you will need to request again."
    );
}

function buildSelectRow(userId) {
  const t = types();
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`req_ping_select:${userId}`)
      .setPlaceholder('Choose a ping')
      .addOptions(
        Object.entries(t).map(([value, x]) => ({
          label: x.label,
          description: x.short.slice(0, 100),
          value,
        }))
      )
  );
}

async function startRequest(interaction) {
  const live = liveRequestFor(interaction.user.id);
  if (live) {
    const label = types()[live.type]?.label || 'a ping';
    return interaction.reply({
      content:
        live.status === 'pending'
          ? `You already have a request for **${label}** waiting on management.`
          : `You still have an unused **${label}** ping. Use it first, then request again.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    embeds: [buildInfoEmbed()],
    components: [buildSelectRow(interaction.user.id)],
    flags: MessageFlags.Ephemeral,
  });
}

/* ---------- the request sent to management ---------- */

function buildReviewRow(requestId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`req_ping_accept:${requestId}`)
      .setLabel('Accept')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`req_ping_deny:${requestId}`)
      .setLabel('Deny')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

const creating = new Set();

async function handleSelect(interaction) {
  const match = /^req_ping_select:(\d+)$/.exec(interaction.customId);
  if (!match) return false;

  if (interaction.user.id !== match[1]) {
    await interaction.reply({ content: "That menu isn't yours.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!canRequest(interaction.member)) {
    await interaction.reply({ content: "You can't use this.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (creating.has(interaction.user.id)) return true;
  creating.add(interaction.user.id);

  try {
    const type = interaction.values[0];
    const t = types()[type];
    if (!t) {
      await interaction.reply({ content: "I don't know that ping.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (liveRequestFor(interaction.user.id)) {
      await interaction.update({
        content: 'You already have a request or an unused ping. Use it first, then request again.',
        embeds: [],
        components: [],
      });
      return true;
    }

    const channelId = cfg().channelId;
    const channel = validId(channelId)
      ? await interaction.guild.channels.fetch(channelId).catch(() => null)
      : null;
    if (!channel || !channel.isTextBased()) {
      await interaction.update({
        content: "Couldn't send the request. The management channel isn't set or I can't see it.",
        embeds: [],
        components: [],
      });
      return true;
    }

    const requestId = newId();
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('Ping Request')
      .setDescription(`${interaction.user} wants to use **${t.label}** (asked in ${interaction.channel}).`)
      .addFields(
        { name: 'Ping', value: t.info.slice(0, 1000) },
        { name: 'Status', value: '🟡 Waiting for management', inline: true }
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();

    const pingRoles = (cfg().approvalPingRoleIds || []).filter(validId);
    const sent = await channel
      .send({
        content: pingRoles.length ? pingRoles.map((r) => `<@&${r}>`).join(' ') : undefined,
        embeds: [embed],
        components: [buildReviewRow(requestId)],
        allowedMentions: { roles: pingRoles },
      })
      .catch((err) => {
        console.error('[request] could not send to management:', err.message);
        return null;
      });

    if (!sent) {
      await interaction.update({
        content: "Couldn't send the request. Check I can send messages in the management channel.",
        embeds: [],
        components: [],
      });
      return true;
    }

    prune();
    store.set(requestId, {
      id: requestId,
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      channelId: interaction.channelId,
      type,
      status: 'pending',
      used: false,
      reviewMessageId: sent.id,
      createdAt: Date.now(),
    });

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle('Request sent')
          .setDescription(
            `Your request for **${t.label}** is with management.\n\n` +
              '-# If it gets accepted you can use that ping once. You can only have one request at a time.'
          ),
      ],
      components: [],
    });
    return true;
  } finally {
    creating.delete(interaction.user.id);
  }
}

async function handleButton(interaction) {
  const match = /^req_ping_(accept|deny):(\w+)$/.exec(interaction.customId);
  if (!match) return false;

  const accept = match[1] === 'accept';
  const requestId = match[2];

  if (!canReview(interaction.member)) {
    await interaction.reply({ content: "You can't accept or deny these.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const req = store.get(requestId);
  if (!req) {
    await interaction.reply({ content: 'I lost track of that request.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (req.status !== 'pending') {
    await interaction.reply({ content: `That request was already ${req.status}.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (accept && interaction.user.id === req.userId) {
    await interaction.reply({ content: "You can't accept your own request.", flags: MessageFlags.Ephemeral });
    return true;
  }

  // Lock it in before anything async so a double click can't grant two pings.
  req.status = accept ? 'accepted' : 'denied';
  req.decidedBy = interaction.user.id;
  req.decidedAt = Date.now();
  if (accept) req.expiresAt = Date.now() + (cfg().grantHours || 24) * HOUR;
  store.set(requestId, req);

  const t = types()[req.type] || { label: 'a ping' };

  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(accept ? GREEN : RED)
    .setFooter({ text: `${accept ? 'Accepted' : 'Denied'} by ${interaction.user.tag}` });
  const fields = (embed.data.fields || []).filter((f) => f.name !== 'Status');
  embed.setFields(
    ...fields,
    { name: 'Status', value: `${accept ? '✅ Accepted' : '❌ Denied'} by ${interaction.user}`, inline: true }
  );

  await interaction.update({ embeds: [embed], components: [buildReviewRow(requestId, true)] });

  const text = accept
    ? `Your **${t.label}** ping request was accepted. You can use it once, then you will need to request again.`
    : `Your **${t.label}** ping request was denied.`;

  const requester = await interaction.client.users.fetch(req.userId).catch(() => null);
  const dmOk = requester ? await requester.send(text).then(() => true).catch(() => false) : false;

  // DMs closed: tell them where they asked instead.
  if (!dmOk) {
    const origin = await interaction.client.channels.fetch(req.channelId).catch(() => null);
    if (origin && origin.isTextBased()) {
      await origin
        .send({ content: `<@${req.userId}> ${text}`, allowedMentions: { users: [req.userId] } })
        .catch(() => {});
    }
  }
  return true;
}

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('req_ping_select:')) {
    return handleSelect(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('req_ping_')) {
    return handleButton(interaction);
  }
  return false;
}

/* =========================================================
   USING THE APPROVED PING
========================================================= */

function stripCode(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
}

// Which of the request-able pings a message contains.
function pingsIn(message) {
  const text = stripCode(message.content);
  const found = new Set();
  if (/(^|[^\w])@everyone\b/i.test(text)) found.add('everyone');
  if (/(^|[^\w])@here\b/i.test(text)) found.add('here');
  for (const [key, t] of Object.entries(types())) {
    if (t.roleId && text.includes(`<@&${t.roleId}>`)) found.add(key);
  }
  return found;
}

// The grant this message is covered by, or null. The message must contain ONLY
// the approved ping (no other request-able ping, no other role).
// Stays true for the message that used the grant up, so checks that run
// after it was used (auto mod, ping guard) still agree.
function matchGrant(message) {
  if (!message?.guild || !message.author || message.author.bot || message.webhookId) return null;
  if (!/@everyone|@here|<@&/i.test(message.content || '')) return null;

  const now = Date.now();
  const req = Object.values(store.all()).find(
    (r) =>
      r.userId === message.author.id &&
      r.status === 'accepted' &&
      (r.usedMessageId === message.id || (!r.used && now < (r.expiresAt || 0)))
  );
  if (!req) return null;

  const found = pingsIn(message);
  if (found.size !== 1 || !found.has(req.type)) return null;

  const roleId = types()[req.type]?.roleId;
  for (const id of message.mentions?.roles?.keys?.() || []) {
    if (id !== roleId) return null;
  }
  return req;
}

const authorizes = (message) => Boolean(matchGrant(message));

// For ping protection: the one role this message is allowed to ping.
function grantedRoleId(message) {
  const req = matchGrant(message);
  return req ? types()[req.type]?.roleId || null : null;
}

// Runs on every message: uses the grant up, and sends the ping itself if
// Discord didn't deliver it (e.g. the role isn't mentionable for them).
async function onMessage(message) {
  const req = matchGrant(message);
  if (!req || req.used) return;

  req.used = true;
  req.usedAt = Date.now();
  req.usedMessageId = message.id;
  store.set(req.id, req);

  const t = types()[req.type];
  const delivered = t.roleId ? message.mentions.roles.has(t.roleId) : message.mentions.everyone;
  if (delivered) return;

  await message
    .reply({
      content: pingText(req.type),
      allowedMentions: { ...allowedFor(req.type), repliedUser: false },
    })
    .catch((err) => console.error('[request] could not deliver the ping:', err.message));
}

module.exports = {
  canRequest,
  startRequest,
  handleInteraction,
  authorizes,
  grantedRoleId,
  onMessage,
};
