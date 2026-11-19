const createStore = require('./jsonStore');

const store = createStore('mod_stats.json', {});

const DAY = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 20000;
const KEEP_MS = 400 * DAY;

const KINDS = {
  spam: 'Spam',
  everyone: '@everyone / @here',
  mentions: 'Mass mentions',
  protected_ping: 'Protected member pings',
  pingguard_everyone: 'Ping guard bans (repeat @everyone)',
  pingguard_quick: 'Quick drop ping spam',
};

function load() {
  const data = store.get('data') || {};
  return {
    since: data.since || Date.now(),
    events: Array.isArray(data.events) ? data.events : [],
    totals: data.totals || {},
    users: data.users || {},
  };
}

function record(kind, userId, info = {}) {
  try {
    const data = load();
    const now = Date.now();

    data.events.push({ t: now, k: kind, u: userId, ...info });
    data.events = data.events.filter((e) => now - e.t <= KEEP_MS).slice(-MAX_EVENTS);
    data.totals[kind] = (data.totals[kind] || 0) + 1;
    data.users[userId] = (data.users[userId] || 0) + 1;

    store.set('data', data);
  } catch (err) {
    console.error('[modStats] could not record:', err);
  }
}

function summary(now = Date.now()) {
  const data = load();
  const perKind = {};

  for (const kind of Object.keys(KINDS)) {
    perKind[kind] = { day: 0, week: 0, weekUsers: new Set(), all: data.totals[kind] || 0 };
  }

  const weekUsers = new Set();
  const weekCounts = new Map();

  for (const e of data.events) {
    const row = perKind[e.k];
    if (!row) continue;
    const age = now - e.t;
    if (age <= DAY) row.day += 1;
    if (age <= 7 * DAY) {
      row.week += 1;
      row.weekUsers.add(e.u);
      weekUsers.add(e.u);
      weekCounts.set(e.u, (weekCounts.get(e.u) || 0) + 1);
    }
  }

  const sum = (key) => Object.values(perKind).reduce((n, r) => n + (typeof r[key] === 'number' ? r[key] : 0), 0);

  return {
    since: data.since,
    perKind,
    totalDay: sum('day'),
    totalWeek: sum('week'),
    totalAll: sum('all'),
    uniqueWeek: weekUsers.size,
    uniqueAll: Object.keys(data.users).length,
    topWeek: [...weekCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    latest: data.events.slice(-5).reverse(),
  };
}

module.exports = { KINDS, record, summary };
