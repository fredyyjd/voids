const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { invPayload } = require('../utils/shop');

module.exports = {
  data: new SlashCommandBuilder().setName('inv').setDescription('See your VB, colours and items').setDMPermission(false),

  async execute(interaction) {
    return interaction.reply({
      ...invPayload(interaction.user, interaction.member),
      flags: MessageFlags.Ephemeral,
    });
  },
};
