const { MessageFlags } = require('discord.js');
const { handle } = require('../utils/shopCenter');

module.exports = {
  register(client) {
    client.on('interactionCreate', async (interaction) => {
      const id = interaction.customId;
      if (typeof id !== 'string' || !id.startsWith('sc_')) return;

      try {
        await handle(interaction);
      } catch (err) {
        console.error('[shop center] failed:', err);

        const payload = { content: 'Something went wrong. Try again.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
    });
  },
};
