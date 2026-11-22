const { checkMessage, startCleanup } = require('../utils/autoMod');

module.exports = {
  name: 'autoMod',

  register(client) {
    startCleanup();
    client.on('messageCreate', (message) => {
      checkMessage(message).catch((err) => console.error('[AUTOMOD] error:', err));
    });
    console.log('[AUTOMOD] Watching spam, @everyone / @here and mention abuse.');
  },
};
