const { trackReaction, rearmChecks } = require('../utils/activityCheck');

module.exports = {
  register(client) {
    // Raw packets work even for messages that aren't cached.
    client.on('raw', (packet) => {
      try {
        trackReaction(client, packet);
      } catch (err) {
        console.error('[activity] reaction tracking failed:', err);
      }
    });

    client.once('ready', () => rearmChecks(client));
  },
};
