const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const records = require('../utils/staffRecords');
const points = require('../utils/staffPoints');
const store = require('../utils/staffStore');
const review = require('../utils/staffReview');
const actions = require('../utils/staffActions');
const { COLOR } = require('../utils/theme');

const ephemeral = { flags: MessageFlags.Ephemeral };

function lastReview() {
  return Object.values(store.allReviews())
    .filter((r) => r.status === 'complete')
    .sort((a, b) => b.weekStart - a.weekStart)[0];
}

async function handleReview(interaction) {
  if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const last = Object.values(store.allReviews()).sort((a, b) => b.weekStart - a.weekStart)[0];
    const problems = review.diagnostics(interaction.guild);

    const lines = [
      `Next review: <t:${Math.floor(points.nextResetMs() / 1000)}:R>`,
      `Tracking since: <t:${Math.floor(store.trackingStart() / 1000)}:f>`,
      last
        ? `Last review: week of <t:${Math.floor(last.weekStart / 1000)}:D> - **${last.status}**${last.reason ? ` (${last.reason})` : ''}`
        : 'Last review: none yet',
    ];
    if (last?.report?.error) lines.push(`Report problem: ${last.report.error}`);

    const embed = new EmbedBuilder()
      .setTitle('Staff review status')
      .setColor(COLOR)
      .setDescription(lines.join('\n'))
      .addFields({
        name: 'Setup',
        value: problems.length ? problems.map((p) => `- ${p}`).join('\n').slice(0, 1000) : 'Everything is set up.',
      });
    return interaction.reply({ embeds: [embed], ...ephemeral });
  }

  await interaction.deferReply(ephemeral);

  if (sub === 'run') {
    const ran = await review.tick(interaction.client, Date.now(), { force: true });
    if (!ran) return interaction.editReply('A review is already running, try again in a minute.');

    const last = Object.values(store.allReviews()).sort((a, b) => b.weekStart - a.weekStart)[0];
    if (!last) return interaction.editReply('Nothing to review yet.');
    return interaction.editReply(
      `Latest review (week of <t:${Math.floor(last.weekStart / 1000)}:D>) is **${last.status}**.` +
        (last.reason ? `\n${last.reason}` : '') +
        (last.status === 'complete' ? '\nA finished week is never reviewed twice.' : '')
    );
  }

  if (sub === 'preview') {
    const draft = await review.preview(interaction.guild);
    const parts = review.buildReport(draft);
    parts[0][0].setTitle('Weekly Staff Report (preview, nothing applied)');
    return interaction.editReply({
      content: parts.length > 1 ? `Showing part 1 of ${parts.length}.` : undefined,
      embeds: parts[0],
      allowedMentions: { parse: [] },
    });
  }

  // resend
  const last = lastReview();
  if (!last) return interaction.editReply('There is no finished review to resend.');
  const ok = await review.sendReport(interaction.client, interaction.guild, last, { force: true });
  return interaction.editReply(ok ? 'Report sent again.' : 'I could not reach the report channel.');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Staff points, strikes, warns and the weekly review')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('center').setDescription('Open the staff center'))
    .addSubcommand((sub) =>
      sub.setName('lb').setDescription('Staff points leaderboard (resets every Sunday 12pm)')
    )
    .addSubcommand((sub) =>
      sub.setName('all-time').setDescription('Staff points leaderboard that never resets')
    )
    .addSubcommand((sub) => sub.setName('announce').setDescription('Ping @staff with an announcement'))
    .addSubcommand((sub) =>
      sub
        .setName('activity')
        .setDescription("See this week's tracked activity")
        .addUserOption((o) => o.setName('user').setDescription('Staff member, default you').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('see')
        .setDescription("See a member's staff warns and strikes")
        .addUserOption((o) => o.setName('user').setDescription('Who to look up').setRequired(true))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('review')
        .setDescription('The weekly staff review')
        .addSubcommand((s) => s.setName('status').setDescription('When the next review runs and what is set up'))
        .addSubcommand((s) => s.setName('run').setDescription('Run the review that is due, if it has not run yet'))
        .addSubcommand((s) => s.setName('preview').setDescription('Preview this week so far, nothing is applied'))
        .addSubcommand((s) => s.setName('resend').setDescription('Send the last weekly report again'))
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommandGroup(false) === 'review') return handleReview(interaction);

    const sub = interaction.options.getSubcommand();

    if (sub === 'center') return require('../utils/staffCenter').open(interaction);
    if (sub === 'announce') return require('../utils/staffAnnounce').openForm(interaction);

    if (sub === 'lb' || sub === 'all-time') {
      if (!points.isStaffMember(interaction.member)) return fail(interaction, NO_PERMS);
      return interaction.reply(points.buildBoard(sub === 'lb' ? 'weekly' : 'alltime', 'points'));
    }

    if (!points.isStaffMember(interaction.member)) return fail(interaction, NO_PERMS);

    const who = interaction.options.getUser('user') || interaction.user;
    if (sub === 'activity' && who.id !== interaction.user.id && !hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);
    if (who.bot) return fail(interaction, "You can't use that on a bot.");

    const member = await interaction.guild.members.fetch(who.id).catch(() => null);

    if (sub === 'activity') {
      return interaction.reply({ embeds: [actions.activityEmbed(who, member)], ...ephemeral });
    }

    const rec = records.getRecord(who.id);
    const hadAnything = rec.warns.length || rec.strikes.length;
    if (!points.isStaffMember(member) && !hadAnything) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLOR).setDescription(`${who} doesn't have a staff role.`)],
        ...ephemeral,
      });
    }

    return interaction.reply({ embeds: [actions.lookupEmbed(who, member)], ...ephemeral });
  },
};
