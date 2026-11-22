const { MessageFlags } = require('discord.js');
const { answerCloseRequest } = require('../utils/ticketManager');

// Close / Deny buttons on a "has the ticket been solved?" request.
module.exports = {
  register(client) {
    client.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.isButton() || !interaction.customId.startsWith('closereq_')) return;
        await answerCloseRequest(interaction);
      } catch (err) {
        console.error('[close request] failed:', err);

        const payload = { content: 'Something went wrong. Try again.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
    });
  },
};
