const { SlashCommandBuilder } = require('discord.js');
const { closeTicket } = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close this ticket')
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Why it\'s closing').setRequired(false)
    ),

  async execute(interaction) {
    const reason = interaction.options.getString('reason');
    await closeTicket(interaction, reason);
  },
};
