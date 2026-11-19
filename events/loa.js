const { MessageFlags } = require('discord.js');
const { handleDecision, checkExpired } = require('../utils/loaManager');

// Accept / Deny buttons on LOA requests, plus a timer that ends LOAs when time is up.
module.exports = {
  register(client) {
    client.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('loa_accept:') && !interaction.customId.startsWith('loa_deny:')) return;
        await handleDecision(interaction);
      } catch (err) {
        console.error('[loa] button failed:', err);

        const payload = { content: 'Something went wrong. Try again.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
    });

    const tick = () => checkExpired(client).catch((err) => console.error('[loa] expiry check failed:', err));

    setTimeout(tick, 20 * 1000).unref();
    setInterval(tick, 60 * 1000).unref();
  },
};
