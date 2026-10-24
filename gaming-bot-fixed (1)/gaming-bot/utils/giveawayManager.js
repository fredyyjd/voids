const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { COLOR } = require('./theme');
const { halfOfPrize } = require('./giveawayTotal');

// How long the two Split or Steal players have to pick before the
// one who didn't pick forfeits.
const SPLIT_STEAL_TIMEOUT_MS = 30 * 60 * 1000;

const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'giveaways.json');

// setTimeout only accepts a 32-bit signed int (~24.8 days) before it
// overflows and fires immediately. Giveaways can run up to 30 days, so
// long timers are chained instead of scheduled in one shot.
const MAX_TIMEOUT_MS = 2147483647;

function scheduleTimeout(callback, delay) {
  if (delay > MAX_TIMEOUT_MS) {
    return setTimeout(
      () => scheduleTimeout(callback, delay - MAX_TIMEOUT_MS),
      MAX_TIMEOUT_MS
    );
  }
  return setTimeout(callback, delay);
}


/* =========================================================
   STORAGE
========================================================= */

function loadGiveaways() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveGiveaways(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}


/* =========================================================
   DURATION HELPERS
========================================================= */

// Accepts "30s", "10m", "2h", "1d", "1w" and the long forms the giveaway
// form suggests: "10 minutes", "1 hour", "2 days", "1h 30m", "1d12h".
function parseDuration(str) {
  const cleaned = String(str || '')
    .toLowerCase()
    .replace(/\band\b|,/g, ' ')
    .trim();

  const unitMs = {
    s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
    m: 60 * 1000, min: 60 * 1000, mins: 60 * 1000, minute: 60 * 1000, minutes: 60 * 1000,
    h: 3600 * 1000, hr: 3600 * 1000, hrs: 3600 * 1000, hour: 3600 * 1000, hours: 3600 * 1000,
    d: 86400 * 1000, day: 86400 * 1000, days: 86400 * 1000,
    w: 7 * 86400 * 1000, wk: 7 * 86400 * 1000, wks: 7 * 86400 * 1000, week: 7 * 86400 * 1000, weeks: 7 * 86400 * 1000,
  };

  const matches = [...cleaned.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)];
  if (!matches.length) return null;

  // Anything left over once the matches are removed means junk in the input.
  if (cleaned.replace(/(\d+(?:\.\d+)?)\s*([a-z]+)/g, '').trim() !== '') return null;

  let total = 0;
  for (const [, num, unit] of matches) {
    if (!unitMs[unit]) return null;
    total += parseFloat(num) * unitMs[unit];
  }

  total = Math.round(total);
  return total > 0 ? total : null;
}


/* =========================================================
   EMBED / BUTTONS

   Layout:
     author   🎉 Giveaway
     ## prize
     description
     > Ends / Entries / Winners
     footer   Hosted by <name>
========================================================= */

const isSplitSteal = (giveaway) => giveaway.type === 'splitsteal';

function footerFor(giveaway) {
  if (!giveaway.hostName) return null;

  const footer = { text: `Hosted by ${giveaway.hostName}` };
  if (giveaway.hostAvatar) footer.iconURL = giveaway.hostAvatar;
  return footer;
}

const choiceLabel = (choice) =>
  choice === 'split' ? 'Split' : choice === 'steal' ? 'Steal' : 'No pick';

// The sentence that says how a Split or Steal turned out.
function describeOutcome(giveaway) {
  const ss = giveaway.splitSteal || {};
  const [a, b] = ss.players || [];
  const prize = giveaway.prize;
  const winner = (giveaway.winners || [])[0];
  const other = (ss.players || []).find((id) => id !== winner);

  switch (ss.outcome) {
    case 'split':
      return `🤝 <@${a}> and <@${b}> both picked **Split**. They each win **${halfOfPrize(prize)}**!`;
    case 'steal':
      return `😈 <@${winner}> picked **Steal** and takes the full **${prize}**! <@${other}> picked **Split** and gets nothing.`;
    case 'bothsteal':
      return `💥 <@${a}> and <@${b}> both picked **Steal**. Nobody wins anything!`;
    case 'forfeit':
      return `⏰ <@${other}> didn't pick in time, so <@${winner}> wins the full **${prize}**!`;
    case 'noshow':
      return '⏰ Neither player picked in time. Nobody wins.';
    case 'notenough':
      return 'Not enough entrants. Split or Steal needs at least 2 players.';
    default:
      return '';
  }
}

