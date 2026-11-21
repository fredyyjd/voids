const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const createStore = require('./jsonStore');
const extra = require('../extraConfig');
const config = require('../config.json');
const { COLOR } = require('./theme');
const { isAdmin } = require('./permissions');
const { hasBypassRole } = require('./staffBypass');

// Disputes ("false timeout") are sent to the same channel the LOA requests go to.
const validId = (id) => typeof id === 'string' && /^\d{15,25}$/.test(id);
const disputeChannelId = () => extra.loa?.channelId;

const punishments = createStore('automod_punishments.json', {});
const disputes = createStore('automod_disputes.json', {});

const DAY = 24 * 60 * 60 * 1000;
const KEEP_PUNISHMENTS_MS = 14 * DAY;
const MAX_ENTRIES = 40;

const REASONS = {
  spam: 'False timed out for spamming',
  everyone: 'False timed out for @here or @everyone ping',
  mentions: 'False timed out for mentioning too many people / roles',
  ping_protection: 'False timed out for pinging a protected member',
  language: 'False timed out for inappropriate language',
  slur: 'False timed out for a filtered word / slur',
};

const clip = (text, n) => {
  const s = String(text ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ---------- punishments (what auto mod did, so a dispute can show it) ---------- */

function recordPunishment(data) {
  const id = newId();
  const all = punishments.all();
  const now = Date.now();
  for (const [key, value] of Object.entries(all)) {
    if (now - (value.at || 0) > KEEP_PUNISHMENTS_MS) delete all[key];
  }
  all[id] = { ...data, id, at: now };
  punishments.overwriteAll(all);
  return id;
}

function contactRow(punId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fto_open:${punId}`).setLabel('Contact higher ups').setStyle(ButtonStyle.Primary)
  );
}

/* ---------- the dispute embed staff see ---------- */

function responsesText(entries) {
  if (!entries.length) return '';
  const lines = entries.map((e) => {
    const who = e.by === 'staff' ? `**Staff (${clip(e.name, 40)})**` : `**${clip(e.name, 40)}**`;
    const note = e.by === 'staff' && e.delivered === false ? ' *(DM not delivered)*' : '';
    return `${who} ${ts(e.at, 't')}${note}\n${clip(e.text, 900)}`;
  });

  let out = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const next = lines[i] + (out ? `\n\n${out}` : '');
    if (next.length > 2600) {
      out = `*…older replies hidden*\n\n${out}`;
      break;
    }
    out = next;
  }
  return out;
}

function statusText(d) {
  if (d.status === 'closed') return `Closed by <@${d.statusBy}> ${ts(d.statusAt)}`;
  if (d.status === 'blocked') return `Blocked by <@${d.statusBy}> ${ts(d.statusAt)}`;
  return 'Open';
}

function disputeEmbed(d) {
  const evidence = (d.evidence || []).length
    ? d.evidence
        .slice(-8)
        .map((e) => `• ${clip(e.text || '*(no text)*', 150).replace(/\n/g, ' ')}${e.channelId ? ` (<#${e.channelId}>)` : ''}`)
        .join('\n')
    : '*Not saved*';

  const embed = new EmbedBuilder()
    .setTitle('False Timeout Dispute')
    .setColor(d.status === 'open' ? 0xfee75c : d.status === 'blocked' ? 0xed4245 : 0x57f287)
    .addFields(
      { name: 'User', value: `<@${d.userId}>`, inline: true },
      { name: 'Display name', value: clip(d.displayName, 100) || 'Unknown', inline: true },
      { name: 'User ID', value: d.userId, inline: true },
      { name: 'Username', value: clip(d.username, 100) || 'Unknown', inline: true },
      { name: 'Topic', value: 'False time out', inline: true },
      { name: 'Status', value: statusText(d), inline: true },
      { name: 'Reason they selected', value: REASONS[d.reasonKey] || d.reasonLabel || 'Unknown' },
      {
        name: 'What auto mod did',
        value: clip(
          `${d.autoReason || 'Unknown'}\nTimeout: **${d.timeoutText || 'Unknown'}** · ${ts(d.punishedAt, 'f')}`,
          1000
        ),
      },
      { name: 'Messages they were timed out for', value: clip(evidence, 1000) }
    )
    .setFooter({ text: `Dispute ${d.id}` })
    .setTimestamp(d.createdAt);

  const thread = responsesText(d.entries || []);
  if (thread) embed.setDescription(`### Responses\n${thread}`);
  return embed;
}

// Buttons under the dispute: open = Message back / Close / Block, closed = Re-open / Block, blocked = none.
function staffRow(d) {
  const btn = (customId, label, style) => new ButtonBuilder().setCustomId(`${customId}:${d.id}`).setLabel(label).setStyle(style);
  if (d.status === 'blocked') return null;
  const row = new ActionRowBuilder();
  if (d.status === 'closed') {
    row.addComponents(btn('fto_staffreopen', 'Re-open', ButtonStyle.Success), btn('fto_block', 'Block', ButtonStyle.Danger));
  } else {
    row.addComponents(
      btn('fto_msgback', 'Message back', ButtonStyle.Primary),
      btn('fto_close', 'Close dispute', ButtonStyle.Secondary),
      btn('fto_block', 'Block', ButtonStyle.Danger)
    );
  }
  return row;
}

const staffPayload = (d) => {
  const row = staffRow(d);
  return { embeds: [disputeEmbed(d)], components: row ? [row] : [] };
};

const canReply = (member) => !!member && (isAdmin(member) || hasBypassRole(member));

// Someone already has a dispute for this timeout: open = wait, closed = re-open it, blocked = no.
async function existingReply(interaction, d) {
  if (d.status === 'blocked') {
    return interaction.reply({ content: "High staff blocked you from disputing this timeout, so you can't open another dispute for it." });
  }
  if (d.status === 'closed') return reopen(interaction, d.id, 'user');
  return interaction.reply({ content: 'You already opened a dispute for this timeout. High staff will get back to you.' });
}

/* ---------- step 1: button -> "what do you want to contact them about" ---------- */

async function openFlow(interaction, punId) {
  const pun = punishments.get(punId);

  if (!pun || pun.userId !== interaction.user.id) {
    return interaction.reply({
      content: 'That timeout is too old to dispute here. Please message a higher staff member in the server.',
    });
  }

  const existing = Object.values(disputes.all()).find((d) => d.punId === punId);
  if (existing) return existingReply(interaction, existing);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setDescription(`Hi <@${interaction.user.id}>, I see you want to contact high staff. What would you like to contact them about?`);

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`fto_topic:${punId}`)
      .setPlaceholder('Select what this is about')
      .addOptions({ label: 'False time out', value: 'false_timeout', description: 'I got timed out by auto mod by mistake' })
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

/* ---------- step 2: topic -> "which reason did you get false timed out for" ---------- */

async function topicFlow(interaction, punId) {
  const pun = punishments.get(punId);
  if (!pun || pun.userId !== interaction.user.id) {
    return interaction.update({ content: 'That timeout is too old to dispute here.', embeds: [], components: [] });
  }

  await interaction.update({ components: [] });

  const embed = new EmbedBuilder().setColor(COLOR).setDescription('Ok, select which reason you got false timed out for.');
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`fto_reason:${punId}`)
      .setPlaceholder('Select the reason')
      .addOptions(Object.entries(REASONS).map(([value, label]) => ({ label, value })))
  );

  return interaction.followUp({ embeds: [embed], components: [row] });
}

