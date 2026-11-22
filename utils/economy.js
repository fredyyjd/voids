const fs = require('fs');
const path = require('path');
const { CURRENCY } = require('./economyConfig');

// VB, achievements, counting and inventory all live in one small JSON file.
// Everything is kept in memory and saved a few seconds after the last change.

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const FILE = path.join(DATA_DIR, 'economy.json');
const SAVE_DELAY_MS = 10 * 1000;

let state = null;
let timer = null;

function blank() {
  return {
    users: {},
    counting: { guildId: null, channelId: null, current: 0, lastUserId: null },
    shopRoles: {}, // item key -> role id
    achBoard: { messageId: null }, // the sticky achievement leaderboard message
  };
}

function load() {
  if (state) return state;

  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state = { ...blank(), ...raw };
    state.users ||= {};
    state.shopRoles ||= {};
    state.achBoard = { ...blank().achBoard, ...(raw.achBoard || {}) };
    state.counting = { ...blank().counting, ...(raw.counting || {}) };
  } catch {
    state = blank();
  }
  return state;
}

function saveNow() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!state) return;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[economy] could not save economy.json:', err.message);
  }
}

function touch() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    saveNow();
  }, SAVE_DELAY_MS);
  timer.unref?.();
}

// The staff manager exits straight from its own SIGTERM handler, so save on exit.
process.on('exit', saveNow);

const round1 = (n) => Math.round(n * 10) / 10;

function fresh() {
  return {
    vb: 0,
    msgs: 0,
    counts: 0,
    lastCount: 0,
    ach: {}, // achievement key -> unlocked at
    colours: [], // owned colour item keys
    equipped: null,
    extra: 0, // extra giveaway entries in the inventory
    chat: { n: 0, at: 0, last: '', day: '', earned: 0 },
  };
}

// Creates the record if needed. Use for anything that writes.
function user(id) {
  const s = load();
  if (!s.users[id]) s.users[id] = fresh();
  return s.users[id];
}

// Read only. Does not create a record for someone who has never earned anything.
function peek(id) {
  return load().users[id] || fresh();
}

function addVb(id, amount) {
  const u = user(id);
  u.vb = round1(u.vb + amount);
  touch();
  return u.vb;
}

function spendVb(id, amount) {
  const u = user(id);
  if (u.vb + 1e-9 < amount) return false;
  u.vb = round1(u.vb - amount);
  touch();
  return true;
}

function fmt(n) {
  const value = round1(Number(n) || 0);
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${CURRENCY}`;
}

/* ---------- inventory ---------- */

function addExtra(id, n = 1) {
  user(id).extra += n;
  touch();
}

function useExtra(id) {
  const u = user(id);
  if (u.extra < 1) return false;
  u.extra -= 1;
  touch();
  return true;
}

/* ---------- counting ---------- */

const counting = () => load().counting;

function setCountingChannel(guildId, channelId) {
  const state = load();
  state.counting = { guildId, channelId, current: 0, lastUserId: null };

  // A fresh start also clears everyone's counting cooldown.
  for (const u of Object.values(state.users)) u.lastCount = 0;
  touch();
}

function clearCountingChannel() {
  load().counting = blank().counting;
  touch();
}

/* ---------- achievement leaderboard (sticky) ---------- */

const achBoard = () => load().achBoard;

function setAchBoardMessage(messageId) {
  load().achBoard = { messageId };
  touch();
}

/* ---------- shop roles ---------- */

const shopRoles = () => load().shopRoles;

function setShopRole(key, roleId) {
  load().shopRoles[key] = roleId;
  touch();
}

/* ---------- leaderboard ---------- */

function topByAchievements(limit = 10) {
  return Object.entries(load().users)
    .map(([id, u]) => ({ id, achievements: Object.keys(u.ach || {}).length, vb: u.vb || 0 }))
    .filter((e) => e.achievements > 0)
    .sort((a, b) => b.achievements - a.achievements || b.vb - a.vb)
    .slice(0, limit);
}

module.exports = {
  user,
  peek,
  addVb,
  spendVb,
  fmt,
  touch,
  saveNow,
  addExtra,
  useExtra,
  counting,
  setCountingChannel,
  clearCountingChannel,
  shopRoles,
  setShopRole,
  achBoard,
  setAchBoardMessage,
  topByAchievements,
};
