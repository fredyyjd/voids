const economy = require('./economy');
const { box } = require('./box');
const { ACHIEVEMENT_CHANNEL_ID, FOOTER } = require('./economyConfig');

// The achievement leaderboard that stays at the bottom of the achievements channel.
// Whenever something new is posted there it is deleted and sent again underneath.

const MEDALS = ['🥇', '🥈', '🥉'];

function payload() {
  const { ACHIEVEMENTS } = require('./achievements'); // loaded here to avoid a require loop
  const top = economy.topByAchievements(10);

  const lines = top.length
    ? top.map((e, i) => `${MEDALS[i] || `**${i + 1}.**`}  <@${e.id}>  ·  **${e.achievements}** / ${ACHIEVEMENTS.length}`)
    : ['Nobody has unlocked an achievement yet.'];

  return {
    ...box(['## 🏆  Achievement Leaderboard', lines.join('\n'), `-# Ranked by achievements unlocked  ·  ${FOOTER}`]),
    allowedMentions: { parse: [] },
  };
}

async function channelOf(client) {
  const channel = await client.channels.fetch(ACHIEVEMENT_CHANNEL_ID).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function repost(client) {
  const channel = await channelOf(client);
  if (!channel) return;

  const oldId = economy.achBoard().messageId;
  const sent = await channel.send(payload());
  economy.setAchBoardMessage(sent.id);
  if (oldId) await channel.messages.delete(oldId).catch(() => {});
}

// Waits a moment so a burst of messages only moves the board once.
let timer = null;
let running = false;
let again = false;

async function run(client) {
  if (running) {
    again = true;
    return;
  }

  running = true;
  try {
    await repost(client);
  } catch (err) {
    console.error('[achievements] could not update the leaderboard:', err.message);
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(client, 1000);
    }
  }
}

function schedule(client, delayMs = 2500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    run(client);
  }, delayMs);
  timer.unref?.();
}

// On startup: make sure the board exists and is the last message in the channel.
async function ensure(client) {
  const channel = await channelOf(client);
  if (!channel) return;

  const id = economy.achBoard().messageId;
  const last = await channel.messages.fetch({ limit: 1 }).catch(() => null);
  if (id && last?.first()?.id === id) return;

  schedule(client, 1000);
}

module.exports = { payload, schedule, ensure };
