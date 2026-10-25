const { rearmActiveGiveaways } = require('../utils/giveawayManager');
const { startDailyGiveawayLoop } = require('../utils/dailyGiveaway');
const { rearmTempBans } = require('../utils/tempBanManager');

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`logged in as ${client.user.tag}`);

    rearmActiveGiveaways(client);

    // Timers don't survive a restart, so re-schedule pending auto-unbans.
    rearmTempBans(client);

    startDailyGiveawayLoop(client);

    const statuses = [
      { name: 'looking for staff so apply', type: 2 },
      { dynamic: 'memberCount', type: 3 },
    ];

    function buildStatusName(status) {
      if (status.dynamic === 'memberCount') {
        const memberCount = client.guilds.cache.reduce((sum, g) => sum + (g.memberCount || 0), 0);
        return `${memberCount.toLocaleString()} members`;
      }
      return status.name;
    }

    let index = 0;
    client.user.setActivity(buildStatusName(statuses[index]), { type: statuses[index].type });

    setInterval(() => {
      index = (index + 1) % statuses.length;
      client.user.setActivity(buildStatusName(statuses[index]), { type: statuses[index].type });
    }, 10 * 1000);
  },
};
