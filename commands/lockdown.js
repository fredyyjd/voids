const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { isMod } = require('../utils/permissions');
const { logModAction } = require('../utils/modLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock or unlock this channel')
    .addSubcommand((sub) => sub.setName('lock').setDescription('Lock this channel'))
    .addSubcommand((sub) => sub.setName('unlock').setDescription('Unlock this channel')),

  async execute(interaction) {
    if (!isMod(interaction.member)) {
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    const everyoneRole = interaction.guild.roles.everyone;

    if (sub === 'lock') {
      await interaction.channel.permissionOverwrites.edit(everyoneRole, { SendMessages: false });
      await interaction.reply('🔒 Channel locked.');
      await logModAction(interaction.guild, {
        action: 'Channel Locked',
        moderator: interaction.user,
        target: interaction.user,
        reason: `#${interaction.channel.name}`,
      });
      return;
    }

    if (sub === 'unlock') {
      await interaction.channel.permissionOverwrites.edit(everyoneRole, { SendMessages: null });
      await interaction.reply('🔓 Channel unlocked.');
      await logModAction(interaction.guild, {
        action: 'Channel Unlocked',
        moderator: interaction.user,
        target: interaction.user,
        reason: `#${interaction.channel.name}`,
      });
      return;
    }
  },
};
