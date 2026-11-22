const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { hasMaxPerms } = require('./permissions');
const { fail, NO_PERMS } = require('./reply');
const { COLOR } = require('./theme');
const points = require('./staffPoints');
const store = require('./staffStore');
const cfg = require('./staffConfig');
const actions = require('./staffActions');
const { buildStaffEmbed } = require('./staffStatusView');

const NO_PING = { parse: [] };

const ACTIONS = {
  warn: { label: 'Warn', pick: 'Pick the staff member to warn', style: ButtonStyle.Secondary },
  strike: { label: 'Strike', pick: 'Pick the staff member to strike', style: ButtonStyle.Danger },
  rwarn: { label: 'Remove warn', pick: 'Pick who to remove a warn from', style: ButtonStyle.Secondary },
  rstrike: { label: 'Remove strike', pick: 'Pick who to remove a strike from', style: ButtonStyle.Secondary },
  lookup: { label: 'Look up', pick: 'Pick the staff member to look up', style: ButtonStyle.Primary },
  reset: { label: 'Reset record', pick: 'Pick whose record to clear', style: ButtonStyle.Secondary },
};

function homeEmbed(guild) {
  const base = cfg.isSet(cfg.baseRoleId) ? guild.roles.cache.get(cfg.baseRoleId) : null;
  const staffCount = base ? base.members.size : null;

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Staff Center')
    .setDescription('Manage warns, strikes and the weekly review from here.\nPick an action below.')
    .addFields(
      { name: 'Staff', value: staffCount === null ? '-' : `${staffCount}`, inline: true },
      { name: 'Next review', value: actions.stamp(points.nextResetMs()), inline: true },
      { name: 'Tracking since', value: actions.stamp(store.trackingStart(), 'D'), inline: true },
      {
        name: 'How it works',
        value:
          '**Warn** 3 warns become 1 strike\n' +
          '**Strike** 2 valid strikes means a demotion at the weekly review\n' +
          'Every warn and strike is posted in the staff log channel',
      }
    );
}

function homeRows() {
  const btn = (id, def) => new ButtonBuilder().setCustomId(`sc:${id}`).setLabel(def.label).setStyle(def.style);
  return [
    new ActionRowBuilder().addComponents(
      btn('warn', ACTIONS.warn),
      btn('strike', ACTIONS.strike),
      btn('rwarn', ACTIONS.rwarn),
      btn('rstrike', ACTIONS.rstrike)
    ),
    new ActionRowBuilder().addComponents(
      btn('lookup', ACTIONS.lookup),
      btn('reset', ACTIONS.reset),
      new ButtonBuilder().setCustomId('sc:announce').setLabel('Announce').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sc:review').setLabel('Staff overview').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('sc:lb').setLabel('Points board').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('sc:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sc:home').setLabel('Back to Staff Center').setStyle(ButtonStyle.Secondary)
  );
}

function pickRows() {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId('sc:pick').setPlaceholder('Choose a staff member').setMinValues(1).setMaxValues(1)
    ),
    backRow(),
  ];
}

function confirmRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sc:confirm-reset').setLabel('Yes, clear it').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('sc:home').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function modalFor(action, user) {
  const modal = new ModalBuilder().setCustomId('sc:modal').setTitle(`${ACTIONS[action].label} ${user.username}`.slice(0, 45));

  if (action === 'warn' || action === 'strike') {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('evidence')
          .setLabel('Evidence (message link or short note)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(300)
      )
    );
  } else {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel('How many to remove (1 to 10)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue('1')
          .setMaxLength(2)
      )
    );
  }

  return modal;
}

async function open(interaction) {
  if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const state = { action: null, target: null };

  const message = await interaction.editReply({
    embeds: [homeEmbed(guild)],
    components: homeRows(),
    allowedMentions: NO_PING,
  });

  const home = (i) => i.update({ embeds: [homeEmbed(guild)], components: homeRows(), allowedMentions: NO_PING });

  const collector = message.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith('sc:'),
    time: 15 * 60 * 1000,
  });

  collector.on('collect', async (i) => {
    try {
      const id = i.customId.slice(3);

      if (id === 'home' || id === 'refresh') {
        state.action = null;
        state.target = null;
        return await home(i);
      }

      if (ACTIONS[id]) {
        state.action = id;
        return await i.update({
          embeds: [new EmbedBuilder().setColor(COLOR).setTitle(ACTIONS[id].label).setDescription(ACTIONS[id].pick)],
          components: pickRows(),
        });
      }

      if (id === 'announce') {
        return await require('./staffAnnounce').openForm(i);
      }

      if (id === 'review') {
        await i.deferUpdate();
        const embed = await buildStaffEmbed(guild);
        return await i.editReply({ embeds: [embed], components: [backRow()], allowedMentions: NO_PING });
      }

      if (id === 'lb') {
        const board = points.buildBoard('weekly', 'points', true);
        return await i.update({ embeds: board.embeds, components: [...board.components, backRow()], allowedMentions: NO_PING });
      }

      if (id === 'confirm-reset') {
        const target = state.target;
        if (!target) return await home(i);
        const res = await actions.resetRecord({ guild, actor: i.user, target });
        return await i.update({ embeds: [res.embed], components: [backRow()], allowedMentions: NO_PING });
      }

      if (id === 'pick') {
        const target = i.users.first();
        if (!target || !state.action) return await home(i);
        state.target = target;

        if (state.action === 'lookup') {
          const member = await guild.members.fetch(target.id).catch(() => null);
          return await i.update({ embeds: [actions.lookupEmbed(target, member)], components: [backRow()], allowedMentions: NO_PING });
        }

        if (state.action === 'reset') {
          return await i.update({
            embeds: [
              new EmbedBuilder()
                .setColor(actions.YELLOW)
                .setTitle('Clear this record?')
                .setDescription(`This removes every warn and strike for ${target}.`),
            ],
            components: confirmRows(),
            allowedMentions: NO_PING,
          });
        }

        const action = state.action;
        await i.showModal(modalFor(action, target));

        const submitted = await i
          .awaitModalSubmit({
            filter: (m) => m.customId === 'sc:modal' && m.user.id === i.user.id,
            time: 5 * 60 * 1000,
          })
          .catch(() => null);

        if (!submitted) return;

        let res;
        if (action === 'warn' || action === 'strike') {
          const reason = submitted.fields.getTextInputValue('reason');
          const evidence = submitted.fields.getTextInputValue('evidence') || null;
          const run = action === 'warn' ? actions.warn : actions.strike;
          res = await run({ guild, actor: i.user, target, reason, evidence });
        } else {
          const raw = parseInt(submitted.fields.getTextInputValue('amount') || '1', 10);
          const amount = Number.isFinite(raw) ? Math.max(1, Math.min(10, raw)) : 1;
          res = await actions.removeEntries({ guild, actor: i.user, target, kind: action === 'rwarn' ? 'warn' : 'strike', amount });
        }

        const payload = { embeds: [res.embed], components: [backRow()], allowedMentions: NO_PING };
        if (submitted.isFromMessage()) return await submitted.update(payload);
        return await submitted.reply({ ...payload, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      console.error('[staff center] failed:', err);
      if (!i.deferred && !i.replied) i.reply({ content: 'That did not work, try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });

  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });
}

module.exports = { open };
