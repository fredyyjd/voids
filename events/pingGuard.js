const { checkPings, startCleanup } = require('../utils/pingGuard');

module.exports = {
  name: 'pingGuard',

  register(client) {
    startCleanup();
    client.on('messageCreate', (message) => {
      checkPings(message).catch((err) => console.error('[PING-GUARD] error:', err));
    });
    console.log('[PING-GUARD] Watching @everyone / @here and quick drop pings.');
  },
};
