const { SlashCommandBuilder } = require('discord.js');
const { fail, NO_PERMS } = require('../utils/reply');
const { canRequest, startRequest } = require('../utils/requestPing');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('request')
    .setDescription('Staff requests')
    .addSubcommand((sub) => sub.setName('ping').setDescription('Request a ping')),

  async execute(interaction) {
    if (!canRequest(interaction.member)) return fail(interaction, NO_PERMS);
    return startRequest(interaction);
  },
};
