const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config.json');
const extra = require('../extraConfig');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const records = require('../utils/staffRecords');
const points = require('../utils/staffPoints');
const activity = require('../utils/activityCheck');
const cfg = require('../utils/staffConfig');
const store = require('../utils/staffStore');
const scoring = require('../utils/staffScoring');
const review = require('../utils/staffReview');
const { hasBypassRole } = require('../utils/staffBypass');

const settings = extra.staff;

const RED = 0xed4245;
const YELLOW = 0xfee75c;
const BLUE = 0x3b82f6;

const isSet = cfg.isSet;
const progress = (done, total) => `${done}/${total}`;
const ephemeral = { flags: MessageFlags.Ephemeral };

async function sendStaffLog(guild, payload) {
  // Strikes and warns go to the activity check strike channel (unless a channel is set in extraConfig).
  const id = isSet(settings.logChannelId)
    ? settings.logChannelId
    : isSet(activity.WARN_CHANNEL_ID)
      ? activity.WARN_CHANNEL_ID
      : config.modLogChannelId;
  if (!isSet(id)) return;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel && channel.isTextBased()) await channel.send(payload).catch(() => {});
}

function alertRoles() {
  const roles = (settings.alertRoleIds && settings.alertRoleIds.length ? settings.alertRoleIds : config.adminRoleIds) || [];
  return roles.filter(isSet);
}

// Tells management when someone reached the demotion line.
async function demotionAlert(guild, target, strikes) {
  const roles = alertRoles();
  const embed = new EmbedBuilder()
    .setTitle('Demotion queued')
    .setColor(RED)
    .setDescription(
      `${target} has **${strikes} valid strikes** (demotion line is ${records.STRIKES_FOR_DEMOTION}).\n` +
        `They will be demoted one rank by the weekly staff review <t:${Math.floor(points.nextResetMs() / 1000)}:R>.`
    )
    .setTimestamp();
  await sendStaffLog(guild, {
    content: roles.length ? roles.map((r) => `<@&${r}>`).join(' ') : undefined,
    embeds: [embed],
    allowedMentions: { roles },
  });
}

const dm = (user, text) => user.send(text).catch(() => {});

function statusOf(entry) {
  if (entry.consumedBy) return 'used for a demotion';
  if (!records.isValid(entry)) return 'expired';
  return 'valid';
}

function historyLines(list, withStatus = false) {
  if (!list.length) return '*None*';
  return list
    .slice(-5)
    .map((e) => {
      const tag = withStatus ? ` [${statusOf(e)}]` : '';
      const evidence = e.evidence ? ` · evidence: ${String(e.evidence).slice(0, 120)}` : '';
      return `<t:${Math.floor(e.at / 1000)}:d>${tag} - ${String(e.reason).slice(0, 150)} *(by <@${e.by}>)*${evidence}`.slice(0, 400);
    })
    .join('\n');
}

function recordEmbed(user, rec) {
  const valid = rec.strikes.filter((s) => records.isValid(s)).length;
  return new EmbedBuilder()
    .setTitle(`Staff record - ${user.username}`)
    .setColor(BLUE)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: `Warns ${progress(rec.warns.length, records.WARNS_PER_STRIKE)}`, value: historyLines(rec.warns) },
      { name: `Strikes ${progress(valid, records.STRIKES_FOR_DEMOTION)} valid`, value: historyLines(rec.strikes, true) }
    );
}

