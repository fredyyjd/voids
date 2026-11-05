const createStore = require('./jsonStore');
const extra = require('../extraConfig');

const cfg = extra.staff;
const WARNS_PER_STRIKE = cfg.warnsPerStrike || 3;
const STRIKES_FOR_DEMOTION = cfg.strikesForDemotion || 3;

// data/staff_records.json: userId -> { warns: [...], strikes: [...] }
const store = createStore('staff_records.json', {});

function getRecord(userId) {
  const rec = store.get(userId) || {};
  return { warns: rec.warns || [], strikes: rec.strikes || [] };
}

function addStrike(userId, reason, by, auto = false) {
  const rec = getRecord(userId);
  rec.strikes.push({ reason, by, at: Date.now(), auto });
  store.set(userId, rec);
  return { warns: rec.warns.length, strikes: rec.strikes.length };
}

// Adds a warn. Every WARNS_PER_STRIKE warns turn into one strike automatically
// (those warns are used up, so the counter starts again).
function addWarn(userId, reason, by) {
  const rec = getRecord(userId);
  rec.warns.push({ reason, by, at: Date.now() });

  let autoStrike = null;
  if (rec.warns.length >= WARNS_PER_STRIKE) {
    const used = rec.warns.splice(0, WARNS_PER_STRIKE);
    autoStrike = {
      reason: `${WARNS_PER_STRIKE} warnings: ${used.map((w) => w.reason).join(' | ')}`.slice(0, 900),
      by,
      at: Date.now(),
      auto: true,
    };
    rec.strikes.push(autoStrike);
  }

  store.set(userId, rec);
  return { warns: rec.warns.length, strikes: rec.strikes.length, autoStrike };
}

function resetRecord(userId) {
  store.delete(userId);
}

module.exports = {
  WARNS_PER_STRIKE,
  STRIKES_FOR_DEMOTION,
  getRecord,
  addStrike,
  addWarn,
  resetRecord,
};
