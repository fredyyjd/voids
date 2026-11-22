const { SlashCommandBuilder } = require('discord.js');
const { evaluate, CalcError, pickerPayload, resultPayload } = require('../utils/calc');
const { fail } = require('../utils/reply');
const { priv } = require('../utils/box');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('calc')
    .setDescription('Calculator')
    .addStringOption((opt) =>
      opt.setName('expression').setDescription('e.g. (5 + 3) * 2').setRequired(false)
    ),

  async execute(interaction) {
    const expression = interaction.options.getString('expression');

    // No sum typed: pick normal calc or cool calc.
    if (!expression) return interaction.reply(priv(pickerPayload()));

    try {
      return await interaction.reply(resultPayload(expression, evaluate(expression)));
    } catch (err) {
      return fail(interaction, err instanceof CalcError ? err.message : "Couldn't work that out.");
    }
  },
};