function buildGiveawayEmbed(giveaway) {
  const ended = !!giveaway.ended;
  const splitSteal = isSplitSteal(giveaway);
  const entries = (giveaway.entrants || []).length;

  const lines = [`## ${giveaway.prize}`];
  if (giveaway.description) lines.push(giveaway.description);

  if (!ended) {
    const ts = Math.floor(giveaway.endTimestamp / 1000);

    lines.push(
      '',
      `> **Ends:** <t:${ts}:R> (<t:${ts}:f>)`,
      splitSteal
        ? `> **Entries:** ${entries}   **Players:** 2`
        : `> **Entries:** ${entries}   **Winners:** ${giveaway.winnerCount}`,
      '',
      splitSteal
        ? 'Press the button to join! 2 people get picked to play **Split or Steal**.'
        : 'Press the button to join the giveaway!'
    );
  } else {
    const ts = Math.floor((giveaway.endedAt || giveaway.endTimestamp) / 1000);
    lines.push('', `> **Ended:** <t:${ts}:R> (<t:${ts}:f>)`);

    if (splitSteal) {
      const ss = giveaway.splitSteal || { players: [] };
      const [a, b] = ss.players;

      if (!a) {
        lines.push(`> **Entries:** ${entries}   **Players:** None`, '', describeOutcome(giveaway));
      } else {
        lines.push(`> **Entries:** ${entries}   **Players:** <@${a}> & <@${b}>`);

        if (!ss.resolved) {
          lines.push(
            '',
            `⏳ Waiting for both players to pick **Split** or **Steal** (<t:${Math.floor(ss.deadline / 1000)}:R>).`
          );
        } else {
          lines.push(
            `> <@${a}> picked **${choiceLabel(ss.choices[a])}**`,
            `> <@${b}> picked **${choiceLabel(ss.choices[b])}**`,
            '',
            describeOutcome(giveaway)
          );
        }
      }
    } else {
      const winners =
        giveaway.winners && giveaway.winners.length
          ? giveaway.winners.map((id) => `<@${id}>`).join(', ')
          : 'No valid entrants';

      lines.push(`> **Entries:** ${entries}   **Winners:** ${winners}`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({
      name: splitSteal
        ? ended ? '🤝 Split or Steal Ended' : '🤝 Split or Steal'
        : ended ? '🎉 Giveaway Ended' : '🎉 Giveaway',
    })
    .setDescription(lines.join('\n'));

  const footer = footerFor(giveaway);
  if (footer) embed.setFooter(footer);

  return embed;
}

function buildJoinRow(entrantCount = 0, disabled = false) {
  const button = new ButtonBuilder().setCustomId('giveaway_join');

  if (disabled) {
    button.setLabel('Giveaway Ended').setStyle(ButtonStyle.Secondary).setDisabled(true);
  } else {
    button.setLabel(`Join Giveaway (${entrantCount})`).setStyle(ButtonStyle.Primary);
  }

  return new ActionRowBuilder().addComponents(button);
}

// Shown ephemerally to a user right after they join, so they have a quick
// way to back out without hunting for a toggle on the public message.
function buildLeaveRow(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_leave_${messageId}`)
      .setLabel('Leave Giveaway')
      .setStyle(ButtonStyle.Danger)
  );
}

// The Claim Prize button. Once every winner has claimed it goes grey and
// says "Claimed".
function buildClaimRow(messageId, giveaway = {}) {
  const winners = giveaway.winners || [];
  const claimed = (giveaway.claimed || []).filter((id) => winners.includes(id));
  const allClaimed = winners.length > 0 && claimed.length >= winners.length;

  const button = new ButtonBuilder().setCustomId(`giveaway_prize_claim_${messageId}`);

  if (allClaimed) {
    button.setLabel('Claimed').setEmoji('✅').setStyle(ButtonStyle.Secondary).setDisabled(true);
  } else {
    const progress = winners.length > 1 && claimed.length ? ` (${claimed.length}/${winners.length})` : '';
    button.setLabel(`🎁 Claim Prize${progress}`).setStyle(ButtonStyle.Success);
  }

  return new ActionRowBuilder().addComponents(button);
}

// Fallback for players whose DMs are closed.
function buildOpenChoiceRow(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gwss_open_${messageId}`)
      .setLabel('Make your choice')
      .setStyle(ButtonStyle.Primary)
  );
}


/* =========================================================
   SPLIT OR STEAL - the choice prompt (sent by DM)
========================================================= */

function buildChoicePayload(messageId, giveaway, playerId) {
  const ss = giveaway.splitSteal;
  const opponent = ss.players.find((id) => id !== playerId);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Split or Steal!')
    .setDescription(
      [
        `You were picked for **${giveaway.prize}** against <@${opponent}>.`,
        '',
        'Pick **Split** to split the prize or **Steal** to steal the full prize.',
        'If you both pick **Steal**, no one gets anything.',
        '',
        `Pick before <t:${Math.floor(ss.deadline / 1000)}:R> or you forfeit.`,
      ].join('\n')
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gwss_steal_${messageId}`)
      .setLabel('Steal')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`gwss_split_${messageId}`)
      .setLabel('Split')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}


/* =========================================================
   WINNER SELECTION
========================================================= */

function pickWinners(entrants, count) {
  const pool = [...entrants];
  const winners = [];
  const num = Math.min(count, pool.length);

  for (let i = 0; i < num; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }

  return winners;
}


/* =========================================================
   LIVE COUNTDOWN REFRESH

   Discord's <t:...:F> tag DOES tick down on its own client-side, but if
   the message never gets edited some clients cache/stop refreshing it
   and it visually "sticks". We force a re-render every 9s so it never
   freezes, on top of the live client-side ticking.
========================================================= */

const refreshIntervals = new Map();

function stopCountdownRefresh(messageId) {
  const existing = refreshIntervals.get(messageId);
  if (existing) {
    clearInterval(existing);
    refreshIntervals.delete(messageId);
  }
}

function startCountdownRefresh(client, messageId) {
  stopCountdownRefresh(messageId);

  const interval = setInterval(async () => {
    const giveaways = loadGiveaways();
    const giveaway = giveaways[messageId];

    if (!giveaway || giveaway.ended || Date.now() >= giveaway.endTimestamp) {
      stopCountdownRefresh(messageId);
      return;
    }

    try {
      const channel = await client.channels.fetch(giveaway.channelId);
      const message = await channel.messages.fetch(messageId);

      await message.edit({
        embeds: [buildGiveawayEmbed(giveaway)],
        components: [buildJoinRow((giveaway.entrants || []).length)],
      });
    } catch (err) {
      console.error('Giveaway countdown refresh error:', err);
    }
  }, 9 * 1000);

  refreshIntervals.set(messageId, interval);
}


/* =========================================================
   END / SCHEDULE / REARM
========================================================= */

// Remembers where the Claim Prize message is so its button can be
// turned grey later.
function rememberClaimMessage(messageId, claimMessage) {
  const giveaways = loadGiveaways();
  if (!giveaways[messageId] || !claimMessage) return;

  giveaways[messageId].claimMessageId = claimMessage.id;
  giveaways[messageId].claimChannelId = claimMessage.channelId;
  saveGiveaways(giveaways);
}

// Re-draws the Claim Prize button (grey "Claimed" once everyone has claimed).
async function refreshClaimButton(client, messageId) {
  const giveaway = loadGiveaways()[messageId];
  if (!giveaway || !giveaway.claimMessageId) return;

  const channel = await client.channels
    .fetch(giveaway.claimChannelId || giveaway.channelId)
    .catch(() => null);
  const message = channel
    ? await channel.messages.fetch(giveaway.claimMessageId).catch(() => null)
    : null;

  if (message) {
    await message
      .edit({ components: [buildClaimRow(messageId, giveaway)] })
      .catch((err) => console.error('Failed to update claim button:', err.message));
  }
}

async function endGiveaway(client, messageId) {
  const giveaways = loadGiveaways();
  const giveaway = giveaways[messageId];
  if (!giveaway || giveaway.ended) return;

  stopCountdownRefresh(messageId);

  const entrants = Array.isArray(giveaway.entrants) ? giveaway.entrants : [];
  const splitSteal = isSplitSteal(giveaway);

  // Everything that decides the result happens here, in one synchronous
  // step, so nobody can join (or the giveaway end twice) while we're
  // waiting on Discord below.
  giveaway.ended = true;
  giveaway.endedAt = Date.now();

  if (splitSteal) {
    const players = entrants.length >= 2 ? pickWinners(entrants, 2) : [];

    giveaway.winners = [];
    giveaway.splitSteal = players.length
      ? { players, choices: {}, deadline: Date.now() + SPLIT_STEAL_TIMEOUT_MS, resolved: false }
      : { players: [], choices: {}, resolved: true, outcome: 'notenough' };
  } else {
    giveaway.winners = pickWinners(entrants, giveaway.winnerCount);
  }

  giveaways[messageId] = giveaway;
  saveGiveaways(giveaways);

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(messageId);

    await message.edit({
      embeds: [buildGiveawayEmbed(giveaway)],
      components: [buildJoinRow(entrants.length, true)],
    });

    if (splitSteal) {
      await startSplitSteal(client, channel, message, giveaway);
      return;
    }

    const winners = giveaway.winners;

    if (winners.length > 0) {
      const claimMessage = await channel.send({
        content: `Congratulations ${winners.map((id) => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`,
        components: [buildClaimRow(messageId, giveaway)],
      });

      rememberClaimMessage(messageId, claimMessage);
    } else {
      await channel.send({ content: `No one entered the giveaway for **${giveaway.prize}**.` });
    }
  } catch (err) {
    console.error('Failed to end giveaway:', err);
  }
}


/* =========================================================
   SPLIT OR STEAL

   When the giveaway ends, 2 entrants are picked. Each gets a DM
   with Steal / Split buttons.
     both Split         -> they each get half
     one Steal, one Split -> the stealer gets the full prize
     both Steal         -> nobody gets anything
   If one player doesn't pick in time they forfeit.
========================================================= */

async function sendChoiceDm(client, messageId, giveaway, playerId) {
  try {
    const user = await client.users.fetch(playerId);
    await user.send(buildChoicePayload(messageId, giveaway, playerId));
    return true;
  } catch {
    return false;
  }
}

async function startSplitSteal(client, channel, message, giveaway) {
  const messageId = message.id;
  const ss = giveaway.splitSteal;

  if (!ss.players.length) {
    await channel.send({
      content: `Not enough people entered **${giveaway.prize}**. Split or Steal needs at least 2 entrants.`,
    });
    return;
  }

  const failed = [];
  for (const playerId of ss.players) {
    const sent = await sendChoiceDm(client, messageId, giveaway, playerId);
    if (!sent) failed.push(playerId);
  }

  await channel.send({
    content:
      `🤝 ${ss.players.map((id) => `<@${id}>`).join(' and ')}, you were picked for **Split or Steal** (**${giveaway.prize}**)!\n` +
      (failed.length
        ? `I couldn't DM ${failed.map((id) => `<@${id}>`).join(' and ')}, press the button below to make your choice.`
        : 'Check your DMs and pick **Split** or **Steal**.') +
      `\nYou have until <t:${Math.floor(ss.deadline / 1000)}:R>.`,
    allowedMentions: { users: ss.players },
    components: failed.length ? [buildOpenChoiceRow(messageId)] : [],
  });

  scheduleTimeout(() => resolveSplitSteal(client, messageId), ss.deadline - Date.now());
}

async function resolveSplitSteal(client, messageId) {
  const giveaways = loadGiveaways();
  const giveaway = giveaways[messageId];
  const ss = giveaway && giveaway.splitSteal;
  if (!giveaway || !ss || ss.resolved) return;

  const [a, b] = ss.players;
  const choiceA = ss.choices[a];
  const choiceB = ss.choices[b];

  let winners = [];
  let outcome;

  if (choiceA && choiceB) {
    if (choiceA === 'split' && choiceB === 'split') {
      outcome = 'split';
      winners = [a, b];
    } else if (choiceA === 'steal' && choiceB === 'steal') {
      outcome = 'bothsteal';
    } else {
      outcome = 'steal';
      winners = [choiceA === 'steal' ? a : b];
    }
  } else if (choiceA || choiceB) {
    outcome = 'forfeit';
    winners = [choiceA ? a : b];
  } else {
    outcome = 'noshow';
  }

  ss.resolved = true;
  ss.outcome = outcome;
  giveaway.winners = winners;
  giveaway.payouts = {};
  for (const id of winners) {
    giveaway.payouts[id] = outcome === 'split' ? halfOfPrize(giveaway.prize) : giveaway.prize;
  }
  saveGiveaways(giveaways);

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(messageId).catch(() => null);

    if (message) {
      await message.edit({
        embeds: [buildGiveawayEmbed(giveaway)],
        components: [buildJoinRow((giveaway.entrants || []).length, true)],
      });
    }

    const payload = {
      content: describeOutcome(giveaway),
      allowedMentions: { users: ss.players },
      reply: message ? { messageReference: message.id, failIfNotExists: false } : undefined,
    };
    if (winners.length) payload.components = [buildClaimRow(messageId, giveaway)];

    const resultMessage = await channel.send(payload);
    if (winners.length) rememberClaimMessage(messageId, resultMessage);

    for (const playerId of ss.players) {
      const user = await client.users.fetch(playerId).catch(() => null);
      if (!user) continue;

      user
        .send(
          `${describeOutcome(giveaway)}` +
            (winners.includes(playerId) ? `\nPress **Claim Prize** in <#${giveaway.channelId}> to open a ticket.` : '')
        )
        .catch(() => {});
    }
  } catch (err) {
    console.error('Failed to finish split or steal:', err);
  }
}

