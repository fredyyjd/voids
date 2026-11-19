const createStore = require('./jsonStore');
const extra = require('../extraConfig');
const cfg = require('./staffConfig');

const settings = extra.staff;
const WARNS_PER_STRIKE = settings.warnsPerStrike || 3;
const STRIKES_FOR_DEMOTION = settings.strikesForDemotion || 2;
const DAY_MS = 24 * 60 * 60 * 1000;

// data/staff_records.json: userId -> { warns: [...], strikes: [...] }
// strike: { id, to, by, reason, evidence, at, auto, consumedBy? }
// consumedBy = the weekly review that used the strike for a demotion.
const store = createStore('staff_records.json', {});

function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalize(userId, list, prefix) {
  return (list || []).map((entry) => ({
    ...entry,
    id: entry.id || `${prefix}${entry.at}`,
    to: entry.to || userId,
  }));
}

function getRecord(userId) {
  const rec = store.get(userId) || {};
  return { warns: normalize(userId, rec.warns, 'w'), strikes: normalize(userId, rec.strikes, 's') };
}

function isValid(strike, now = Date.now()) {
  if (strike.consumedBy || strike.revokedAt) return false;
  const days = cfg.strikes.expiryDays;
  return !days || now - strike.at < days * DAY_MS;
}

function validStrikes(userId, now = Date.now()) {
  return getRecord(userId).strikes.filter((s) => isValid(s, now));
}

function counts(rec, now = Date.now()) {
  return { warns: rec.warns.length, strikes: rec.strikes.filter((s) => isValid(s, now)).length };
}

function addStrike(userId, reason, by, opts = {}) {
  const rec = getRecord(userId);
  const strike = {
    id: newId('s'),
    to: userId,
    by,
    reason,
    evidence: opts.evidence || null,
    at: Date.now(),
    auto: !!opts.auto,
  };
  rec.strikes.push(strike);
  store.set(userId, rec);
  return { ...counts(rec), strike };
}

// Adds a warn. Every WARNS_PER_STRIKE warns turn into one strike automatically
// (those warns are used up, so the counter starts again).
function addWarn(userId, reason, by, opts = {}) {
  const rec = getRecord(userId);
  rec.warns.push({ id: newId('w'), to: userId, reason, by, evidence: opts.evidence || null, at: Date.now() });

  let autoStrike = null;
  if (rec.warns.length >= WARNS_PER_STRIKE) {
    const used = rec.warns.splice(0, WARNS_PER_STRIKE);
    autoStrike = {
      id: newId('s'),
      to: userId,
      reason: `${WARNS_PER_STRIKE} warnings: ${used.map((w) => w.reason).join(' | ')}`.slice(0, 900),
      by,
      evidence: used.map((w) => w.evidence).find(Boolean) || null,
      at: Date.now(),
      auto: true,
    };
    rec.strikes.push(autoStrike);
  }

  store.set(userId, rec);
  return { ...counts(rec), autoStrike };
}

function removeWarn(userId, count = 1) {
  const rec = getRecord(userId);
  const removed = rec.warns.splice(Math.max(0, rec.warns.length - count), count).length;
  store.set(userId, rec);
  return { removed, ...counts(rec) };
}

function removeStrike(userId, count = 1) {
  const rec = getRecord(userId);
  const removed = rec.strikes.splice(Math.max(0, rec.strikes.length - count), count).length;
  store.set(userId, rec);
  return { removed, ...counts(rec) };
}

// Marks the oldest valid strikes as used by a demotion. Returns their ids.
function consumeStrikes(userId, count, reviewId) {
  const rec = getRecord(userId);
  const now = Date.now();
  const ids = [];

  for (const strike of rec.strikes) {
    if (ids.length >= count) break;
    if (!isValid(strike, now)) continue;
    strike.consumedBy = reviewId;
    strike.consumedAt = now;
    ids.push(strike.id);
  }

  store.set(userId, rec);
  return ids;
}

function strikesBetween(userId, from, to) {
  return getRecord(userId).strikes.filter((s) => s.at >= from && s.at < to);
}

function warnsBetween(userId, from, to) {
  return getRecord(userId).warns.filter((w) => w.at >= from && w.at < to);
}

function resetRecord(userId) {
  store.delete(userId);
}

module.exports = {
  WARNS_PER_STRIKE,
  STRIKES_FOR_DEMOTION,
  getRecord,
  isValid,
  validStrikes,
  addStrike,
  addWarn,
  removeWarn,
  removeStrike,
  consumeStrikes,
  strikesBetween,
  warnsBetween,
  resetRecord,
};
