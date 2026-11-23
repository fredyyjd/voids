const createStore = require('./jsonStore');
const extra = require('../extraConfig');
const { buildStaffEmbed } = require('./staffStatusView');

const store = createStore('staff_status_post.json', {});

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const DEFAULTS = {
  enabled: true,
  channelId: '',
  timezone: 'Australia/Sydney',
  hour: 17,
  minute: 0,
  firstPostAt: '',
  catchUpHours: 6,
  retryMinutes: 10,
  maxRetries: 3,
};

function settings() {
  const cfg = { ...DEFAULTS, ...(extra.staffStatusPost || {}) };
  cfg.timezone = cfg.timezone || (extra.staffPoints && extra.staffPoints.timezone) || 'Australia/Sydney';
  return cfg;
}

const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function zoned(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
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

function offsetMs(ms, timeZone) {
  const z = zoned(ms, timeZone);
  return Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s) - Math.floor(ms / 1000) * 1000;
}

function wallToMs(y, m, d, h, mi, timeZone) {
  const wall = Date.UTC(y, m - 1, d, h, mi, 0);
  const guess = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(guess, timeZone);
}

function parseFirstPost(text, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const [, y, m, d, h, mi] = match.map(Number);
  return wallToMs(y, m, d, h, mi, timeZone);
}

function randomDayNextWeek(now, cfg, random = Math.random) {
  const z = zoned(now, cfg.timezone);
  const mondayOffset = 7 - z.dow;
  const pick = Math.floor(random() * 7);
  const base = Date.UTC(z.y, z.m - 1, z.d + mondayOffset + pick);
  const date = new Date(base);
  return wallToMs(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), cfg.hour, cfg.minute, cfg.timezone);
}

function schedule(now = Date.now(), random = Math.random) {
  const cfg = settings();
  const state = store.get('state') || {};

  if (state.nextAt) return state.nextAt;

  const first = parseFirstPost(cfg.firstPostAt, cfg.timezone);
  const firstUsable = first && !state.lastPostedAt && now - first <= cfg.catchUpHours * HOUR;

  const nextAt = firstUsable ? first : randomDayNextWeek(now, cfg, random);
  store.set('state', { ...state, nextAt, tries: 0 });
  return nextAt;
}

async function post(client) {
  const cfg = settings();
  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.() || !channel.guild) throw new Error('Status channel not found or not a text channel');

  const embed = await buildStaffEmbed(channel.guild);
  embed.setTitle('Weekly Staff Status').setFooter({ text: 'Live preview of the week so far. Nothing is applied until the weekly review runs.' });

  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

let running = false;

async function tick(client, now = Date.now(), random = Math.random) {
  const cfg = settings();
  if (!cfg.enabled || !/^\d{15,25}$/.test(String(cfg.channelId))) return false;
  if (running) return false;

  const nextAt = schedule(now, random);
  if (now < nextAt) return false;

  running = true;
  try {
    const state = store.get('state') || {};

    try {
      await post(client);
    } catch (err) {
      const tries = (state.tries || 0) + 1;
      console.error(`[staff status] post failed (try ${tries}):`, err.message);

      if (tries < cfg.maxRetries) {
        store.set('state', { ...state, nextAt: now + cfg.retryMinutes * MIN, tries });
        return false;
      }
    }

    const upcoming = randomDayNextWeek(now, cfg, random);
    store.set('state', { nextAt: upcoming, lastPostedAt: now, tries: 0 });
    console.log(`[staff status] next post: ${new Date(upcoming).toISOString()}`);
    return true;
  } finally {
    running = false;
  }
}

function start(client) {
  const run = () => tick(client).catch((err) => console.error('[staff status] tick failed:', err));
  setTimeout(run, 45 * 1000).unref?.();
  setInterval(run, MIN).unref?.();
}

module.exports = { start, tick, schedule, randomDayNextWeek, parseFirstPost, settings };
