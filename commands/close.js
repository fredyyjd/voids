const { SlashCommandBuilder } = require('discord.js');
const { closeTicket } = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close this ticket')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Ask the owner or close it now')
        .setRequired(true)
        .addChoices(
          { name: 'Request (ask the owner first)', value: 'request' },
          { name: 'Force close (close it now)', value: 'force' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Why it\'s closing').setRequired(false)
    ),

  async execute(interaction) {
    const reason = interaction.options.getString('reason');
    const force = interaction.options.getString('mode') === 'force';
    await closeTicket(interaction, reason, { force });
  },
};
