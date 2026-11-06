const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const extra = require('../extraConfig');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const records = require('../utils/staffRecords');
const points = require('../utils/staffPoints');
const activity = require('../utils/activityCheck');
const { MessageFlags } = require('discord.js');

const cfg = extra.staff;

const RED = 0xed4245;
const YELLOW = 0xfee75c;
const BLUE = 0x3b82f6;

function isSet(id) {
  return id && !String(id).startsWith('PUT_');
}

async function sendStaffLog(guild, payload) {
  // Strikes and warns go to the activity check strike channel (unless a channel is set in extraConfig).
  const id = isSet(cfg.logChannelId)
    ? cfg.logChannelId
    : isSet(activity.WARN_CHANNEL_ID)
      ? activity.WARN_CHANNEL_ID
      : config.modLogChannelId;
  if (!isSet(id)) return;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel && channel.isTextBased()) await channel.send(payload).catch(() => {});
}

function alertRoles() {
  const roles = (cfg.alertRoleIds && cfg.alertRoleIds.length ? cfg.alertRoleIds : config.adminRoleIds) || [];
  return roles.filter(isSet);
}

function progress(done, total) {
  return `${done}/${total}`;
}

// Tells management when someone is at the demotion line.
async function demotionAlert(guild, target, strikes) {
  const roles = alertRoles();
  const embed = new EmbedBuilder()
    .setTitle('Demotion needed')
    .setColor(RED)
    .setDescription(
      `${target} has **${strikes} strikes** (demotion line is ${records.STRIKES_FOR_DEMOTION}).\n` +
        'Demotions are done manually - please handle this.'
    )
    .setTimestamp();
  await sendStaffLog(guild, {
    content: roles.length ? roles.map((r) => `<@&${r}>`).join(' ') : undefined,
    embeds: [embed],
    allowedMentions: { roles },
  });
}

async function dm(user, text) {
  await user.send(text).catch(() => {});
}

function historyLines(list) {
  if (!list.length) return '*None*';
  return list
    .slice(-5)
    .map((e) => `<t:${Math.floor(e.at / 1000)}:d> - ${String(e.reason).slice(0, 150)} *(by <@${e.by}>)*`)
    .join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Staff points, strikes and warns')
    .addSubcommand((sub) =>
      sub.setName('lb').setDescription('Staff points leaderboard (resets every Sunday 12pm)')
    )
    .addSubcommand((sub) =>
      sub.setName('all-time').setDescription('Staff points leaderboard that never resets')
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
        .setDescription('Give a staff member a strike')
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500))
    )
    .addSubcommand((sub) =>
      sub
        .setName('warn')
        .setDescription('Warn a staff member (3 warns = 1 strike)')
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500))
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
        .setDescription("Clear a staff member's warns and strikes (after a demotion)")
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // The leaderboards are for any staff member.
    if (sub === 'lb' || sub === 'all-time') {
      if (!points.isStaffMember(interaction.member)) return fail(interaction, NO_PERMS);
      return interaction.reply(points.buildBoard(sub === 'lb' ? 'weekly' : 'alltime', 'points'));
    }

    // /staff see: any staff member can look someone up.
    if (sub === 'see') {
      if (!points.isStaffMember(interaction.member)) return fail(interaction, NO_PERMS);

      const who = interaction.options.getUser('user', true);
      if (who.bot) return fail(interaction, "You can't use that on a bot.");

      const member = await interaction.guild.members.fetch(who.id).catch(() => null);
      const missed = activity.getMissed(who.id);
      const hasRecord = records.getRecord(who.id);
      const hadAnything = hasRecord.warns.length || hasRecord.strikes.length || missed;

      // Only people with a staff role have a staff record.
      if (!points.isStaffMember(member) && !hadAnything) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(BLUE).setDescription(`${who} doesn't have a staff role.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const rec = hasRecord;
      const embed = new EmbedBuilder()
        .setTitle(`Staff record - ${who.username}`)
        .setColor(BLUE)
        .setThumbnail(who.displayAvatarURL())
        .addFields(
          { name: `Warns ${progress(rec.warns.length, records.WARNS_PER_STRIKE)}`, value: historyLines(rec.warns) },
          { name: `Strikes ${progress(rec.strikes.length, records.STRIKES_FOR_DEMOTION)}`, value: historyLines(rec.strikes) },
          {
            name: 'Activity checks missed',
            value: missed
              ? `**${missed}** missed (${Math.min(missed, 3)} warning${Math.min(missed, 3) === 1 ? '' : 's'}, ${activity.strikesFor(missed)} strike${activity.strikesFor(missed) === 1 ? '' : 's'})`
              : '*None*',
          }
        );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // Strikes, warns, view and reset: max perms only (Administrator).
    if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);
    const target = interaction.options.getUser('user', true);

    if (target.bot) return fail(interaction, "You can't use that on a bot.");

    if (sub === 'view') {
      const rec = records.getRecord(target.id);
      const embed = new EmbedBuilder()
        .setTitle(`Staff record - ${target.username}`)
        .setColor(BLUE)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: `Warns ${progress(rec.warns.length, records.WARNS_PER_STRIKE)}`, value: historyLines(rec.warns) },
          { name: `Strikes ${progress(rec.strikes.length, records.STRIKES_FOR_DEMOTION)}`, value: historyLines(rec.strikes) }
        );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

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
        flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
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
                value: `Warns ${progress(result.warns, records.WARNS_PER_STRIKE)} · Strikes ${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}`,
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
                `Warns: **${progress(result.warns, records.WARNS_PER_STRIKE)}** · Strikes: **${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}**`
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const reason = interaction.options.getString('reason', true);

    if (sub === 'strike') {
      const result = records.addStrike(target.id, reason, interaction.user.id);

      await dm(
        target,
        `You received a **staff strike** in **${interaction.guild.name}**.\n` +
          `Reason: ${reason}\nStrikes: ${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}` +
          (result.strikes >= records.STRIKES_FOR_DEMOTION ? '\nYou have reached the demotion line, management will follow up.' : '')
      );

      await sendStaffLog(interaction.guild, {
        embeds: [
          new EmbedBuilder()
            .setTitle('Staff Strike')
            .setColor(RED)
            .addFields(
              { name: 'Staff member', value: `${target}`, inline: true },
              { name: 'By', value: `${interaction.user}`, inline: true },
              { name: 'Strikes', value: progress(result.strikes, records.STRIKES_FOR_DEMOTION), inline: true },
              { name: 'Reason', value: reason }
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
              `Struck ${target}. Strikes: **${progress(result.strikes, records.STRIKES_FOR_DEMOTION)}**` +
                (result.strikes >= records.STRIKES_FOR_DEMOTION ? '\nThey are at the demotion line, management was alerted.' : '')
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // warn
    const result = records.addWarn(target.id, reason, interaction.user.id);

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
              name: result.autoStrike ? 'Strikes' : 'Warns',
              value: result.autoStrike
                ? progress(result.strikes, records.STRIKES_FOR_DEMOTION)
                : progress(result.warns, records.WARNS_PER_STRIKE),
              inline: true,
            },
            { name: 'Reason', value: reason }
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
      flags: MessageFlags.Ephemeral,
    });
  },
};
