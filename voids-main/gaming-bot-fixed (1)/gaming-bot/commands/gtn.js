const { SlashCommandBuilder } = require('discord.js');
const { guessNumber } = require('../utils/games');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gtn')
    .setDescription('Guess the number. Anyone can start one')
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt
        .setName('max')
        .setDescription('Highest possible number (10 to 300)')
        .setMinValue(10)
        .setMaxValue(300)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('prize').setDescription('Prize for the winner, e.g. 5m (max perms only)').setMaxLength(100).setRequired(false)
    ),

  async execute(interaction) {
    await guessNumber(interaction, interaction.options.getInteger('max'));
  },
};
