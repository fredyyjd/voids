const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../config.json');
const { box, priv } = require('./box');
const { isEventManager } = require('./eventPerms');
const { TYPES, GIVEAWAY_OPTIONS } = require('./eventTypes');
const { buildStartModal } = require('./giveawayFlow');
const engine = require('./eventEngine');
const store = require('./eventStore');

const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_WINNERS = 50;
const ITEM_DIR = path.join(__dirname, '..', 'assets', 'items');

const fail = (interaction, text) => interaction.reply(priv(box(`❌ ${text}`)));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* =========================================================
   DRAFTS (setup is kept in memory until the manager publishes)
========================================================= */

const drafts = new Map();

function getDraft(id, userId) {
  const d = drafts.get(id);
  if (!d || d.userId !== userId || Date.now() - d.createdAt > DRAFT_TTL_MS) {
    drafts.delete(id);
    return null;
  }
  return d;
}

/* =========================================================
   /event  ->  dropdown
========================================================= */

function typeMenuPayload() {
  const options = [
    ...Object.entries(TYPES).map(([value, t]) => ({
      label: t.label,
      value,
      emoji: t.emoji,
      description: t.description.slice(0, 100),
    })),
    ...GIVEAWAY_OPTIONS.map((o) => ({
      label: o.label,
      value: o.value,
      emoji: o.emoji,
      description: o.description,
    })),
  ];

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ev:type')
    .setPlaceholder('Pick an event')
    .addOptions(options);

  return priv(
    box(['## 🎪 Voids Events', 'Pick the event you want to run. You will set the prize, winners and questions next.'], {
      rows: [new ActionRowBuilder().addComponents(menu)],
    })
  );
}

/* =========================================================
   SETUP MODAL (one form: prize, winners, time, points, content)
========================================================= */

function setupModal(type, draft = null) {
  const t = TYPES[type];
  const raw = draft?.raw || {};

  const field = (id, label, { style = TextInputStyle.Short, value, placeholder, required = true, max = 100 } = {}) => {
    const f = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required).setMaxLength(max);
    if (value !== undefined && value !== '') f.setValue(String(value).slice(0, max));
    if (placeholder) f.setPlaceholder(placeholder.slice(0, 100));
    return new ActionRowBuilder().addComponents(f);
  };

  const timeless = t.kind === 'react';

  const rows = [
    field('prize', 'Prize (leave empty for no prize)', { value: raw.prize, required: false, max: 150, placeholder: 'Ex: 5m Donut SMP' }),
    field('winners', 'Number of winners', { value: raw.winners ?? '1', max: 3 }),
    field('time', timeless ? 'Seconds to click after it appears' : 'Time limit per round (seconds)', { value: raw.time ?? String(t.timeLimit), max: 4 }),
    field('points', 'Points per correct answer', { value: raw.points ?? String(t.points), max: 3 }),
    field('content', t.contentLabel, {
      style: TextInputStyle.Paragraph,
      value: raw.content,
      max: 4000,
      placeholder: t.placeholder,
    }),
  ];

  return new ModalBuilder()
    .setCustomId(`ev:setup:${type}${draft ? `:${draft.id}` : ''}`)
    .setTitle(t.label.slice(0, 45))
    .addComponents(...rows);
}

function validate(raw, type) {
  const t = TYPES[type];

  const winnerCount = parseInt(raw.winners, 10);
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > MAX_WINNERS)
    return { error: `Number of winners must be between 1 and ${MAX_WINNERS}.` };

  const timeLimit = parseInt(raw.time, 10);
  if (!Number.isInteger(timeLimit) || timeLimit < 5 || timeLimit > 3600)
    return { error: 'Time limit must be between 5 and 3600 seconds.' };

  const points = parseInt(raw.points, 10);
  if (!Number.isInteger(points) || points < 1 || points > 100)
    return { error: 'Points per correct answer must be between 1 and 100.' };

  const parsed = t.parse(raw.content);
  if (parsed.error) return { error: parsed.error };

  for (const r of parsed.rounds) {
    if (r.localImage && !fs.existsSync(path.join(ITEM_DIR, path.basename(r.localImage))))
      return { error: `\`${r.localImage}\` was not found in assets/items. Upload it there or use an image link instead.` };
  }

  return { settings: { winnerCount, timeLimit, points }, parsed };
}

/* =========================================================
   PREVIEW
========================================================= */

