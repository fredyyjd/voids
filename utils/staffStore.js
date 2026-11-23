const createStore = require('./jsonStore');
const extra = require('../extraConfig');
const cfg = require('./staffConfig');
const messages = require('./staffMessages');
const { weekStartFor } = require('./staffPoints');

const TIMEZONE = extra.staffPoints?.timezone || 'Australia/Sydney';
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const SAVE_DELAY_MS = 5000;

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// data/staff_management.json
//   trackingStart  when tracking began (a week is only reviewed if it was tracked in full)
//   weeks          weekStartMs -> { users: { id: stats }, downMs }
//   history        userId -> [ weekly review results at a rank ]
//   reviews        weekStartMs -> review record (plan, results, report progress)
//   sotw           { current, history }
//   dedupe         key -> time, so one ticket / giveaway / schematic only counts once
const store = createStore('staff_management.json', {});

let state = null;
let timer = null;
const closeTimes = new Map(); // userId -> recent counted close times

const dayKey = (ms) => dayFormat.format(new Date(ms));
const weekKey = (ms = Date.now()) => String(weekStartFor(ms));

function blank() {
  return { msgs: 0, days: {}, handled: 0, closed: 0, giveaways: 0, schematics: 0, mod: 0, events: 0 };
}

function load() {
  if (state) return state;

  const raw = store.all();
  state = {
    trackingStart: raw.trackingStart || Date.now(),
    lastSeen: raw.lastSeen || 0,
    weeks: raw.weeks || {},
    history: raw.history || {},
    reviews: raw.reviews || {},
    sotw: raw.sotw || { current: null, history: [] },
    dedupe: raw.dedupe || {},
  };

  if (!raw.trackingStart) saveNow();
  return state;
}

function saveNow() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!state) return;

  try {
    store.overwriteAll(state);
  } catch (err) {
    console.error('[staff] could not save staff_management.json:', err);
  }
}

function markDirty() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    saveNow();
  }, SAVE_DELAY_MS);
  timer.unref?.();
}

// Test helper: forget the in-memory copy so the next call reads the file again.
function reload() {
  if (timer) clearTimeout(timer);
  timer = null;
  state = null;
  closeTimes.clear();
  messages.reset();
}

function weekRecord(week) {
  const s = load();
  if (!s.weeks[week]) s.weeks[week] = { users: {}, downMs: 0 };
  return s.weeks[week];
}

function bucket(userId, at = Date.now()) {
  const users = weekRecord(weekKey(at)).users;
  if (!users[userId]) users[userId] = blank();
  return users[userId];
}

function once(key, now = Date.now()) {
  const s = load();
  if (s.dedupe[key]) return false;
  s.dedupe[key] = now;
  return true;
}

function touchDay(user, now, field) {
  const key = dayKey(now);
  if (!user.days[key]) user.days[key] = { m: 0, a: 0, s: 0 };
  user.days[key][field] += 1;
  return user.days[key];
}

/* ---------- recorders ---------- */

function recordMessage(message, now = Date.now()) {
  const user = bucket(message.author.id, now);
  user.msgs += 1;
  touchDay(user, now, 'm');
  messages.remember(message.id, { userId: message.author.id, at: now, week: weekKey(now), day: dayKey(now) });
  markDirty();
}

// A counted message that was deleted shortly after is taken back.
function unrecordMessage(messageId, now = Date.now()) {
  const info = messages.forget(messageId, now);
  if (!info) return false;

  const user = load().weeks[info.week]?.users?.[info.userId];
  if (!user) return false;

  user.msgs = Math.max(0, user.msgs - 1);
  const day = user.days[info.day];
  if (day) day.m = Math.max(0, day.m - 1);
  markDirty();
  return true;
}

// kind: 'claim' | 'close'. ctx: { channelId, ownerId, openedAt }
function recordTicket(userId, kind, ctx = {}, now = Date.now()) {
  if (!userId || !ctx.channelId) return false;
  if (ctx.ownerId && ctx.ownerId === userId) return false;

  if (kind === 'close') {
    if (ctx.openedAt && now - ctx.openedAt < cfg.tickets.minCloseAgeSeconds * 1000) return false;

    const recent = (closeTimes.get(userId) || []).filter((t) => now - t < 60 * MIN);
    if (recent.length >= cfg.tickets.maxClosesPerHour) return false;
    if (!once(`close:${ctx.channelId}`, now)) return false;

    recent.push(now);
    closeTimes.set(userId, recent);

    const user = bucket(userId, now);
    user.closed += 1;
    touchDay(user, now, 'a');
  } else if (kind === 'claim') {
    if (!once(`claim:${ctx.channelId}`, now)) return false;

    const user = bucket(userId, now);
    user.handled += 1;
    touchDay(user, now, 'a');
  } else {
    return false;
  }

  markDirty();
  return true;
}

