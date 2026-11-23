const { handleInteraction, onMessage } = require('../utils/requestPing');

// /request ping: the dropdown, the Accept / Deny buttons, and using up the
// approved ping once the person sends it.
module.exports = {
  name: 'requestPing',

  register(client) {
    client.on('interactionCreate', (interaction) => {
      handleInteraction(interaction).catch((err) => console.error('[request] interaction error:', err));
    });

    client.on('messageCreate', (message) => {
      onMessage(message).catch((err) => console.error('[request] message error:', err));
    });
  },
};
