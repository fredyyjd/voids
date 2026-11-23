const { SlashCommandBuilder } = require('discord.js');
const { helpPayload } = require('../utils/help');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('See every command and what it does'),

  async execute(interaction) {
    return interaction.reply(helpPayload('start', interaction.member));
  },
};
