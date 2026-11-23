const { SlashCommandBuilder } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const { homePayload } = require('../utils/shopCenter');
const { priv } = require('../utils/box');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Shop tools')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('center').setDescription('Give items, run sales and specials, add or remove shop items')),

  async execute(interaction) {
    if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

    return interaction.reply(priv(homePayload()));
  },
};
