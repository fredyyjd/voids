const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const createStore = require('./jsonStore');
const extra = require('../extraConfig');

const cfg = extra.partner;

// data/partner_requests.json: requestId -> { userId, channelId, guildId, message, status, ... }
const store = createStore('partner_requests.json', {});

const BLUE = 0x3b82f6;
const GREEN = 0x57f287;
const RED = 0xed4245;

function isSet(id) {
  return id && !String(id).startsWith('PUT_');
}

// Stops the partner text from sneaking in extra @everyone / @here.
function safeText(text) {
  return String(text || '').replace(/@(everyone|here)/gi, '@\u200b$1').slice(0, 1800);
}

function pingFor(type) {
  if (type === 'here') {
    return { text: '@here', allowedMentions: { parse: ['everyone'] } };
  }
  const roleId = type === 'member' ? cfg.memberRoleId : cfg.partnershipPingRoleId;
  return { text: `<@&${roleId}>`, allowedMentions: { roles: [roleId] } };
}

function buildApprovalRow(requestId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`partner_accept:${requestId}`)
      .setLabel('Accept')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`partner_deny:${requestId}`)
      .setLabel('Deny')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

// Sends the @Member ping request to the approval channel.
async function requestMemberPing(interaction, message) {
  const channel = isSet(cfg.approvalChannelId)
    ? await interaction.guild.channels.fetch(cfg.approvalChannelId).catch(() => null)
    : null;
  if (!channel || !channel.isTextBased()) return false;

  const requestId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const embed = new EmbedBuilder()
    .setTitle('Member Ping Request')
    .setColor(BLUE)
    .setDescription(
      `${interaction.user} wants to ping <@&${cfg.memberRoleId}> in ${interaction.channel}.\n\n` +
        `**Message**\n${message ? message : '*No message*'}`
    )
    .addFields({ name: 'Status', value: '🟡 Waiting for approval', inline: true })
    .setThumbnail(interaction.user.displayAvatarURL())
    .setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  const pingRoles = (cfg.approvalPingRoleIds || []).filter(isSet);

  const sent = await channel
    .send({
      content: pingRoles.length ? pingRoles.map((r) => `<@&${r}>`).join(' ') : undefined,
      embeds: [embed],
      components: [buildApprovalRow(requestId)],
      allowedMentions: { roles: pingRoles },
    })
    .catch((err) => {
      console.error('[partner] could not send the approval request:', err);
      return null;
    });
  if (!sent) return false;

  store.set(requestId, {
    userId: interaction.user.id,
    guildId: interaction.guild.id,
    channelId: interaction.channelId,
    message,
    status: 'pending',
    approvalMessageId: sent.id,
    createdAt: Date.now(),
  });
  return true;
}

// Accept / Deny buttons on the approval message. Anyone who can see that
// channel can press them (except you can't accept your own request).
async function handlePartnerInteraction(interaction) {
  if (!interaction.isButton()) return;
  const match = /^partner_(accept|deny):(\w+)$/.exec(interaction.customId);
  if (!match) return;

  const accept = match[1] === 'accept';
  const requestId = match[2];
  const request = store.get(requestId);

  if (!request) {
    return interaction.reply({ content: 'I lost track of that request.', flags: MessageFlags.Ephemeral });
  }
  if (request.status !== 'pending') {
    return interaction.reply({
      content: `That request was already ${request.status}.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  if (accept && interaction.user.id === request.userId) {
    return interaction.reply({
      content: "You can't accept your own ping request.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Lock it in before anything async so a double click can't send two pings.
  request.status = accept ? 'accepted' : 'denied';
  request.decidedBy = interaction.user.id;
  request.decidedAt = Date.now();
  store.set(requestId, request);

  let sendError = null;
  if (accept) {
    const target = await interaction.client.channels.fetch(request.channelId).catch(() => null);
    const ping = pingFor('member');
    const sent = target
      ? await target
          .send({
            content: `${ping.text}${request.message ? `\n${request.message}` : ''}`,
            allowedMentions: ping.allowedMentions,
          })
          .catch((err) => {
            sendError = err.message;
            return null;
          })
      : null;
    if (!sent) {
      sendError = sendError || 'channel not found';
      request.status = 'failed';
      store.set(requestId, request);
    }
  }

  const old = interaction.message.embeds[0];
  const embed = EmbedBuilder.from(old)
    .setColor(sendError ? RED : accept ? GREEN : RED)
    .setFooter({ text: `${accept ? 'Accepted' : 'Denied'} by ${interaction.user.tag}` });
  const status = sendError
    ? `⚠️ Accepted by ${interaction.user}, but the ping failed (${sendError})`
    : `${accept ? '✅ Accepted' : '❌ Denied'} by ${interaction.user}`;
  const fields = embed.data.fields || [];
  const idx = fields.findIndex((f) => f.name === 'Status');
  if (idx >= 0) embed.spliceFields(idx, 1, { name: 'Status', value: status, inline: true });
  else embed.addFields({ name: 'Status', value: status, inline: true });

  await interaction.update({ embeds: [embed], components: [buildApprovalRow(requestId, true)] });

  const requester = await interaction.client.users.fetch(request.userId).catch(() => null);
  if (requester) {
    requester
      .send(
        accept && !sendError
          ? 'Your @Member ping was approved and sent.'
          : accept
            ? `Your @Member ping was approved, but I couldn't send it (${sendError}).`
            : 'Your @Member ping request was denied.'
      )
      .catch(() => {});
  }
}

module.exports = {
  isSet,
  safeText,
  pingFor,
  requestMemberPing,
  handlePartnerInteraction,
};
