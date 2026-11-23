const { EmbedBuilder } = require('discord.js');
const economy = require('./economy');
const { COLOR } = require('./theme');
const { BOOST_CHANNEL_ID, BOOST_ROLE_ID, ACTIVITY, COUNTING, ACHIEVEMENT_REWARD } = require('./economyConfig');

const MAX_TIMEOUT_MS = 2147483647;

let timer = null;

async function post(client, payload) {
  const channel = await client.channels.fetch(BOOST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const sent = await channel.send(payload).catch((err) => {
    console.error('[2x vb] could not post:', err.message);
    return null;
  });

  return Boolean(sent);
}

function startPayload(endsAt) {
  const lines = [
    '## ⚡  2x VB is on now!',
    `Every ${ACTIVITY.everyMessages} messages used to give **${ACTIVITY.reward} VB**, now it gives **${ACTIVITY.reward * 2} VB**.`,
    `Every achievement used to give **${ACHIEVEMENT_REWARD} VB**, now it gives **${ACHIEVEMENT_REWARD * 2} VB**.`,
    `Every count used to give **${COUNTING.reward} VB**, now it gives **${COUNTING.reward * 2} VB**.`,
    `The daily chat limit also doubles, from **${ACTIVITY.dailyCapVb} VB** to **${ACTIVITY.dailyCapVb * 2} VB**.`,
    '',
    endsAt ? `Ends <t:${Math.floor(endsAt / 1000)}:R>.` : 'It stays on until staff turn it off.',
  ];

  return {
    content: `<@&${BOOST_ROLE_ID}>`,
    embeds: [new EmbedBuilder().setColor(COLOR).setDescription(lines.join('\n'))],
    allowedMentions: { roles: [BOOST_ROLE_ID] },
  };
}

function endPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setDescription('## ⚡  2x VB has ended\nVB rewards are back to normal. Thanks for being active!'),
    ],
    allowedMentions: { parse: [] },
  };
}

function arm(client) {
  if (timer) clearTimeout(timer);
  timer = null;

  const state = economy.boostState();
  if (!state.on || !state.endsAt) return;

  const left = state.endsAt - Date.now();

  if (left <= 0) {
    stop(client).catch(() => {});
    return;
  }

  timer = setTimeout(() => (left > MAX_TIMEOUT_MS ? arm(client) : stop(client).catch(() => {})), Math.min(left, MAX_TIMEOUT_MS));
  timer.unref?.();
}

async function start(client, hours) {
  const endsAt = hours ? Date.now() + hours * 60 * 60 * 1000 : null;
  economy.setBoost(true, endsAt);
  arm(client);
  return post(client, startPayload(endsAt));
}

async function stop(client) {
  if (timer) clearTimeout(timer);
  timer = null;

  const wasOn = economy.boostState().on;
  economy.setBoost(false);

  if (!wasOn) return false;
  return post(client, endPayload());
}

module.exports = { start, stop, arm };