// Counted when a real giveaway ends with real entrants and ran for a real time.
function recordGiveaway(giveaway, messageId, now = Date.now()) {
  if (!giveaway || giveaway.game || !giveaway.hostId || !messageId) return false;

  const entrants = new Set((giveaway.entrants || []).filter((id) => id !== giveaway.hostId));
  if (entrants.size < cfg.giveaways.minEntrants) return false;

  const endedAt = giveaway.endedAt || now;
  if (giveaway.startedAt && endedAt - giveaway.startedAt < cfg.giveaways.minRuntimeSeconds * 1000) return false;

  if (!once(`gw:${messageId}`, now)) return false;

  const user = bucket(giveaway.hostId, endedAt);
  user.giveaways += 1;
  touchDay(user, endedAt, 'a');
  markDirty();
  return true;
}

function recordSchematic(userId, schematicId, now = Date.now()) {
  if (!userId || !schematicId) return false;

  const user = bucket(userId, now);
  const today = user.days[dayKey(now)];
  if (today && today.s >= cfg.schematics.maxPerDay) return false;
  if (!once(`schem:${schematicId}`, now)) return false;

  user.schematics += 1;
  touchDay(user, now, 's');
  touchDay(user, now, 'a');
  markDirty();
  return true;
}

// kind: 'mod' (ban / kick / timeout / warn / mute) | 'event' (hosted event)
function recordDuty(userId, kind, key, now = Date.now()) {
  if (!userId || !key || (kind !== 'mod' && kind !== 'event')) return false;
  if (!once(`duty:${kind}:${key}`, now)) return false;

  const user = bucket(userId, now);
  user[kind === 'mod' ? 'mod' : 'events'] += 1;
  touchDay(user, now, 'a');
  markDirty();
  return true;
}

/* ---------- reading ---------- */

function weekStats(week, userId) {
  const found = load().weeks[week]?.users?.[userId];
  return { ...blank(), ...(found || {}), days: { ...(found?.days || {}) } };
}

function weekUserIds(week) {
  return Object.keys(load().weeks[week]?.users || {});
}

function activeDays(stats) {
  const min = cfg.messages.minMessagesForActiveDay;
  return Object.values(stats.days || {}).filter((d) => d.m >= min || d.a > 0).length;
}

/* ---------- uptime ---------- */

// Called every minute. A gap longer than 3 minutes means the bot was offline,
// which is remembered so a week with big gaps is not judged on missing data.
function heartbeat(now = Date.now()) {
  const s = load();
  const gap = s.lastSeen ? now - s.lastSeen : 0;

  if (gap > 3 * MIN) {
    const record = weekRecord(weekKey(s.lastSeen));
    record.downMs = (record.downMs || 0) + gap;
  }

  s.lastSeen = now;
  markDirty();
}

function downtimeMs(week) {
  return load().weeks[week]?.downMs || 0;
}

/* ---------- history, reviews, staff of the week ---------- */

function getHistory(userId) {
  return load().history[userId] || [];
}

function pushHistory(userId, entry) {
  const s = load();
  const list = (s.history[userId] || []).filter((e) => e.week !== entry.week);
  list.push(entry);
  s.history[userId] = list.slice(-cfg.historyWeeks);
}

function getReview(week) {
  return load().reviews[week] || null;
}

function setReview(week, review) {
  load().reviews[week] = review;
}

function allReviews() {
  return load().reviews;
}

function getSotw() {
  return load().sotw;
}

function trackingStart() {
  return load().trackingStart;
}

// Drops data that is no longer useful.
function maintenance(now = Date.now()) {
  const s = load();
  const keepWeeks = cfg.historyWeeks * 7 * DAY;

  for (const week of Object.keys(s.weeks)) if (now - Number(week) > keepWeeks) delete s.weeks[week];
  for (const week of Object.keys(s.reviews)) if (now - Number(week) > keepWeeks) delete s.reviews[week];
  for (const [key, at] of Object.entries(s.dedupe)) if (now - at > 35 * DAY) delete s.dedupe[key];

  messages.cleanup(now);
  markDirty();
}

function flush() {
  saveNow();
}

module.exports = {
  dayKey,
  weekKey,
  blank,
  load,
  reload,
  saveNow,
  markDirty,
  flush,
  recordMessage,
  unrecordMessage,
  recordTicket,
  recordGiveaway,
  recordSchematic,
  recordDuty,
  weekStats,
  weekUserIds,
  activeDays,
  heartbeat,
  downtimeMs,
  getHistory,
  pushHistory,
  getReview,
  setReview,
  allReviews,
  getSotw,
  trackingStart,
  maintenance,
};