function scheduleGiveaway(client, messageId, msUntilEnd) {
  scheduleTimeout(() => endGiveaway(client, messageId), msUntilEnd);
  startCountdownRefresh(client, messageId);
}

function rearmActiveGiveaways(client) {
  const giveaways = loadGiveaways();
  const now = Date.now();

  for (const [messageId, giveaway] of Object.entries(giveaways)) {
    // A Split or Steal that was waiting on picks when the bot went down.
    if (giveaway.ended) {
      const ss = giveaway.splitSteal;
      if (ss && !ss.resolved) {
        scheduleTimeout(() => resolveSplitSteal(client, messageId), Math.max(0, ss.deadline - now));
      }
      continue;
    }

    const msLeft = giveaway.endTimestamp - now;
    if (msLeft <= 0) {
      endGiveaway(client, messageId);
    } else {
      scheduleGiveaway(client, messageId, msLeft);
    }
  }
}


/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  loadGiveaways,
  saveGiveaways,
  parseDuration,
  buildGiveawayEmbed,
  buildJoinRow,
  buildLeaveRow,
  buildClaimRow,
  buildChoicePayload,
  describeOutcome,
  pickWinners,
  endGiveaway,
  resolveSplitSteal,
  refreshClaimButton,
  rememberClaimMessage,
  scheduleGiveaway,
  rearmActiveGiveaways,
};
