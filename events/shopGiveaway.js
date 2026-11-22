const { MessageFlags } = require('discord.js');
const { handleModal, handlePick } = require('../utils/shopGiveawayFlow');

module.exports = {
  register(client) {
    client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isModalSubmit() && interaction.customId.startsWith('shopgw_start:')) {
          await handleModal(interaction);
          return;
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('shopgw_pick_')) {
          await handlePick(interaction);
        }
      } catch (err) {
        console.error('[shop giveaway] failed:', err);

        const payload = { content: 'Something went wrong. Try again.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
    });
  },
};
