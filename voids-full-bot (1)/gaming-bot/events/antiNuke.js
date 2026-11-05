const antiNuke = require('../utils/antiNuke');

module.exports = {
  name: 'antiNuke',

  register(client) {
    antiNuke.register(client);
  },
};
