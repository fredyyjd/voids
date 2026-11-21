const {
  logMessageCreate,
} = require('../utils/logger');

const { handleAfk } = require('../utils/afkManager');
const { enforceGamesChannel } = require('../utils/gameKit');

/* =========================================================
   LOGGER SERVER
========================================================= */

const LOGGER_GUILD_ID = '1542361762186268765';

/* =========================================================
   MESSAGE CREATE
========================================================= */

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    // Ignore bots
    if (message.author?.bot) return;

    // Don't log messages inside the logger server
    if (message.guild?.id === LOGGER_GUILD_ID) return;

    /* =====================================================
       CROSS-SERVER MESSAGE LOG
    ===================================================== */

    try {
      await logMessageCreate(message);
    } catch (err) {
      console.error('[MESSAGE] Failed to log message:', err);
    }

    /* =====================================================
       AFK (remove on typing, answer pings)
    ===================================================== */

    try {
      await handleAfk(message);
    } catch (err) {
      console.error('[AFK] failed:', err);
    }

    /* =====================================================
       GAMES CHANNEL (deletes typing when no typing game runs)
    ===================================================== */

    if (await enforceGamesChannel(message)) return;
  },
};
