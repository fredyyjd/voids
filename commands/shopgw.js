const { SlashCommandBuilder } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const { prizeChoices, buildModal } = require('../utils/shopGiveawayFlow');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Economy tools')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('giveaway')
        .setDescription('Giveaway VB (Void Bucks) or shop items (max perms only)')
        .addStringOption((o) =>
          o
            .setName('prize')
            .setDescription('What the winners get')
            .setRequired(true)
            .addChoices(...prizeChoices())
        )
    ),

  async execute(interaction) {
    if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

    return interaction.showModal(buildModal(interaction.options.getString('prize')));
  },
};
