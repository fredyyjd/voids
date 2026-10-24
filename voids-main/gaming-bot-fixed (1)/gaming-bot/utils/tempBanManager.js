// Parses "20s / 10m / 2h / 3d / 1w" style durations, and schedules +
// persists the auto-unban for temporary bans so they still fire even if the
// bot restarts before the ban expires.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'tempbans.json');

// setTimeout only accepts a 32-bit signed int (~24.8 days) before it
// overflows and fires immediately. Not reachable at our 1-week command cap,
// but chained the same way as the giveaway scheduler for safety.
const MAX_TIMEOUT_MS = 2147483647;

function scheduleTimeout(callback, delay) {
  if (delay > MAX_TIMEOUT_MS) {
    return setTimeout(() => scheduleTimeout(callback, delay - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
  }
  return setTimeout(callback, Math.max(delay, 0));
}

/* =========================================================
   DURATION PARSING
========================================================= */

// "20s" -> 20000, "10m" -> 600000, "2h", "3d", "1w". Returns null if the
// string isn't a valid duration.
function parseDuration(str) {
  if (!str) return null;
  const match = /^(\d+)\s*(s|m|h|d|w)$/i.exec(str.trim());
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

/* =========================================================
   STORAGE
========================================================= */

function loadTempBans() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveTempBans(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function addTempBan(guildId, userId, unbanAt) {
  const data = loadTempBans();
  data[`${guildId}:${userId}`] = { guildId, userId, unbanAt };
  saveTempBans(data);
}

function removeTempBan(guildId, userId) {
  const data = loadTempBans();
  delete data[`${guildId}:${userId}`];
  saveTempBans(data);
}

/* =========================================================
   SCHEDULING
========================================================= */

function scheduleUnban(client, guildId, userId, unbanAt) {
  const delay = unbanAt - Date.now();

  scheduleTimeout(async () => {
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        await guild.bans.remove(userId, 'Temporary ban expired').catch(() => {});
      }
    } finally {
      removeTempBan(guildId, userId);
    }
  }, delay);
}

// Call on bot startup to re-arm any temp bans that were still pending when
// the bot last shut down (in-memory timers don't survive a restart).
function rearmTempBans(client) {
  const data = loadTempBans();
  for (const { guildId, userId, unbanAt } of Object.values(data)) {
    scheduleUnban(client, guildId, userId, unbanAt);
  }
}

module.exports = {
  parseDuration,
  addTempBan,
  removeTempBan,
  scheduleUnban,
  rearmTempBans,
};