// Events run in the channel where /event was used, and that channel has to be
// inside the events category (config.eventCategoryId). Any channel in it works.
function eventCategoryId() {
  const id = config.eventCategoryId;
  return id && !String(id).startsWith('PUT_') ? String(id) : null;
}

function inEventCategory(channel) {
  const cat = eventCategoryId();
  if (!cat) return true;
  return channel?.parentId === cat;
}

const NOT_EVENT_CHANNEL = () => `Events can only be run in a channel inside the events category${eventCategoryId() ? ` (<#${eventCategoryId()}>)` : ''}. Run \`/event\` in one of those channels.`;

function targetChannelId(draft, interaction) {
  return interaction.channelId;
}

function previewPayload(draft, interaction) {
  const t = TYPES[draft.type];
  const { settings, parsed, raw } = draft;
  const first = parsed.rounds[0];
  const sample = first.prompt && t.kind === 'choice' ? first.prompt : first.display || first.prompt;

  const lines = [
    `## 👀 Preview — ${t.emoji} ${t.label}`,
    [
      `🎁 **Prize:** ${raw.prize || 'None'}`,
      `🏆 **Winners:** ${settings.winnerCount}`,
      `🔁 **Rounds:** ${parsed.rounds.length}`,
      t.kind === 'react' ? null : `⏱️ **Time per round:** ${settings.timeLimit}s`,
      `⭐ **Points per correct answer:** ${settings.points}`,
      `📊 **Counts for the event leaderboard:** ${draft.awardsPoints ? 'Yes' : 'No'}`,
      `📍 **Channel:** <#${targetChannelId(draft, interaction)}>`,
    ].filter(Boolean).join('\n'),
    `**First round:** ${String(sample).slice(0, 200)}`,
  ];

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ev:pub:${draft.id}`).setLabel('Publish Event').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ev:edit:${draft.id}`).setLabel('Edit Settings').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ev:pts:${draft.id}`)
        .setLabel(draft.awardsPoints ? 'Leaderboard points: On' : 'Leaderboard points: Off')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ev:cancel:${draft.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
    ),
  ];

  return box(lines, { rows });
}

/* =========================================================
   MANAGING RUNNING EVENTS (/event action:end|cancel|skip|status)
========================================================= */

const ACTION_VERB = { end: 'End', cancel: 'Cancel', skip: 'Skip the round of' };

async function manageCommand(interaction, action) {
  const running = store.runningEvents(interaction.guildId);
  if (!running.length) return fail(interaction, 'There are no events running right now.');

  if (running.length === 1) {
    await interaction.deferReply({ flags: 64 });
    const res = await engine.manage(interaction.client, running[0].id, action, interaction.user.id);
    return interaction.editReply(box(`${res.ok ? '✅' : '❌'} ${res.text}`));
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ev:pick:${action}`)
    .setPlaceholder('Which event?')
    .addOptions(
      running.slice(0, 25).map((e) => ({
        label: `#${e.id} ${TYPES[e.type].label}`.slice(0, 100),
        value: e.id,
        description: (e.prize || 'No prize').slice(0, 100),
      }))
    );

  return interaction.reply(
    priv(box(`${ACTION_VERB[action]} which event?`, { rows: [new ActionRowBuilder().addComponents(menu)] }))
  );
}

function statusText(guildId) {
  const running = store.runningEvents(guildId);
  if (!running.length) return 'No events are running.';
  return running
    .map((e) => {
      const round = e.roundIndex >= 0 ? `round ${e.roundIndex + 1}/${e.rounds.length}` : 'starting';
      return `**#${e.id}** ${TYPES[e.type].emoji} ${TYPES[e.type].label} in <#${e.channelId}> — ${round}, ${plural(Object.keys(e.participants).length, 'player')}`;
    })
    .join('\n');
}

/* =========================================================
   INTERACTION ROUTER
========================================================= */

