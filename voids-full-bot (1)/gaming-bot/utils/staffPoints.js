const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const createStore = require('./jsonStore');
const extra = require('../extraConfig');
const config = require('../config.json');
const { COLOR } = require('./theme');
const { hasMaxPerms, isSupport, isMod } = require('./permissions');

const cfg = extra.staffPoints || {};

const POINTS = {
  close: 2,
  rename: 2,
  claim: 1,
  post: 3,
  ...(cfg.points || {}),
};

const TIMEZONE = cfg.timezone || 'Australia/Sydney';
const RESET_DAY = cfg.resetDay === undefined ? 0 : cfg.resetDay; // 0 = Sunday
const RESET_HOUR = cfg.resetHour === undefined ? 12 : cfg.resetHour; // 12 = 12pm
const POST_COOLDOWN_MS = (cfg.postCooldownSeconds === undefined ? 2 : cfg.postCooldownSeconds) * 1000;

// data/staff_points.json
//   weekStart  when the current week began (ms)
//   weekly     userId -> { closes, claims, renames, posts, points }  (resets every week)
//   allTime    same shape, never resets
//   lastWeek   the finished week, kept for reference
//   claimed    channelId -> time, so claim / unclaim / claim can't farm points
const store = createStore('staff_points.json', {
  weekStart: 0,
  weekly: {},
  allTime: {},
  lastWeek: null,
  claimed: {},
});

/* ---------- weekly reset (Sunday 12pm) ---------- */

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zoned(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));

  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    h: Number(get('hour')) % 24,
    mi: Number(get('minute')),
    s: Number(get('second')),
    dow: DOW[get('weekday')],
  };
}

function offsetMs(ms) {
  const z = zoned(ms);
  return Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s) - Math.floor(ms / 1000) * 1000;
}

// The moment the current week started (the last Sunday 12pm in the bot's timezone).
function weekStartFor(ms) {
  const z = zoned(ms);
  let back = (z.dow - RESET_DAY + 7) % 7;
  if (back === 0 && z.h < RESET_HOUR) back = 7;

  const wall = Date.UTC(z.y, z.m - 1, z.d - back, RESET_HOUR, 0, 0);
  const guess = wall - offsetMs(ms);
  return wall - offsetMs(guess);
}

function nextResetMs(now = Date.now()) {
  const start = weekStartFor(now);
  return weekStartFor(start + 8 * 24 * 60 * 60 * 1000);
}

// Starts a fresh week when the reset time has passed.
function rollWeek() {
  const current = weekStartFor(Date.now());
  const saved = store.get('weekStart');
  if (saved === current) return;

  const weekly = store.get('weekly') || {};
  if (saved && Object.keys(weekly).length) {
    store.set('lastWeek', { weekStart: saved, users: weekly });
  }
  store.set('weekly', {});
  store.set('weekStart', current);
}

/* ---------- who counts as staff ---------- */

function isStaffMember(member) {
  if (!member) return false;
  if (hasMaxPerms(member) || isSupport(member) || isMod(member)) return true;

  return (config.adminRoleIds || []).some(
    (id) => id && !String(id).startsWith('PUT_') && member.roles?.cache?.has(id)
  );
}

/* ---------- adding points ---------- */

const STAT_FOR_ACTION = { close: 'closes', claim: 'claims', rename: 'renames', post: 'posts' };

const lastPost = new Map(); // userId -> time of the last post that earned points

function blank() {
  return { closes: 0, claims: 0, renames: 0, posts: 0, points: 0 };
}

function bump(bucket, userId, stat, points) {
  const entry = { ...blank(), ...(bucket[userId] || {}) };
  entry[stat] += 1;
  entry.points += points;
  bucket[userId] = entry;
}

