const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tos')
    .setDescription('Post the services Terms of Service'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const text = String(config.serviceTos || '').trim();
    if (!text) {
      return interaction.reply({ content: 'No TOS text set (serviceTos in config.json).', flags: MessageFlags.Ephemeral });
    }

    // Plain text, not an embed.
    await interaction.channel.send({ content: text.slice(0, 2000) });
    await interaction.reply({ content: 'TOS posted.', flags: MessageFlags.Ephemeral });
  },
};