function activityEmbed(user, member) {
  const week = store.weekKey();
  const stats = store.weekStats(week, user.id);
  const days = store.activeDays(stats);
  const result = scoring.scoreWeek(stats, days);
  const history = store.getHistory(user.id).slice(-4);
  const exempt = hasBypassRole(member);

  return new EmbedBuilder()
    .setTitle(`Activity this week - ${user.username}`)
    .setColor(BLUE)
    .setDescription(
      (exempt ? '🛡️ **Exempt** from automatic promotion, demotion, strikes and timeouts.\n\n' : '') +
        `Eligible messages **${stats.msgs}** · Active days **${days}**\n` +
        `Tickets **${stats.handled}** handled / **${stats.closed}** closed\n` +
        `Giveaways **${stats.giveaways}** · Schematics **${stats.schematics}** · Duties **${stats.mod + stats.events}**\n` +
        `Score so far **${result.score}**${result.strong ? ' (strong)' : ''}`
    )
    .addFields({
      name: 'Last reviews',
      value: history.length
        ? history.map((h) => `${h.loa ? 'LOA' : h.score}${h.strong ? ' (strong)' : ''} as ${review.labelOf(h.rank)}`).join('\n')
        : '*No reviews yet*',
    })
    .setFooter({ text: 'Resets with the staff points week' });
}

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
      .setColor(BLUE)
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
    .addSubcommand((sub) =>
      sub.setName('lb').setDescription('Staff points leaderboard (resets every Sunday 12pm)')
    )
    .addSubcommand((sub) =>
      sub.setName('all-time').setDescription('Staff points leaderboard that never resets')
    )
    .addSubcommand((sub) =>
      sub
        .setName('activity')
        .setDescription("See this week's tracked activity")
        .addUserOption((o) => o.setName('user').setDescription('Staff member (admins only, default you)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('see')
        .setDescription("See a member's staff warns and strikes")
        .addUserOption((o) => o.setName('user').setDescription('Who to look up').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-warn')
        .setDescription('Remove the latest staff warn(s) from someone')
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('amount').setDescription('How many to remove (default 1)').setMinValue(1).setMaxValue(10).setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-strike')
        .setDescription('Remove the latest staff strike(s) from someone')
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('amount').setDescription('How many to remove (default 1)').setMinValue(1).setMaxValue(10).setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('strike')
        .setDescription('Give a staff member a strike (2 valid strikes = demotion at the weekly review)')
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500))
        .addStringOption((o) =>
          o.setName('evidence').setDescription('Message link or short reference').setRequired(false).setMaxLength(300)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('warn')
        .setDescription('Warn a staff member (3 warns = 1 strike)')
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500))
        .addStringOption((o) =>
          o.setName('evidence').setDescription('Message link or short reference').setRequired(false).setMaxLength(300)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription("See a staff member's warns and strikes")
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription("Clear a staff member's warns and strikes")
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('review')
        .setDescription('The weekly staff review (admins only)')
        .addSubcommand((s) => s.setName('status').setDescription('When the next review runs and what is set up'))
        .addSubcommand((s) => s.setName('run').setDescription('Run the review that is due, if it has not run yet'))
        .addSubcommand((s) => s.setName('preview').setDescription('Preview this week so far, nothing is applied'))
        .addSubcommand((s) => s.setName('resend').setDescription('Send the last weekly report again'))
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommandGroup(false) === 'review') return handleReview(interaction);

    const sub = interaction.options.getSubcommand();

    // The leaderboards are for any staff member.
    if (sub === 'lb' || sub === 'all-time') {
      if (!points.isStaffMember(interaction.member)) return fail(interaction, NO_PERMS);
      return interaction.reply(points.buildBoard(sub === 'lb' ? 'weekly' : 'alltime', 'points'));
    }

    if (sub === 'activity') {
      if (!points.isStaffMember(interaction.member)) return fail(interaction, NO_PERMS);

      const who = interaction.options.getUser('user') || interaction.user;
      if (who.id !== interaction.user.id && !hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);
      if (who.bot) return fail(interaction, "You can't use that on a bot.");

      const member = await interaction.guild.members.fetch(who.id).catch(() => null);
      return interaction.reply({ embeds: [activityEmbed(who, member)], ...ephemeral });
    }

    // /staff see: any staff member can look someone up.
    if (sub === 'see') {
      if (!points.isStaffMember(interaction.member)) return fail(interaction, NO_PERMS);

      const who = interaction.options.getUser('user', true);
      if (who.bot) return fail(interaction, "You can't use that on a bot.");

      const member = await interaction.guild.members.fetch(who.id).catch(() => null);
      const missed = activity.getMissed(who.id);
      const rec = records.getRecord(who.id);
      const hadAnything = rec.warns.length || rec.strikes.length || missed;

      // Only people with a staff role have a staff record.
      if (!points.isStaffMember(member) && !hadAnything) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(BLUE).setDescription(`${who} doesn't have a staff role.`)],
          ...ephemeral,
        });
      }

      const embed = recordEmbed(who, rec).addFields({
        name: 'Activity checks missed',
        value: missed
          ? `**${missed}** missed (${Math.min(missed, 3)} warning${Math.min(missed, 3) === 1 ? '' : 's'}, ${activity.strikesFor(missed)} strike${activity.strikesFor(missed) === 1 ? '' : 's'})`
          : '*None*',
      });
      if (hasBypassRole(member)) embed.setFooter({ text: 'Exempt from automatic staff management' });
      return interaction.reply({ embeds: [embed], ...ephemeral });
    }

    // Strikes, warns, view and reset: max perms only (Administrator).
    if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);
    const target = interaction.options.getUser('user', true);

    if (target.bot) return fail(interaction, "You can't use that on a bot.");

    if (sub === 'view') return interaction.reply({ embeds: [recordEmbed(target, records.getRecord(target.id))], ...ephemeral });

    if (sub === 'reset') {
      records.resetRecord(target.id);
      await sendStaffLog(interaction.guild, {
        embeds: [
          new EmbedBuilder()
            .setTitle('Staff record reset')
            .setColor(BLUE)
            .setDescription(`${target}'s warns and strikes were cleared by ${interaction.user}.`)
            .setTimestamp(),
        ],
        allowedMentions: { parse: [] },
      });
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(BLUE).setDescription(`Cleared all warns and strikes for ${target}.`)],
        ...ephemeral,
      });
    }

    if (target.id === interaction.user.id) return fail(interaction, "You can't use that on yourself.");

    if (sub === 'remove-warn' || sub === 'remove-strike') {
      const amount = interaction.options.getInteger('amount') || 1;
      const isWarn = sub === 'remove-warn';
      const result = isWarn ? records.removeWarn(target.id, amount) : records.removeStrike(target.id, amount);
      const noun = isWarn ? 'warn' : 'strike';

      if (!result.removed) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(BLUE).setDescription(`${target} has no ${noun}s to remove.`)],
          ...ephemeral,
        });
      }

      await sendStaffLog(interaction.guild, {
        embeds: [
          new EmbedBuilder()
            .setTitle(isWarn ? 'Staff Warn Removed' : 'Staff Strike Removed')
            .setColor(BLUE)
            .addFields(
              { name: 'Staff member', value: `${target}`, inline: true },
              { name: 'By', value: `${interaction.user}`, inline: true },
              { name: 'Removed', value: `${result.removed}`, inline: true },
              {
                name: 'Now',
                value: `Warns ${progress(result.warns, records.WARNS_PER_STRIKE)} · Valid strikes ${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}`,
              }
            )
            .setTimestamp(),
        ],
        allowedMentions: { parse: [] },
      });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BLUE)
            .setDescription(
              `Removed ${result.removed} ${noun}${result.removed === 1 ? '' : 's'} from ${target}. ` +
                `Warns: **${progress(result.warns, records.WARNS_PER_STRIKE)}** · Valid strikes: **${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}**`
            ),
        ],
        ...ephemeral,
      });
    }

    // Strike and warn: bypass-role holders are exempt from both.
    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (hasBypassRole(targetMember)) {
      return fail(interaction, `${target.username} holds a management bypass role and is exempt from staff warns and strikes.`);
    }

    const reason = interaction.options.getString('reason', true);
    const evidence = interaction.options.getString('evidence') || null;
    const evidenceField = evidence ? [{ name: 'Evidence', value: evidence.slice(0, 1000) }] : [];

    if (sub === 'strike') {
      const result = records.addStrike(target.id, reason, interaction.user.id, { evidence });

      await dm(
        target,
        `You received a **staff strike** in **${interaction.guild.name}**.\n` +
          `Reason: ${reason}\nValid strikes: ${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}` +
          (result.strikes >= records.STRIKES_FOR_DEMOTION ? '\nYou reached the demotion line, you will be demoted at the next weekly review.' : '')
      );

      await sendStaffLog(interaction.guild, {
        embeds: [
          new EmbedBuilder()
            .setTitle('Staff Strike')
            .setColor(RED)
            .addFields(
              { name: 'Staff member', value: `${target}`, inline: true },
              { name: 'By', value: `${interaction.user}`, inline: true },
              { name: 'Valid strikes', value: progress(result.strikes, records.STRIKES_FOR_DEMOTION), inline: true },
              { name: 'Reason', value: reason },
              ...evidenceField,
              { name: 'Strike ID', value: `\`${result.strike.id}\`` }
            )
            .setTimestamp(),
        ],
        allowedMentions: { parse: [] },
      });

      if (result.strikes >= records.STRIKES_FOR_DEMOTION) await demotionAlert(interaction.guild, target, result.strikes);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(RED)
            .setDescription(
              `Struck ${target}. Valid strikes: **${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}**` +
                (result.strikes >= records.STRIKES_FOR_DEMOTION ? '\nThey are at the demotion line, management was alerted.' : '')
            ),
        ],
        ...ephemeral,
      });
    }

    // warn
    const result = records.addWarn(target.id, reason, interaction.user.id, { evidence });

    await dm(
      target,
      `You received a **staff warning** in **${interaction.guild.name}**.\n` +
        `Reason: ${reason}\n` +
        (result.autoStrike
          ? `That was warning ${records.WARNS_PER_STRIKE}, so it turned into a **strike** (${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}).`
          : `Warns: ${progress(result.warns, records.WARNS_PER_STRIKE)}`)
    );

    await sendStaffLog(interaction.guild, {
      embeds: [
        new EmbedBuilder()
          .setTitle(result.autoStrike ? 'Staff Warn -> Strike' : 'Staff Warn')
          .setColor(result.autoStrike ? RED : YELLOW)
          .addFields(
            { name: 'Staff member', value: `${target}`, inline: true },
            { name: 'By', value: `${interaction.user}`, inline: true },
            {
              name: result.autoStrike ? 'Valid strikes' : 'Warns',
              value: result.autoStrike
                ? progress(result.strikes, records.STRIKES_FOR_DEMOTION)
                : progress(result.warns, records.WARNS_PER_STRIKE),
              inline: true,
            },
            { name: 'Reason', value: reason },
            ...evidenceField
          )
          .setTimestamp(),
      ],
      allowedMentions: { parse: [] },
    });

    if (result.autoStrike && result.strikes >= records.STRIKES_FOR_DEMOTION) {
      await demotionAlert(interaction.guild, target, result.strikes);
    }

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(result.autoStrike ? RED : YELLOW)
          .setDescription(
            result.autoStrike
              ? `Warned ${target}. That was warn ${records.WARNS_PER_STRIKE}, so it became a **strike** (${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}).` +
                  (result.strikes >= records.STRIKES_FOR_DEMOTION ? '\nThey are at the demotion line, management was alerted.' : '')
              : `Warned ${target}. Warns: **${progress(result.warns, records.WARNS_PER_STRIKE)}**`
          ),
      ],
      ...ephemeral,
    });
  },
};
