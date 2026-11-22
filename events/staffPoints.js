const { MessageFlags } = require('discord.js');
const points = require('../utils/staffPoints');

// The dropdown under /staff lb and /staff all-time.
async function handle(interaction) {
  if (!interaction.isStringSelectMenu()) return;

  const [kind, scope] = interaction.customId.split(':');
  if (kind !== 'staff_lb' && kind !== 'staff_lbe') return;

  if (!points.isStaffMember(interaction.member)) {
    return interaction.reply({ content: 'Only staff can use this.', flags: MessageFlags.Ephemeral });
  }

  const view = interaction.values[0];

  // The public board stays as it is, each pick opens privately.
  if (kind === 'staff_lb') {
    return interaction.reply({ ...points.buildBoard(scope, view, true), flags: MessageFlags.Ephemeral });
  }

  return interaction.update(points.buildBoard(scope, view, true));
}

module.exports = {
  name: 'staffPoints',

  register(client) {
    client.on('interactionCreate', (interaction) => {
      handle(interaction).catch((err) => console.error('[staff points] interaction error:', err));
    });
  },
};
