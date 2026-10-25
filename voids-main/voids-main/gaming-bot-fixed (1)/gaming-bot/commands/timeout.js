const { MessageFlags } = require('discord.js');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const {
  isMod,
  canModerate,
} = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time a member out')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('time')
        .setDescription('Length')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100000)
    )
    .addStringOption(option =>
      option
        .setName('unit')
        .setDescription('Unit')
        .setRequired(true)
        .addChoices(
          { name: 'Seconds', value: 'seconds' },
          { name: 'Minutes', value: 'minutes' },
          { name: 'Hours', value: 'hours' },
          { name: 'Days', value: 'days' },
          { name: 'Weeks', value: 'weeks' },
          { name: 'Months', value: 'months' }
        )
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason')
        .setRequired(false)
        .setMaxLength(500)
    ),

  async execute(interaction) {

    if (!isMod(interaction.member)) {
      return interaction.reply({
        content: "You can't use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('time');
    const unit = interaction.options.getString('unit');
    const reason =
      interaction.options.getString('reason') ||
      'No reason provided.';

    const member = await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);

    if (!member) {
      return interaction.reply({
        content: 'That member isn\'t in the server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!canModerate(interaction.member, member)) {
      return interaction.reply({
        content:
          "Their role is the same as or above yours.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!member.moderatable) {
      return interaction.reply({
        content:
          "Their role is above mine.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const multipliers = {
      seconds: 1000,
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000,
      weeks: 7 * 24 * 60 * 60 * 1000,
      months: 30 * 24 * 60 * 60 * 1000,
    };

    const duration = amount * multipliers[unit];

    // Discord's maximum timeout is 28 days.
    const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000;

    if (duration > MAX_TIMEOUT) {
      return interaction.reply({
        content:
          'Timeouts max out at **28 days**.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await member.timeout(duration, reason);

    return interaction.reply({
      content:
        `⏳ ${user} was timed out for **${amount} ${unit}**.\n> ${reason}`,
    });
  },
};
