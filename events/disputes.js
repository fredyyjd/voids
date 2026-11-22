const { MessageFlags } = require('discord.js');
const { handle } = require('../utils/disputes');

// "Contact higher ups" button in the auto mod DM, the dropdowns, the staff
// "Message back" button and the replies back and forth.
module.exports = {
  register(client) {
    client.on('interactionCreate', async (interaction) => {
      try {
        await handle(interaction);
      } catch (err) {
        console.error('[disputes] failed:', err);
        const payload = { content: 'Something went wrong. Try again.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
        else if (interaction.isRepliable?.()) await interaction.reply(payload).catch(() => {});
      }
    });
  },
};
