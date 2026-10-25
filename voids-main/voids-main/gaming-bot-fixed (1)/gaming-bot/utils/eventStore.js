const fs = require('fs');
const path = require('path');

// Same data folder as giveaways.json, so events survive restarts the same way.
const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'events.json');

let db = null;

function load() {
  if (db) return db;

  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    db = {};
  }

  db.events ||= {}; // id -> event
  db.stats ||= {}; // userId -> { played, wins, podiums, points }
  db.history ||= []; // finished event ids, newest last
  db.counter ||= 0;
  return db;
}

// Write to a temp file then rename, so a crash mid-write can't corrupt the file.
function save() {
  const data = load();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DATA_FILE);
}

// Many people click answer buttons at once, so button clicks save after a short
// pause instead of rewriting the file every time. Round changes save straight away.
let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { save(); } catch (err) { console.error('[events] save failed', err); }
  }, 750);
}

function nextId() {
  const data = load();
  data.counter += 1;
  save();
  return String(data.counter);
}

const getEvent = (id) => load().events[id] || null;

function runningEvents(guildId) {
  return Object.values(load().events).filter(
    (e) => e.status === 'running' && (!guildId || e.guildId === guildId)
  );
}

function userStats(userId) {
  const data = load();
  return (data.stats[userId] ||= { played: 0, wins: 0, podiums: 0, points: 0 });
}

module.exports = { load, save, saveSoon, nextId, getEvent, runningEvents, userStats };
