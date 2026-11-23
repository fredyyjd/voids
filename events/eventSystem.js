const { MessageFlags } = require('discord.js');
const engine = require('../utils/eventEngine');
const flow = require('../utils/eventFlow');

// Handles every `ev:` button, menu and form for /event, and resumes running
// events after a restart. Existing interaction handling is left untouched.
module.exports = {
  register(client) {
    client.once('ready', () => {
      try {
        engine.recover(client);
      } catch (err) {
        console.error('[events] recover failed', err);
      }
    });

    client.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.customId || !interaction.customId.startsWith('ev:')) return;
        if (!interaction.guildId) return;

        if (await flow.handle(interaction)) return;
        await engine.handle(interaction);
      } catch (err) {
        console.error('[events] interaction failed', err);
        const payload = { content: 'Something went wrong with that event action.', flags: MessageFlags.Ephemeral };
        try {
          if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
          else await interaction.reply(payload);
        } catch (_) {}
      }
    });
  },
};
