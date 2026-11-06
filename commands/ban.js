const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { isAdminRole } = require('../utils/permissions');
const { logModAction } = require('../utils/modLog');
const { recordAction } = require('../utils/antiNuke');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Who to ban')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason')
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('delete_days')
        .setDescription('Days of messages to delete (0-7)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(7)
    ),

  async execute(interaction) {
    // Only the Admin role can use /ban (Administrator permission alone is not enough)
    if (!isAdminRole(interaction.member)) {
      return interaction.reply({
        content: 'Only the Admin role can ban.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const deleteDays =
      interaction.options.getInteger('delete_days') || 0;

    await target
      .send(
        `You have been banned from **${interaction.guild.name}**.\nReason: ${
          reason || 'No reason provided'
        }`
      )
      .catch(() => {});

    try {
      await interaction.guild.members.ban(target.id, {
        reason: reason || undefined,
        deleteMessageSeconds: deleteDays * 24 * 60 * 60,
      });
    } catch (err) {
      return interaction.reply({
        content:
          "Couldn't ban them. Their role may be above mine.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply(`🔨 ${target} was banned.`);

    recordAction(interaction.guild, interaction.user.id, 'ban').catch(() => {});

    await logModAction(interaction.guild, {
      action: 'Ban',
      moderator: interaction.user,
      target,
      reason,
    });
  },
};
