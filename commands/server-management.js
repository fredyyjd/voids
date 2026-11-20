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

  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle('Server Protection')
    .setDescription(
      `Tracking since ${stamp(s.since, 'D')}\n\n` +
        `**${s.totalDay}** in the last 24 hours · **${s.totalWeek}** this week · **${s.totalAll}** all time\n` +
        `**${s.uniqueWeek}** people caught this week · **${s.uniqueAll}** all time`
    );

  for (const [key, label] of Object.entries(modStats.KINDS)) {
    const row = s.perKind[key];
    if (!row) continue;
    embed.addFields({
      name: label,
      value: `Today **${row.day}**\nWeek **${row.week}** (${row.weekUsers.size} people)\nAll time **${row.all}**`,
      inline: true,
    });
  }

  embed.addFields(
    {
      name: 'Most triggered this week',
      value: lines(s.topWeek, ([id, n], i) => `**${i + 1}.** <@${id}> · ${n} time${n === 1 ? '' : 's'}`, '*Nobody triggered anything this week*'),
    },
    {
      name: 'Latest',
      value: lines(
        s.latest,
        (e) => `${stamp(e.t)} · ${modStats.KINDS[e.k] || e.k} · <@${e.u}>${e.ok === false ? ' (punishment failed)' : ''}`,
        '*Nothing yet*'
      ),
    }
  );

  const on = (v) => (v ? 'On' : 'Off');
  embed.addFields({
    name: 'Settings',
    value:
      `**Auto moderation** ${on(cfg.enabled)} (beta)\n` +
      `Spam ${on(cfg.spam.enabled)} · ${cfg.spam.messages} messages in ${cfg.spam.windowSeconds}s · ${cfg.spam.timeoutMinutes}m timeout\n` +
      `@everyone / @here ${on(cfg.everyone.enabled)} · ${cfg.everyone.timeoutMinutes}m timeout\n` +
      `Mass mentions ${on(cfg.mentions.enabled)} · over ${cfg.mentions.maxUsersPerMessage} people or ${cfg.mentions.maxRolesPerMessage} roles · ${cfg.mentions.timeoutMinutes}m timeout\n` +
      `Repeat offences inside ${cfg.repeatLookbackHours}h add time to the timeout`,
  });

  return embed.setFooter({ text: 'Updates live, press Refresh' }).setTimestamp();
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
