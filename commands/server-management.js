const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const { hasBypassRole } = require('../utils/staffBypass');
const { fail, NO_PERMS } = require('../utils/reply');
const { buildStaffEmbed, lines, clip, stamp } = require('../utils/staffStatusView');
const modStats = require('../utils/modStats');
const autoMod = require('../utils/autoMod');

const GREEN = 0x57f287;
const NO_PING = { parse: [] };

function buildRow(view) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('sm:staff')
      .setLabel('Staff')
      .setEmoji('🧑‍💼')
      .setStyle(view === 'staff' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('sm:server')
      .setLabel('Server')
      .setEmoji('🛡️')
      .setStyle(view === 'server' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sm:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
  );
}

function buildServerEmbed() {
  const s = modStats.summary();
  const cfg = autoMod.settings();

  const kindLines = Object.entries(modStats.KINDS).map(([key, label]) => {
    const row = s.perKind[key];
    return `**${label}**\n24h **${row.day}** · 7 days **${row.week}** (${row.weekUsers.size} people) · all time **${row.all}**`;
  });

  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle('Server protection')
    .setDescription(
      `Tracking since ${stamp(s.since, 'D')}\n` +
        `Last 24 hours **${s.totalDay}** · last 7 days **${s.totalWeek}** · all time **${s.totalAll}**\n` +
        `People caught: **${s.uniqueWeek}** this week · **${s.uniqueAll}** all time`
    )
    .addFields({ name: 'Triggers', value: clip(kindLines.join('\n\n')) });

  embed.addFields({
    name: 'Most triggered this week',
    value: lines(s.topWeek, ([id, n]) => `<@${id}> · ${n} time${n === 1 ? '' : 's'}`, '*Nobody triggered anything this week*'),
  });

  embed.addFields({
    name: 'Latest',
    value: lines(
      s.latest,
      (e) => `${stamp(e.t)} · ${modStats.KINDS[e.k] || e.k} · <@${e.u}>${e.ok === false ? ' (punishment failed)' : ''}`,
      '*Nothing yet*'
    ),
  });

  const on = (v) => (v ? 'on' : 'off');
  embed.addFields({
    name: 'Settings right now',
    value:
      `Auto moderation **${on(cfg.enabled)}** (beta)\n` +
      `Spam ${on(cfg.spam.enabled)}: ${cfg.spam.messages} msgs / ${cfg.spam.windowSeconds}s → ${cfg.spam.timeoutMinutes}m timeout\n` +
      `@everyone / @here ${on(cfg.everyone.enabled)}: ${cfg.everyone.timeoutMinutes}m timeout\n` +
      `Mentions ${on(cfg.mentions.enabled)}: over ${cfg.mentions.maxUsersPerMessage} people or ${cfg.mentions.maxRolesPerMessage} roles → ${cfg.mentions.timeoutMinutes}m timeout\n` +
      `Repeat offences inside ${cfg.repeatLookbackHours}h add time to the timeout`,
  });

  return embed.setTimestamp();
}

async function render(interaction, view) {
  if (view === 'staff') {
    return buildStaffEmbed(interaction.guild).catch((err) => {
      console.error('[server-management] staff view failed:', err);
      return new EmbedBuilder().setColor(0xed4245).setTitle('Staff right now').setDescription('I could not build the staff view. Check the console.');
    });
  }
  return buildServerEmbed();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server-management')
    .setDescription('Live view of how the server and the staff team are doing')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('view').setDescription('See server protection and staff progress')),

  async execute(interaction) {
    const allowed = hasMaxPerms(interaction.member) || hasBypassRole(interaction.member);
    if (!allowed) return fail(interaction, NO_PERMS);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let view = 'server';
    const first = await render(interaction, view);
    const message = await interaction.editReply({ embeds: [first], components: [buildRow(view)], allowedMentions: NO_PING });

    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith('sm:'),
      time: 10 * 60 * 1000,
    });

    collector.on('collect', async (i) => {
      try {
        await i.deferUpdate();
        if (i.customId === 'sm:staff') view = 'staff';
        if (i.customId === 'sm:server') view = 'server';
        const embed = await render(interaction, view);
        await i.editReply({ embeds: [embed], components: [buildRow(view)], allowedMentions: NO_PING });
      } catch (err) {
        console.error('[server-management] update failed:', err);
      }
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
