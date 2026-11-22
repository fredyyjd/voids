const { SlashCommandBuilder } = require('discord.js');
const { invPayload } = require('../utils/shop');
const { priv } = require('../utils/box');

module.exports = {
  data: new SlashCommandBuilder().setName('inv').setDescription('See your VB, colours and items').setDMPermission(false),

  async execute(interaction) {
    return interaction.reply(priv(invPayload(interaction.user, interaction.member)));
  },
};
