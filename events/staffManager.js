const cfg = require('../utils/staffConfig');
const store = require('../utils/staffStore');
const messages = require('../utils/staffMessages');
const review = require('../utils/staffReview');
const { hasBypassRole } = require('../utils/staffBypass');

const MIN = 60 * 1000;

function isTracked(member) {
  const roles = member?.roles?.cache;
  if (!roles || typeof roles.has !== 'function') return false;
  if (hasBypassRole(member)) return true;
  if (cfg.baseRoleId && roles.has(cfg.baseRoleId)) return true;
  return cfg.ladder.some((r) => roles.has(r.roleId));
}

function onMessage(message) {
  if (!message.guild || !message.author || message.author.bot || message.webhookId) return;

  messages.observe(message);

  if (!isTracked(message.member)) return;
  if (messages.evaluate(message).ok) store.recordMessage(message);
}

module.exports = {
  name: 'staffManager',

  register(client) {
    if (!cfg.enabled) return;

    client.on('messageCreate', (message) => {
      try {
        onMessage(message);
      } catch (err) {
        console.error('[staff] message tracking failed:', err);
      }
    });

    client.on('messageDelete', (message) => store.unrecordMessage(message.id));
    client.on('messageDeleteBulk', (deleted) => {
      for (const id of deleted.keys()) store.unrecordMessage(id);
    });

    client.once('ready', async () => {
      store.heartbeat();

      const guild = [...client.guilds.cache.values()].find((g) => cfg.baseRoleId && g.roles.cache.has(cfg.baseRoleId));
      for (const problem of review.diagnostics(guild)) console.warn(`[staff] ${problem.replace(/\*\*/g, '')}`);

      const run = () => {
        store.heartbeat();
        review.tick(client).catch((err) => console.error('[staff review] tick failed:', err));
      };

      setTimeout(run, 30 * 1000).unref?.();
      setInterval(run, MIN).unref?.();
      setInterval(() => store.maintenance(), 60 * MIN).unref?.();
      require('../utils/activityCheckAuto').start(client);

      console.log('[staff] activity tracking and weekly review are running.');
    });

    // Save before pm2 stops or restarts the bot.
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        store.flush();
        process.exit(0);
      });
    }
  },
};
