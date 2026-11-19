const { handlePartnerInteraction } = require('../utils/partnerPing');

module.exports = {
  name: 'partnerPing',

  register(client) {
    client.on('interactionCreate', (interaction) => {
      handlePartnerInteraction(interaction).catch((err) => console.error('[partner] interaction error:', err));
    });
  },
};
