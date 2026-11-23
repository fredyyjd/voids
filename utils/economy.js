const fs = require('fs');
const path = require('path');
const { CURRENCY, ITEMS } = require('./economyConfig');

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
    shop: { discounts: [], hidden: [], custom: {}, announcement: null, entryRestored: true },
    boost: { on: false, endsAt: null },
  };
}

function load() {
  if (state) return state;

  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state = { ...blank(), ...raw };
    state.users ||= {};
    state.shopRoles ||= {};
    const restore = !raw.shop?.entryRestored;
    state.shop = { ...blank().shop, ...(raw.shop || {}) };
    state.shop.entryRestored = true;
    if (restore) {
      state.shop.hidden = (state.shop.hidden || []).filter((k) => k !== 'extra_entry');
      touch();
    }
    state.boost = { ...blank().boost, ...(raw.boost || {}) };
    for (const u of Object.values(state.users)) {
      u.pass ||= 0;
      u.boxes ||= 0;
      u.roles ||= [];
      u.features ||= [];
      u.badges ||= [];
      u.abuse = { ...fresh().abuse, ...(u.abuse || {}) };
      u.chat = { ...fresh().chat, ...(u.chat || {}) };
    }
    for (const [key, item] of Object.entries(state.shop.custom)) ITEMS[key] = { ...item, custom: true };
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
    pass: 0, // count passes
    boxes: 0, // unopened mystery boxes
    roles: [], // owned shop roles
    features: [], // owned feature perks
    badges: [], // owned badges
    abuse: { strikes: 0, rate: 1, pts: [], lastAt: 0 },
    chat: { n: 0, at: 0, last: '', day: '', earned: 0, seenAt: 0, recent: [], gaps: [] },
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

function boostActive() {
  const b = load().boost;
  if (!b.on) return false;
  if (b.endsAt && b.endsAt <= Date.now()) {
    b.on = false;
    b.endsAt = null;
    touch();
    return false;
  }
  return true;
}

const boostMult = () => (boostActive() ? 2 : 1);

function setBoost(on, endsAt = null) {
  load().boost = { on: Boolean(on), endsAt: on ? endsAt : null };
  touch();
}

const boostState = () => load().boost;

const rateOf = (id) => peek(id).abuse?.rate ?? 1;

const scaled = (id, base) => round1(base * boostMult() * rateOf(id));

function earn(id, base) {
  const amount = scaled(id, base);
  addVb(id, amount);
  return amount;
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

/* ---------- shop settings ---------- */

const shopSettings = () => load().shop;

function activeDiscounts() {
  const shop = load().shop;
  const now = Date.now();
  const kept = shop.discounts.filter((d) => !d.endsAt || d.endsAt > now);

  if (kept.length !== shop.discounts.length) {
    shop.discounts = kept;
    touch();
  }

  return kept;
}

function addDiscount(discount) {
  const shop = load().shop;
  shop.discounts.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...discount });
  touch();
}

function removeDiscount(id) {
  const shop = load().shop;
  const before = shop.discounts.length;
  shop.discounts = shop.discounts.filter((d) => d.id !== id);
  touch();
  return shop.discounts.length !== before;
}

const isHidden = (key) => load().shop.hidden.includes(key);

function setHidden(key, hidden) {
  const shop = load().shop;
  shop.hidden = shop.hidden.filter((k) => k !== key);
  if (hidden) shop.hidden.push(key);
  touch();
}

function addCustomItem(key, item) {
  load().shop.custom[key] = item;
  ITEMS[key] = { ...item, custom: true };
  touch();
}

function removeCustomItem(key) {
  const shop = load().shop;
  delete shop.custom[key];
  delete ITEMS[key];
  shop.hidden = shop.hidden.filter((k) => k !== key);
  shop.discounts = shop.discounts.filter((d) => d.target !== `item:${key}`);
  touch();
}

const announcement = () => load().shop.announcement || null;

function setAnnouncement(text, by) {
  load().shop.announcement = { text, by, at: Date.now() };
  touch();
}

function clearAnnouncement() {
  load().shop.announcement = null;
  touch();
}

/* ---------- abuse strikes ---------- */

function pardon(id) {
  const u = user(id);
  u.abuse = { strikes: 0, rate: 1, pts: [], lastAt: 0 };
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

load();

module.exports = {
  user,
  peek,
  addVb,
  spendVb,
  boostActive,
  boostMult,
  boostState,
  setBoost,
  rateOf,
  scaled,
  earn,
  shopSettings,
  activeDiscounts,
  addDiscount,
  removeDiscount,
  isHidden,
  setHidden,
  addCustomItem,
  announcement,
  setAnnouncement,
  clearAnnouncement,
  removeCustomItem,
  pardon,
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