/* ---------- step 3: reason -> dispute opened + sent to the staff channel ---------- */

async function reasonFlow(interaction, punId) {
  const reasonKey = interaction.values[0];
  const pun = punishments.get(punId);

  await interaction.update({ components: [] });

  if (!pun || pun.userId !== interaction.user.id || !REASONS[reasonKey]) {
    return interaction.followUp({ content: 'Something went wrong. Please press the button on the timeout message again.' });
  }

  const existing = Object.values(disputes.all()).find((d) => d.punId === punId);
  if (existing) {
    const text =
      existing.status === 'blocked'
        ? "High staff blocked you from disputing this timeout, so you can't open another dispute for it."
        : 'You already opened a dispute for this timeout. High staff will get back to you.';
    return interaction.followUp({ content: text });
  }

  const client = interaction.client;
  const guild = client.guilds.cache.get(pun.guildId) || (await client.guilds.fetch(pun.guildId).catch(() => null));
  const channelId = disputeChannelId();
  const channel = guild && validId(channelId) ? await guild.channels.fetch(channelId).catch(() => null) : null;

  if (!channel || !channel.isTextBased()) {
    return interaction.followUp({ content: "I couldn't reach high staff right now. Please message an Admin in the server." });
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  const id = newId();

  const d = {
    id,
    punId,
    guildId: guild.id,
    userId: interaction.user.id,
    displayName: member?.displayName || interaction.user.globalName || interaction.user.username,
    username: interaction.user.username,
    reasonKey,
    reasonLabel: REASONS[reasonKey],
    autoReason: pun.reason,
    timeoutText: pun.timeoutText,
    punishedAt: pun.at,
    evidence: pun.evidence || [],
    status: 'open',
    entries: [],
    createdAt: Date.now(),
    channelId: channel.id,
    messageId: null,
  };

  // No pings: the dispute is just posted in the channel.
  const sent = await channel.send({ ...staffPayload(d), allowedMentions: { parse: [] } }).catch(() => null);

  if (!sent) {
    return interaction.followUp({ content: "I couldn't reach high staff right now. Please message an Admin in the server." });
  }

  d.messageId = sent.id;
  disputes.set(id, d);

  const done = new EmbedBuilder().setColor(COLOR).setDescription('**Dispute opened.** Wait for high staff to get back to you.');
  return interaction.followUp({ embeds: [done] });
}

/* ---------- staff: Message back ---------- */

async function msgBackButton(interaction, id) {
  if (!canReply(interaction.member)) {
    return interaction.reply({ content: "❌ Only higher staff can reply to disputes.", flags: MessageFlags.Ephemeral });
  }
  const found = disputes.get(id);
  if (!found) return interaction.reply({ content: 'That dispute was not found.', flags: MessageFlags.Ephemeral });
  if (found.status !== 'open') {
    return interaction.reply({ content: 'That dispute is not open. Re-open it first.', flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`fto_msgback_modal:${id}`)
    .setTitle('Message back')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('text')
          .setLabel('What do you want to tell them?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
  return interaction.showModal(modal);
}

async function msgBackSubmit(interaction, id) {
  const d = disputes.get(id);
  if (!d) return interaction.reply({ content: 'That dispute was not found.', flags: MessageFlags.Ephemeral });
  if (!canReply(interaction.member)) {
    return interaction.reply({ content: '❌ Only higher staff can reply to disputes.', flags: MessageFlags.Ephemeral });
  }
  if (d.status !== 'open') return interaction.reply({ content: 'That dispute is not open. Re-open it first.', flags: MessageFlags.Ephemeral });

  const text = interaction.fields.getTextInputValue('text').trim();
  if (!text) return interaction.reply({ content: 'Type something first.', flags: MessageFlags.Ephemeral });

  const user = await interaction.client.users.fetch(d.userId).catch(() => null);
  const guildName = interaction.guild?.name || 'the server';

  const dmEmbed = new EmbedBuilder()
    .setTitle('Reply from high staff')
    .setColor(COLOR)
    .setDescription(text)
    .setFooter({ text: guildName })
    .setTimestamp();
  const replyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fto_reply:${id}`).setLabel('Reply').setStyle(ButtonStyle.Secondary)
  );

  const delivered = user ? await user.send({ embeds: [dmEmbed], components: [replyRow] }).then(() => true).catch(() => false) : false;

  d.entries = [
    ...(d.entries || []),
    {
      by: 'staff',
      userId: interaction.user.id,
      name: interaction.member?.displayName || interaction.user.username,
      text,
      at: Date.now(),
      delivered,
    },
  ].slice(-MAX_ENTRIES);
  disputes.set(id, d);

  const payload = staffPayload(d);
  if (interaction.isFromMessage()) await interaction.update(payload);
  else {
    await interaction.message?.edit(payload).catch(() => {});
    await interaction.reply({ content: 'Sent.', flags: MessageFlags.Ephemeral });
  }

  if (!delivered) {
    await interaction
      .followUp({ content: "⚠️ I couldn't DM them (their DMs are closed). Your message is saved on the embed.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}

/* ---------- user: Reply (adds their response to the embed) ---------- */

async function userReplyButton(interaction, id) {
  const d = disputes.get(id);
  if (!d || d.userId !== interaction.user.id) {
    return interaction.reply({ content: 'That dispute was not found.' });
  }
  if (d.status === 'blocked') return interaction.reply({ content: "High staff blocked you from disputing this timeout, so you can't reply." });
  if (d.status === 'closed') {
    return interaction.reply({ content: 'This dispute is closed. Press **Contact higher ups** on your timeout message to re-open it.' });
  }

  const modal = new ModalBuilder()
    .setCustomId(`fto_reply_modal:${id}`)
    .setTitle('Reply to high staff')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('text')
          .setLabel('Your reply')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
  return interaction.showModal(modal);
}

async function userReplySubmit(interaction, id) {
  const d = disputes.get(id);
  if (!d || d.userId !== interaction.user.id) return interaction.reply({ content: 'That dispute was not found.' });
  if (d.status === 'blocked') return interaction.reply({ content: "High staff blocked you from disputing this timeout, so you can't reply." });
  if (d.status === 'closed') {
    return interaction.reply({ content: 'This dispute is closed. Press **Contact higher ups** on your timeout message to re-open it.' });
  }

  const text = interaction.fields.getTextInputValue('text').trim();
  if (!text) return interaction.reply({ content: 'Type something first.' });

  d.entries = [...(d.entries || []), { by: 'user', userId: d.userId, name: d.displayName, text, at: Date.now() }].slice(-MAX_ENTRIES);
  disputes.set(id, d);

  const guild = interaction.client.guilds.cache.get(d.guildId) || (await interaction.client.guilds.fetch(d.guildId).catch(() => null));
  const channel = guild ? await guild.channels.fetch(d.channelId).catch(() => null) : null;
  const message = channel?.isTextBased() ? await channel.messages.fetch(d.messageId).catch(() => null) : null;

  if (!message) {
    return interaction.reply({ content: "I couldn't reach high staff right now. Please message an Admin in the server." });
  }

  await message.edit(staffPayload(d)).catch(() => {});
  await message.reply({ content: `📨 **${clip(d.displayName, 60)}** replied to this dispute.`, allowedMentions: { parse: [] } }).catch(() => {});

  return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription('Your reply was sent to high staff.')] });
}

/* ---------- close / block / re-open ---------- */

async function fetchDisputeMessage(client, d) {
  const guild = client.guilds.cache.get(d.guildId) || (await client.guilds.fetch(d.guildId).catch(() => null));
  const channel = guild ? await guild.channels.fetch(d.channelId).catch(() => null) : null;
  return channel?.isTextBased() ? channel.messages.fetch(d.messageId).catch(() => null) : null;
}

async function setStatus(interaction, id, status) {
  if (!canReply(interaction.member)) {
    return interaction.reply({ content: '❌ Only higher staff can do that.', flags: MessageFlags.Ephemeral });
  }
  const d = disputes.get(id);
  if (!d) return interaction.reply({ content: 'That dispute was not found.', flags: MessageFlags.Ephemeral });

  d.status = status;
  d.statusBy = interaction.user.id;
  d.statusAt = Date.now();
  disputes.set(id, d);

  await interaction.update(staffPayload(d));

  const user = await interaction.client.users.fetch(d.userId).catch(() => null);
  if (!user) return;

  if (status === 'closed') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`fto_reopen:${id}`).setLabel('Re-open dispute').setStyle(ButtonStyle.Secondary)
    );
    await user
      .send({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription('Your dispute was **closed** by high staff. You can re-open it if you still need help.')], components: [row] })
      .catch(() => {});
  } else if (status === 'blocked') {
    await user
      .send({ embeds: [new EmbedBuilder().setColor(0xed4245).setDescription("Your dispute was closed and high staff blocked you from disputing this timeout again.")] })
      .catch(() => {});
  } else if (status === 'open') {
    await user
      .send({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription('High staff **re-opened** your dispute.')] })
      .catch(() => {});
  }
}

// The user re-opens a closed dispute (button in the close DM, or the Contact higher ups button again).
async function reopen(interaction, id, who) {
  const d = disputes.get(id);
  if (!d || d.userId !== interaction.user.id) return interaction.reply({ content: 'That dispute was not found.' });
  if (d.status === 'blocked') {
    return interaction.reply({ content: "High staff blocked you from disputing this timeout, so you can't re-open it." });
  }
  if (d.status === 'open') return interaction.reply({ content: 'This dispute is already open. High staff will get back to you.' });

  d.status = 'open';
  d.statusBy = null;
  d.statusAt = Date.now();
  disputes.set(id, d);

  const message = await fetchDisputeMessage(interaction.client, d);
  if (!message) {
    d.status = 'closed';
    disputes.set(id, d);
    return interaction.reply({ content: "I couldn't reach high staff right now. Please message an Admin in the server." });
  }

  await message.edit(staffPayload(d)).catch(() => {});
  await message.reply({ content: `🔓 **${clip(d.displayName, 60)}** re-opened this dispute.`, allowedMentions: { parse: [] } }).catch(() => {});
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription('**Dispute re-opened.** Wait for high staff to get back to you.')] });
}

/* ---------- router ---------- */

async function handle(interaction) {
  const id = interaction.customId || '';

  if (interaction.isButton()) {
    if (id.startsWith('fto_open:')) { await openFlow(interaction, id.slice(9)); return true; }
    if (id.startsWith('fto_msgback:')) { await msgBackButton(interaction, id.slice(12)); return true; }
    if (id.startsWith('fto_reply:')) { await userReplyButton(interaction, id.slice(10)); return true; }
    if (id.startsWith('fto_close:')) { await setStatus(interaction, id.slice(10), 'closed'); return true; }
    if (id.startsWith('fto_block:')) { await setStatus(interaction, id.slice(10), 'blocked'); return true; }
    if (id.startsWith('fto_staffreopen:')) { await setStatus(interaction, id.slice(16), 'open'); return true; }
    if (id.startsWith('fto_reopen:')) { await reopen(interaction, id.slice(11), 'user'); return true; }
  } else if (interaction.isStringSelectMenu()) {
    if (id.startsWith('fto_topic:')) { await topicFlow(interaction, id.slice(10)); return true; }
    if (id.startsWith('fto_reason:')) { await reasonFlow(interaction, id.slice(11)); return true; }
  } else if (interaction.isModalSubmit()) {
    if (id.startsWith('fto_msgback_modal:')) { await msgBackSubmit(interaction, id.slice(18)); return true; }
    if (id.startsWith('fto_reply_modal:')) { await userReplySubmit(interaction, id.slice(16)); return true; }
  }
  return false;
}

module.exports = { recordPunishment, contactRow, handle, REASONS };
