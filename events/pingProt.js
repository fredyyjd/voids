const { MessageFlags } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const pingProt = require('../utils/pingProt');

// The remove buttons under the /ping prot panel.
module.exports = {
  name: 'pingProtPanel',

  register(client) {
    client.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.isButton()) return;
        const match = /^pprot_rm:(r|u):(\d+)$/.exec(interaction.customId);
        if (!match) return;

        if (!hasMaxPerms(interaction.member)) {
          return interaction.reply({ content: "You can't use this.", flags: MessageFlags.Ephemeral });
        }

        pingProt.remove(match[1] === 'r' ? 'role' : 'user', match[2]);
        await interaction.update(await pingProt.buildPanel(interaction.guild));
      } catch (err) {
        console.error('[ping prot] panel error:', err);
      }
    });
  },
};
