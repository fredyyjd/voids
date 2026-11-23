const { SlashCommandBuilder } = require('discord.js');
const { shopPayload } = require('../utils/shop');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const { prizeChoices, buildModal } = require('../utils/shopGiveawayFlow');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('item')
    .setDescription('Spend your VB')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('shop').setDescription('Open the item shop'))
    .addSubcommand((sub) =>
      sub
        .setName('giveaway')
        .setDescription('Giveaway VB or shop items')
        .addStringOption((o) =>
          o
            .setName('prize')
            .setDescription('What the winners get')
            .setRequired(true)
            .addChoices(...prizeChoices())
        )
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'giveaway') {
      if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

      return interaction.showModal(buildModal(interaction.options.getString('prize')));
    }

    return interaction.reply(shopPayload());
  },
};
