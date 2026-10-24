const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const SAFE_EXPRESSION = /^[0-9+\-*/(). \s]+$/;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('calc')
    .setDescription('Quick calculator')
    .addStringOption((opt) =>
      opt.setName('expression').setDescription('e.g. (5 + 3) * 2').setRequired(true)
    ),

  async execute(interaction) {
    const expression = interaction.options.getString('expression');

    if (!SAFE_EXPRESSION.test(expression)) {
      return interaction.reply({
        content: 'Use numbers and `+ - * / ( )` only.',
        flags: MessageFlags.Ephemeral,
      });
    }

    let result;
    try {
      result = Function(`"use strict"; return (${expression})`)();
    } catch (err) {
      return interaction.reply({ content: "Couldn't work that out.", flags: MessageFlags.Ephemeral });
    }

    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return interaction.reply({ content: 'That isn\'t a valid number.', flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setDescription(`\`${expression}\`\n## = ${result}`)
      .setColor('#2b2d31');

    await interaction.reply({ embeds: [embed] });
  },
};
