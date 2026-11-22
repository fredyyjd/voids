const { SlashCommandBuilder } = require('discord.js');
const { shopPayload } = require('../utils/shop');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('item')
    .setDescription('Spend your VB')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('shop').setDescription('Open the item shop')),

  async execute(interaction) {
    return interaction.reply(shopPayload());
  },
};
