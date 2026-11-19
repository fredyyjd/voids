const { SlashCommandBuilder } = require('discord.js');
const extra = require('../extraConfig');
const { submitRequest } = require('../utils/loaManager');

const MAX_DAYS = (extra.loa || {}).maxDays || 30;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loa')
    .setDescription('Leave of absence')
    .addSubcommand((s) =>
      s
        .setName('request')
        .setDescription('Ask to go on LOA')
        .addIntegerOption((o) =>
          o
            .setName('days')
            .setDescription(`How many days (max ${MAX_DAYS})`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(MAX_DAYS)
        )
        .addStringOption((o) =>
          o.setName('reason').setDescription('Why you need it').setRequired(true).setMinLength(3).setMaxLength(500)
        )
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'request') {
      await submitRequest(interaction);
    }
  },
};
