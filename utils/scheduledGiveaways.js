const extra = require('../extraConfig');
const createStore = require('./jsonStore');
const {
  loadGiveaways,
  saveGiveaways,
  buildGiveawayEmbed,
  buildJoinRow,
  scheduleGiveaway,
} = require('./giveawayManager');
const { addGiveawayPrize } = require('./giveawayTotal');

/* =========================================================
   SCHEDULED GIVEAWAYS
   daily  = every Saturday, one giveaway per entry in durationsDays, all posted
            at once (they end 1, 2, 3, 4, 5 days later), one winner each.
   weekly = every Saturday, one bigger giveaway.
   Settings: extraConfig.js -> scheduledGiveaways.
   They are normal giveaways (same join button, winner message and Claim Prize
   button with the claim time), so /giveaway end and reroll work on them too.
========================================================= */

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// data/scheduled_giveaways.json: job -> date it last posted (stops double posts after a restart)
const state = createStore('scheduled_giveaways.json', {});

const validId = (id) => typeof id === 'string' && /^\d{15,25}$/.test(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function settings() {
  return extra.scheduledGiveaways || {};
}

// Day of week, date and minutes since midnight in the configured timezone.
function zonedNow(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );

  return {
    dow: DAYS.indexOf(parts.weekday),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

async function postGiveaway(client, channel, { prize, winnerCount, ms, claimMinutes, kind, content }) {
  const giveaway = {
    type: 'giveaway',
    prize,
    description: null,
    winnerCount: winnerCount || 1,
    claimMs: claimMinutes ? claimMinutes * MIN : null,
    startedAt: Date.now(),
    endTimestamp: Date.now() + ms,
    channelId: channel.id,
    guildId: channel.guildId,
    hostName: client.user.username,
    hostAvatar: client.user.displayAvatarURL(),
    entrants: [],
    ended: false,
    isScheduled: true,
    scheduleKind: kind,
  };

  const message = await channel.send({
    content: content?.text,
    embeds: [buildGiveawayEmbed(giveaway)],
    components: [buildJoinRow(0)],
    allowedMentions: content?.allowedMentions || { parse: [] },
  });

  const giveaways = loadGiveaways();
  giveaways[message.id] = giveaway;
  saveGiveaways(giveaways);
  scheduleGiveaway(client, message.id, ms);

  // Counts toward the "Total Given" channel.
  addGiveawayPrize(client, channel.guildId, prize);
  return message;
}

async function fetchChannel(client, id) {
  if (!validId(id)) return null;
  const channel = await client.channels.fetch(id).catch(() => null);
  return channel && channel.isTextBased() ? channel : null;
}

// The role is pinged once, on the first giveaway of the batch.
const pingContent = (roleId) =>
  validId(roleId) ? { text: `<@&${roleId}>`, allowedMentions: { roles: [roleId] } } : null;

async function runDaily(client, cfg) {
  const channel = await fetchChannel(client, cfg.channelId);
  if (!channel) return console.warn('[giveaways] daily channel not found, check scheduledGiveaways.daily.channelId');

  const durations = (cfg.durationsDays || []).filter((d) => d > 0);
  for (let i = 0; i < durations.length; i++) {
    await postGiveaway(client, channel, {
      prize: cfg.prize,
      winnerCount: cfg.winnerCount,
      ms: durations[i] * DAY,
      claimMinutes: cfg.claimMinutes,
      kind: 'daily',
      content: i === 0 ? pingContent(cfg.pingRoleId) : null,
    }).catch((err) => console.error('[giveaways] daily post failed:', err.message));

    if (i < durations.length - 1) await sleep(1500);
  }
  console.log(`[giveaways] posted ${durations.length} daily giveaways.`);
}

async function runWeekly(client, cfg) {
  const channel = await fetchChannel(client, cfg.channelId);
  if (!channel) return console.warn('[giveaways] weekly channel not found, check scheduledGiveaways.weekly.channelId');

  await postGiveaway(client, channel, {
    prize: cfg.prize,
    winnerCount: cfg.winnerCount,
    ms: (cfg.durationDays || 7) * DAY,
    claimMinutes: cfg.claimMinutes,
    kind: 'weekly',
    content: pingContent(cfg.pingRoleId),
  }).catch((err) => console.error('[giveaways] weekly post failed:', err.message));
  console.log('[giveaways] posted the weekly giveaway.');
}

const JOBS = [
  { key: 'daily', run: runDaily },
  { key: 'weekly', run: runWeekly },
];

let ticking = false;

async function tick(client) {
  if (ticking) return;
  ticking = true;

  try {
    const all = settings();
    const timeZone = all.timezone || 'Australia/Sydney';
    const catchUp = all.catchUpMinutes ?? 30;
    const now = zonedNow(timeZone);

    for (const job of JOBS) {
      const cfg = all[job.key];
      if (!cfg || !cfg.enabled) continue;

      const target = cfg.hour * 60 + cfg.minute;
      if (now.dow !== cfg.day) continue;
      if (now.minutes < target || now.minutes - target > catchUp) continue;
      if (state.get(job.key) === now.dateKey) continue;

      // Marked before posting so a slow post (or a restart) can't post it twice.
      state.set(job.key, now.dateKey);
      await job.run(client, cfg).catch((err) => console.error(`[giveaways] ${job.key} failed:`, err));
    }
  } finally {
    ticking = false;
  }
}

function startScheduledGiveaways(client) {
  const all = settings();
  if (!all.daily?.enabled && !all.weekly?.enabled) return;

  tick(client);
  setInterval(() => tick(client).catch((err) => console.error('[giveaways] tick failed:', err)), 30 * 1000).unref?.();
  console.log('[giveaways] scheduled giveaways armed.');
}

module.exports = { startScheduledGiveaways, zonedNow };
