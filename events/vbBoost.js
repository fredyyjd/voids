const { arm } = require('../utils/vbBoost');

module.exports = {
  register(client) {
    client.once('ready', () => arm(client));
  },
};
