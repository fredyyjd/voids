const { MessageFlags } = require('discord.js');
const { submit } = require('../utils/staffAnnounce');

// Submit handler for the /staff announce form.
module.exports = {
  register(client) {
    client.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.isModalSubmit() || !interaction.customId.startsWith('staff_announce:')) return;
        await submit(interaction);
      } catch (err) {
        console.error('[staff announce] failed:', err);
        const payload = { content: 'Something went wrong. Try again.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
    });
  },
};
