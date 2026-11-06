const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { isMod, canModerate } = require('../utils/permissions');
const { logModAction } = require('../utils/modLog');
const { recordAction } = require('../utils/antiNuke');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Who to kick')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isMod(interaction.member)) {
      return interaction.reply({
        content: "You can't use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (!member) {
      return interaction.reply({
        content: 'That member isn\'t in the server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Mod role hierarchy check
    if (!canModerate(interaction.member, member)) {
      return interaction.reply({
        content:
          "Their role is the same as or above yours.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Bot hierarchy check
    if (!member.kickable) {
      return interaction.reply({
        content:
          "Their role is above mine.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await target
      .send(
        `You have been kicked from **${interaction.guild.name}**.\n` +
        `Reason: ${reason || 'No reason provided'}`
      )
      .catch(() => {});

    try {
      await member.kick(reason || undefined);
    } catch (err) {
      console.error('Kick error:', err);

      return interaction.reply({
        content: "Couldn't kick that member.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply({
      content: `👢 ${target} was kicked.`,
    });

    recordAction(interaction.guild, interaction.user.id, 'kick').catch(() => {});

    await logModAction(interaction.guild, {
      action: 'Kick',
      moderator: interaction.user,
      target,
      reason,
    });
  },
};