// action: 'close' | 'claim' | 'rename' | 'post'
// Returns the points that were added (0 when nothing was added).
function record(member, action, ctx = {}) {
  try {
    const stat = STAT_FOR_ACTION[action];
    const points = POINTS[action];
    if (!stat || !points || !member || member.user?.bot) return 0;
    if (!isStaffMember(member)) return 0;

    const userId = member.id;
    const now = Date.now();

    // 2 second cooldown on posting so a post can't be farmed.
    if (action === 'post') {
      if (now - (lastPost.get(userId) || 0) < POST_COOLDOWN_MS) return 0;
      lastPost.set(userId, now);
    }

    // A ticket only ever pays out one claim, however often it is claimed / unclaimed.
    if (action === 'claim' && ctx.channelId) {
      const claimed = store.get('claimed') || {};
      if (claimed[ctx.channelId]) return 0;

      claimed[ctx.channelId] = now;
      const cutoff = now - 30 * 24 * 60 * 60 * 1000;
      for (const key of Object.keys(claimed)) if (claimed[key] < cutoff) delete claimed[key];
      store.set('claimed', claimed);
    }

    rollWeek();

    const weekly = store.get('weekly') || {};
    bump(weekly, userId, stat, points);
    store.set('weekly', weekly);

    const allTime = store.get('allTime') || {};
    bump(allTime, userId, stat, points);
    store.set('allTime', allTime);

    return points;
  } catch (err) {
    console.error('[staff points] could not add points:', err);
    return 0;
  }
}

/* ---------- leaderboard ---------- */

const VIEWS = {
  points: { label: 'Staff Points', emoji: '🏆', unit: 'pts', description: 'Everyone\'s total points' },
  closes: { label: 'Ticket Closes', emoji: '🔒', unit: 'closes', description: 'Tickets closed (2 pts each)' },
  claims: { label: 'Ticket Claims', emoji: '🎫', unit: 'claims', description: 'Tickets claimed (1 pt each)' },
  renames: { label: 'Ticket Renames', emoji: '✏️', unit: 'renames', description: 'Tickets renamed (2 pts each)' },
  posts: { label: 'Schematic Posts', emoji: '📦', unit: 'posts', description: 'Schematics posted (3 pts each)' },
};

const MEDALS = ['🥇', '🥈', '🥉'];
const MAX_LINES = 25;

function getBucket(scope) {
  rollWeek();
  return (scope === 'alltime' ? store.get('allTime') : store.get('weekly')) || {};
}

function ranked(scope, view) {
  const bucket = getBucket(scope);
  return Object.entries(bucket)
    .map(([userId, e]) => ({ userId, value: e[view] || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

function buildMenu(scope, ephemeral) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${ephemeral ? 'staff_lbe' : 'staff_lb'}:${scope}`)
    .setPlaceholder('See closes, claims, renames and more')
    .addOptions(
      Object.entries(VIEWS).map(([value, v]) => ({
        label: v.label,
        value,
        description: v.description,
        emoji: v.emoji,
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

function buildBoard(scope, view = 'points', ephemeral = false) {
  const v = VIEWS[view] || VIEWS.points;
  const rows = ranked(scope, view);

  const lines = rows.slice(0, MAX_LINES).map((r, i) => {
    const rank = MEDALS[i] || `**${i + 1}.**`;
    return `${rank} <@${r.userId}> · **${r.value}** ${v.unit}`;
  });

  if (rows.length > MAX_LINES) lines.push(`*...and ${rows.length - MAX_LINES} more*`);
  if (!lines.length) lines.push('No points yet.');

  const header =
    scope === 'alltime'
      ? '♾️ **All time** · never resets'
      : `🔄 Resets <t:${Math.floor(nextResetMs() / 1000)}:R>`;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${v.emoji} ${v.label}${scope === 'alltime' ? ' · All Time' : ''}`)
    .setDescription([header, '', ...lines].join('\n'))
    .setFooter({
      text: `Close ${POINTS.close} · Rename ${POINTS.rename} · Claim ${POINTS.claim} · Schematic post ${POINTS.post}`,
    })
    .setTimestamp();

  return { embeds: [embed], components: [buildMenu(scope, ephemeral)], allowedMentions: { parse: [] } };
}

module.exports = {
  POINTS,
  VIEWS,
  record,
  isStaffMember,
  buildBoard,
  nextResetMs,
  weekStartFor,
};
