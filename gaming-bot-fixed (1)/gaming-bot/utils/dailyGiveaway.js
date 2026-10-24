const config = require('../config.json');
const {
  loadGiveaways,
  saveGiveaways,
  buildGiveawayEmbed,
  buildJoinRow,
  endGiveaway,
} = require('./giveawayManager');
const { addGiveawayPrize } = require('./giveawayTotal');

const DAY_MS = 24 * 60 * 60 * 1000;

function getZoneOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour === '24' ? 0 : parts.hour,
    parts.minute,
    parts.second
  );
  return (asUTC - date.getTime()) / 60000;
}

function getNextRunTimestamp(hour, minute, timeZone) {
  const now = new Date();
  const offsetMinutes = getZoneOffsetMinutes(now, timeZone);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(now).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  let targetUTC =
    Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0) - offsetMinutes * 60000;
  if (targetUTC <= now.getTime()) {
    targetUTC += DAY_MS;
  }
  return targetUTC;
}

async function postDailyGiveaway(client) {
  const settings = config.dailyGiveaway;
  if (!settings || !settings.enabled) return;

  const channelId = settings.channelId;
  if (!channelId || channelId.startsWith('PUT_')) {
    console.warn('Daily giveaway is enabled but dailyGiveaway.channelId is not set in config.json.');
    return;
  }

  // End any still-running daily giveaway first, so the winner message always
  // goes out before the next giveaway is posted (no more racing timers).
  const existing = loadGiveaways();
  for (const [id, g] of Object.entries(existing)) {
    if (g.isDaily && !g.ended) {
      await endGiveaway(client, id);
    }
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.warn('Daily giveaway channel could not be found.');
    return;
  }

  const prize = settings.prize || '3m Donut SMP';
  const winnerCount = settings.winnerCount || 1;
  const endTimestamp = Date.now() + DAY_MS;

  const giveaway = {
    prize,
    winnerCount,
    endTimestamp,
    channelId: channel.id,
    guildId: channel.guildId,
    hostName: client.user.username,
    hostAvatar: client.user.displayAvatarURL(),
    entrants: [],
    ended: false,
    isDaily: true,
  };

  const embed = buildGiveawayEmbed(giveaway);

  const messageAbove = settings.messageAbove || '@everyone';

  const message = await channel
    .send({
      content: messageAbove,
      embeds: [embed],
      components: [buildJoinRow(0)],
    })
    .catch(() => null);

  if (!message) return;

  if (settings.messageBelow) {
    await channel.send({ content: settings.messageBelow }).catch(() => {});
  }

  const giveaways = loadGiveaways();
  giveaways[message.id] = giveaway;
  saveGiveaways(giveaways);

  // Counts toward the "Total Given" voice channel (/gw total).
  addGiveawayPrize(client, channel.guildId, prize);

  // This giveaway's own endTimestamp (stored above, and shown in the embed's
  // countdown) is what actually drives ending it — via the timer below. That
  // timer is re-derived from this same stored endTimestamp every time the
  // bot boots (see startDailyGiveawayLoop), so a restart can never leave the
  // countdown finished while nothing actually ends it.
  scheduleEndAndRepost(client, endTimestamp - Date.now());
}

function scheduleEndAndRepost(client, msUntilEnd) {
  setTimeout(() => {
    // postDailyGiveaway() ends the now-due giveaway first, then posts the
    // next one — same guarantee as before: winner message, then next giveaway.
    postDailyGiveaway(client);
  }, Math.max(0, msUntilEnd));
}

function findActiveDailyGiveaway() {
  const giveaways = loadGiveaways();
  for (const [id, giveaway] of Object.entries(giveaways)) {
    if (giveaway.isDaily && !giveaway.ended) return { id, giveaway };
  }
  return null;
}

function startDailyGiveawayLoop(client) {
  const settings = config.dailyGiveaway;
  if (!settings || !settings.enabled) return;

  const active = findActiveDailyGiveaway();

  if (active) {
    const msLeft = active.giveaway.endTimestamp - Date.now();
    if (msLeft <= 0) {
      // Already overdue (e.g. the bot was down past its end time) — end it
      // and post the next one right away instead of waiting.
      postDailyGiveaway(client);
    } else {
      console.log(`Resuming daily giveaway — ending/reposting in ${Math.round(msLeft / 1000)}s.`);
      scheduleEndAndRepost(client, msLeft);
    }
    return;
  }

  // No daily giveaway running at all yet (first ever run) — start fresh at
  // the configured time of day. Every cycle after this one is driven by the
  // stored endTimestamp above, not this hour/minute target.
  const hour = settings.hour ?? 23;
  const minute = settings.minute ?? 0;
  const timeZone = settings.timezone || 'Australia/Sydney';

  const nextRun = getNextRunTimestamp(hour, minute, timeZone);
  const msUntilNext = nextRun - Date.now();

  console.log(
    `First daily giveaway scheduled for ${new Date(nextRun).toLocaleString('en-AU', {
      timeZone,
    })} (${timeZone}).`
  );

  setTimeout(() => {
    postDailyGiveaway(client);
  }, msUntilNext);
}

module.exports = { startDailyGiveawayLoop };