async function handle(interaction) {
  const id = interaction.customId;
  if (!id?.startsWith('ev:')) return false;

  const [, kind, a, b] = id.split(':');
  const flowKinds = ['type', 'setup', 'pub', 'edit', 'pts', 'cancel', 'pick'];
  if (!flowKinds.includes(kind)) return false;

  // Every setup/manage control re-checks permissions on the server.
  if (!isEventManager(interaction.member)) {
    await fail(interaction, "You can't use event controls.");
    return true;
  }

  /* ---- dropdown: choose event ---- */
  if (kind === 'type' && interaction.isStringSelectMenu()) {
    const value = interaction.values[0];

    if (value === 'giveaway' || value === 'splitsteal') {
      await interaction.showModal(buildStartModal(value));
      return true;
    }

    if (!TYPES[value]) {
      await fail(interaction, 'Unknown event type.');
      return true;
    }

    await interaction.showModal(setupModal(value));
    return true;
  }

  /* ---- modal: setup / edit ---- */
  if (kind === 'setup' && interaction.isModalSubmit()) {
    const type = a;
    if (!TYPES[type]) {
      await fail(interaction, 'Unknown event type.');
      return true;
    }

    const raw = {
      prize: interaction.fields.getTextInputValue('prize').trim(),
      winners: interaction.fields.getTextInputValue('winners').trim(),
      time: interaction.fields.getTextInputValue('time').trim(),
      points: interaction.fields.getTextInputValue('points').trim(),
      content: interaction.fields.getTextInputValue('content').trim(),
    };

    let draft = b ? getDraft(b, interaction.user.id) : null;
    if (!draft) {
      draft = { id: crypto.randomBytes(4).toString('hex'), userId: interaction.user.id, type, awardsPoints: true, createdAt: Date.now() };
      drafts.set(draft.id, draft);
    }
    draft.raw = raw;

    const result = validate(raw, type);
    if (result.error) {
      draft.parsed = null;
      const retry = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ev:edit:${draft.id}`).setLabel('Fix it').setStyle(ButtonStyle.Primary)
      );
      await interaction.reply(priv(box(`❌ ${result.error}`, { rows: [retry] })));
      return true;
    }

    draft.settings = result.settings;
    draft.parsed = result.parsed;

    await interaction.reply(priv(previewPayload(draft, interaction)));
    return true;
  }

  /* ---- preview buttons ---- */
  if (['pub', 'edit', 'pts', 'cancel'].includes(kind) && interaction.isButton()) {
    const draft = getDraft(a, interaction.user.id);
    if (!draft) {
      await interaction.update(box('⌛ This setup expired. Run `/event` again.'));
      return true;
    }

    if (kind === 'cancel') {
      drafts.delete(draft.id);
      await interaction.update(box('🗑️ Event setup cancelled.'));
      return true;
    }

    if (kind === 'edit') {
      await interaction.showModal(setupModal(draft.type, draft));
      return true;
    }

    if (kind === 'pts') {
      draft.awardsPoints = !draft.awardsPoints;
      await interaction.update(previewPayload(draft, interaction));
      return true;
    }

    // publish
    if (!draft.parsed) {
      await fail(interaction, 'Fix the settings first with Edit Settings.');
      return true;
    }

    const channel = await interaction.client.channels.fetch(targetChannelId(draft, interaction)).catch(() => null);
    if (!channel?.isTextBased()) {
      await fail(interaction, 'I could not find the events channel.');
      return true;
    }

    if (!inEventCategory(channel)) {
      await fail(interaction, NOT_EVENT_CHANNEL());
      return true;
    }

    const me = channel.guild?.members?.me;
    const perms = me && channel.permissionsFor(me);
    if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) {
      await fail(interaction, `I need View Channel, Send Messages, Embed Links and Attach Files in <#${channel.id}>.`);
      return true;
    }

    // Drop the draft first so a double click can't publish twice.
    drafts.delete(draft.id);
    await interaction.deferUpdate();

    try {
      const ev = await engine.startEvent(interaction.client, { channel, hostId: interaction.user.id, draft });
      await interaction.editReply(box(`✅ Event **#${ev.id}** published in <#${channel.id}>. It starts in 10 seconds.\nUse \`/event action:End\` or \`Cancel\` to stop it.`));
    } catch (err) {
      console.error('[events] publish failed', err);
      await interaction.editReply(box('❌ Could not publish the event. Check my permissions in that channel.')).catch(() => {});
    }
    return true;
  }

  /* ---- dropdown: pick which running event to manage ---- */
  if (kind === 'pick' && interaction.isStringSelectMenu()) {
    const action = a;
    if (!['end', 'cancel', 'skip'].includes(action)) return true;
    await interaction.deferUpdate();
    const res = await engine.manage(interaction.client, interaction.values[0], action, interaction.user.id);
    await interaction.editReply(box(`${res.ok ? '✅' : '❌'} ${res.text}`));
    return true;
  }

  return false;
}

module.exports = { handle, typeMenuPayload, manageCommand, statusText, inEventCategory, NOT_EVENT_CHANNEL };
