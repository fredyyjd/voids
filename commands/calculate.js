const { SlashCommandBuilder } = require('discord.js');
const { pickerPayload } = require('../utils/calc');

// Just run /calc, then pick Normal or Cool. Everything it sends can be seen by
// the whole channel, but only the person who ran /calc can press the buttons.
module.exports = {
  data: new SlashCommandBuilder().setName('calc').setDescription('Open a calculator'),

  async execute(interaction) {
    return interaction.reply(pickerPayload());
  },
};
