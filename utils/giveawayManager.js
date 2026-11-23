const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { COLOR } = require('./theme');
const economy = require('./economy');
const { FOOTER: VB_FOOTER, ITEMS: SHOP_ITEMS, MAX_EXTRA_PER_GIVEAWAY } = require('./economyConfig');
const { giveableKeys, itemLabel, grantItem, applyRole } = require('./shopItems');
const { halfOfPrize } = require('./giveawayTotal');
const staffStore = require('./staffStore');

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

const isVb = (giveaway) => giveaway.type === 'vb';

const isShop = (giveaway) => giveaway.type === 'shop';

const hasVbFooter = (giveaway) => isVb(giveaway) || isShop(giveaway);

function footerFor(giveaway) {
  if (!giveaway.hostName) return hasVbFooter(giveaway) ? { text: VB_FOOTER } : null;

  const footer = { text: `Hosted by ${giveaway.hostName}${hasVbFooter(giveaway) ? `  ·  ${VB_FOOTER}` : ''}` };
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
      return `🤝 <@${a}> & <@${b}> split **${halfOfPrize(prize)}** each!`;
    case 'steal':
      return `😈 <@${winner}> stole **${prize}**!`;
    case 'bothsteal':
      return `💥 Both stole. Nobody wins.`;
    case 'forfeit':
      return `⏰ <@${other}> didn't pick. <@${winner}> wins **${prize}**!`;
    case 'noshow':
      return '⏰ Nobody picked. No winner.';
    case 'notenough':
      return 'Not enough entrants.';
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
      giveaway.claimMs ? `> **Claim time:** ${formatDuration(giveaway.claimMs)}` : null,
      '',
      splitSteal
        ? 'Press the button to join!'
        : 'Press the button to join the giveaway!'
    );
    // the optional claim line leaves a null when unused
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i] === null) lines.splice(i, 1);
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
            `⏳ Waiting for picks (<t:${Math.floor(ss.deadline / 1000)}:R>)`
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
        : isVb(giveaway)
          ? ended ? '💰 VB Giveaway Ended' : '💰 VB Giveaway'
          : isShop(giveaway)
          ? ended ? 'Economy Giveaway Ended' : 'Economy Giveaway'
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

/* ---------- claim time ---------- */

function formatDuration(ms) {
  const units = [['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];
  const out = [];
  let left = ms;
  for (const [label, size] of units) {
    const n = Math.floor(left / size);
    if (n > 0) {
      out.push(`${n}${label}`);
      left -= n * size;
    }
  }
  return out.slice(0, 2).join(' ') || '0s';
}

const claimExpired = (giveaway) =>
  Boolean(giveaway.claimDeadline) && Date.now() >= giveaway.claimDeadline;

function unclaimedWinners(giveaway) {
  const claimed = giveaway.claimed || [];
  return (giveaway.winners || []).filter((id) => !claimed.includes(id));
}

// The text of the claim message: the original congratulations plus a status line.
function buildClaimContent(giveaway, base) {
  const lines = [base || ''];
  const claimed = (giveaway.claimed || []).filter((id) => (giveaway.winners || []).includes(id));
  const left = unclaimedWinners(giveaway);

  if (claimed.length) {
    lines.push('', ...claimed.map((id) => `✅ <@${id}> **claimed** their prize`));
  }

  if (left.length && giveaway.claimDeadline) {
    if (claimExpired(giveaway)) {
      lines.push('', `⏰ **Claim Time Up** · ${left.map((id) => `<@${id}>`).join(' ')} didn't claim in time`);
    } else {
      lines.push('', `-# ⏳ Claim before <t:${Math.floor(giveaway.claimDeadline / 1000)}:R>`);
    }
  }

  return lines.join('\n').slice(0, 2000);
}

// The Claim Prize button. Once every winner has claimed it goes grey and
// says "Claimed". If the claim time runs out it goes grey and says "Claim Time Up".
function buildClaimRow(messageId, giveaway = {}) {
  const winners = giveaway.winners || [];
  const claimed = (giveaway.claimed || []).filter((id) => winners.includes(id));
  const allClaimed = winners.length > 0 && claimed.length >= winners.length;

  const button = new ButtonBuilder().setCustomId(`giveaway_prize_claim_${messageId}`);

  if (allClaimed) {
    button.setLabel('Claimed').setEmoji('✅').setStyle(ButtonStyle.Secondary).setDisabled(true);
  } else if (claimExpired(giveaway)) {
    button.setLabel('Claim Time Up').setEmoji('⏰').setStyle(ButtonStyle.Secondary).setDisabled(true);
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
        `**${giveaway.prize}** vs <@${opponent}>`,
        `Pick <t:${Math.floor(ss.deadline / 1000)}:R> or you forfeit.`,
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
   SHOP GIVEAWAY PRIZES
========================================================= */

function buildPickRow(messageId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`shopgw_pick_${messageId}`)
      .setPlaceholder('Pick your item')
      .addOptions(
        giveableKeys().map((key) => {
          const item = SHOP_ITEMS[key];
          const name = ['colour', 'role'].includes(item.type) ? `${item.name} ${item.type}` : item.name;

          return {
            label: name.slice(0, 100),
            value: key,
            description: String(item.desc || '').slice(0, 100),
            emoji: item.emoji,
          };
        })
      )
  );
}

function buildPickContent(giveaway) {
  const winners = giveaway.winners || [];
  const picks = giveaway.picks || {};
  const mentions = winners.map((id) => `<@${id}>`).join(', ');

  const lines = [
    `🎉 Congratulations ${mentions}! ${winners.length > 1 ? 'You each get' : 'You get'} to pick one item from the shop.`,
    'Choose below and it goes straight into your inventory.',
  ];

  const picked = winners.filter((id) => picks[id]);
  if (picked.length) lines.push('', ...picked.map((id) => `<@${id}> picked **${itemLabel(picks[id])}**`));

  return lines.join('\n').slice(0, 2000);
}

const WHERE_TEXT = {
  colour: 'It is already yours. Wear it from `/inv`.',
  role: 'The role is on your name now.',
  badge: 'It shows next to your name in `/achievements`.',
  pass: 'It is used for you when you count while on cooldown.',
  box: 'The box was opened for you, see below.',
  entry: 'It is already in your inventory. Press Join again on a giveaway you are in to use it.',
};

async function announceShopGiveaway(channel, messageId, giveaway) {
  const winners = giveaway.winners;

  if (giveaway.prizeKind === 'item') {
    const item = SHOP_ITEMS[giveaway.itemKey];
    const grants = giveaway.grants || {};

    for (const id of winners) {
      if (grants[id]?.addRole) await applyRole(channel.guild, id, grants[id].addRole);
    }

    const lines = [
      `🎉 Congratulations ${winners.map((id) => `<@${id}>`).join(', ')}! ` +
        `You won **${giveaway.prize}**${winners.length > 1 ? ' each' : ''}.`,
      WHERE_TEXT[item?.type] || WHERE_TEXT.entry,
    ];

    for (const id of winners) {
      if (grants[id]?.refunded) {
        lines.push(`<@${id}> already owned it, so they got **${economy.fmt(grants[id].refunded)}** instead.`);
      } else if (grants[id]?.note) {
        lines.push(`<@${id}> opened it and got ${grants[id].note}.`);
      }
    }

    await channel.send({ content: lines.join('\n').slice(0, 2000), allowedMentions: { users: winners } });
    return;
  }

  const pickMessage = await channel.send({
    content: buildPickContent(giveaway),
    components: [buildPickRow(messageId)],
    allowedMentions: { users: winners },
  });

  const giveaways = loadGiveaways();
  if (giveaways[messageId]) {
    giveaways[messageId].pickMessageId = pickMessage.id;
    giveaways[messageId].pickChannelId = pickMessage.channelId;
    saveGiveaways(giveaways);
  }
}


/* =========================================================
   WINNER SELECTION
========================================================= */

// `extra` holds a person's id once for every extra entry they used on this giveaway.
const extraUsed = (giveaway, userId) => (giveaway.extra || []).filter((id) => id === userId).length;

// Every extra entry used adds one more chance (a base chance of 1, up to +3).
function pickWinners(entrants, count, extra = []) {
  const bonus = new Map();
  for (const id of extra || []) bonus.set(id, Math.min((bonus.get(id) || 0) + 1, MAX_EXTRA_PER_GIVEAWAY));

  const pool = [...entrants];
  const winners = [];
  const num = Math.min(count, pool.length);

  for (let i = 0; i < num; i++) {
    const weights = pool.map((id) => 1 + (bonus.get(id) || 0));
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);

    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      roll -= weights[idx];
      if (roll < 0) break;
    }

    winners.push(pool.splice(idx, 1)[0]);
  }

  return winners;
}


// What someone sees when they press Join. Handles the extra entry choice.
function buildAlreadyJoinedPayload(messageId, giveaway, userId, { justJoined = false, notice = null } = {}) {
  const used = extraUsed(giveaway, userId);
  const extras = economy.peek(userId).extra;
  const price = SHOP_ITEMS.extra_entry.price;
  const max = MAX_EXTRA_PER_GIVEAWAY;

  const leave = new ButtonBuilder()
    .setCustomId(`giveaway_leave_${messageId}`)
    .setLabel('Leave Giveaway')
    .setStyle(ButtonStyle.Danger);

  const head = justJoined ? 'You joined the giveaway! Good luck.' : 'You already joined this giveaway.';
  const lines = [];
  const buttons = [];

  if (notice) lines.push(notice, '');
  lines.push(head);

  if (used > 0) lines.push('', `🎟️ Extra entries used here: **${used} / ${max}**  ·  **${1 + used}×** chance`);

  if (used >= max) {
    lines.push('', 'You have used the most extra entries allowed on one giveaway.', 'Do you want to leave?');
    buttons.push(leave);
  } else if (extras > 0) {
    lines.push(
      '',
      `You have **${extras}** extra ${extras === 1 ? 'entry' : 'entries'} in your inventory.`,
      `Do you want to **use one** (+1 chance, up to ${max} per giveaway) or **leave**?`
    );
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`giveaway_extra_${messageId}`)
        .setLabel(`Use Extra Entry (${used}/${max})`)
        .setEmoji('🎟️')
        .setStyle(ButtonStyle.Primary),
      leave
    );
  } else {
    lines.push(
      '',
      `Want better odds? Buy an **Extra Giveaway Entry** for **${price} VB** in \`/item shop\`. You can use up to **${max}** on one giveaway.`
    );
    buttons.push(leave);
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(justJoined ? '🎉  You\'re in' : '🎉  Already joined')
        .setDescription(lines.join('\n'))
        .setFooter({ text: VB_FOOTER }),
    ],
    components: [new ActionRowBuilder().addComponents(...buttons)],
  };
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
// updated later. If the giveaway has a claim time, the countdown starts now.
function rememberClaimMessage(messageId, claimMessage) {
  const giveaways = loadGiveaways();
  if (!giveaways[messageId] || !claimMessage) return;

  const giveaway = giveaways[messageId];
  giveaway.claimMessageId = claimMessage.id;
  giveaway.claimChannelId = claimMessage.channelId;
  giveaway.claimBase = claimMessage.content || giveaway.claimBase || '';

  const timed = Boolean(giveaway.claimMs) && !giveaway.claimDeadline;
  if (timed) giveaway.claimDeadline = Date.now() + giveaway.claimMs;

  saveGiveaways(giveaways);

  if (timed && claimMessage.client) {
    refreshClaimButton(claimMessage.client, messageId);
    armClaimExpiry(claimMessage.client, messageId);
  }
}

// Re-draws the claim message: status text plus the button
// (grey "Claimed" once everyone has claimed, grey "Claim Time Up" when time runs out).
async function refreshClaimButton(client, messageId) {
  const giveaways = loadGiveaways();
  const giveaway = giveaways[messageId];
  if (!giveaway || !giveaway.claimMessageId) return;

  const channel = await client.channels
    .fetch(giveaway.claimChannelId || giveaway.channelId)
    .catch(() => null);
  const message = channel
    ? await channel.messages.fetch(giveaway.claimMessageId).catch(() => null)
    : null;

  if (!message) return;

  // Older claim messages weren't saving their text, so keep it now.
  if (giveaway.claimBase === undefined) {
    giveaway.claimBase = message.content || '';
  }

  if (claimExpired(giveaway) && unclaimedWinners(giveaway).length) giveaway.claimExpiredShown = true;
  saveGiveaways(giveaways);

  await message
    .edit({
      content: buildClaimContent(giveaway, giveaway.claimBase),
      components: [buildClaimRow(messageId, giveaway)],
      allowedMentions: { parse: [] },
    })
    .catch((err) => console.error('Failed to update claim button:', err.message));
}

// Greys the button out when the claim time runs out.
function armClaimExpiry(client, messageId) {
  const giveaway = loadGiveaways()[messageId];
  if (!giveaway || !giveaway.claimDeadline) return;

  const wait = Math.max(0, giveaway.claimDeadline - Date.now()) + 500;
  scheduleTimeout(() => refreshClaimButton(client, messageId), wait);
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
    const players = entrants.length >= 2 ? pickWinners(entrants, 2, giveaway.extra) : [];

    giveaway.winners = [];
    giveaway.splitSteal = players.length
      ? { players, choices: {}, deadline: Date.now() + SPLIT_STEAL_TIMEOUT_MS, resolved: false }
      : { players: [], choices: {}, resolved: true, outcome: 'notenough' };
  } else {
    giveaway.winners = pickWinners(entrants, giveaway.winnerCount, giveaway.extra);

    // VB prizes are paid straight away, in the same step the winners are picked.
    if (isVb(giveaway) && !giveaway.paid) {
      for (const id of giveaway.winners) economy.addVb(id, giveaway.vbAmount);
      giveaway.paid = true;
    }

    if (isShop(giveaway) && !giveaway.paid) {
      if (giveaway.prizeKind === 'item') {
        giveaway.grants = {};
        for (const id of giveaway.winners) {
          giveaway.grants[id] = grantItem(id, giveaway.itemKey, giveaway.amount || 1);
        }
      } else {
        giveaway.picks = {};
      }
      giveaway.paid = true;
    }
  }

  giveaways[messageId] = giveaway;
  saveGiveaways(giveaways);

  try {
    staffStore.recordGiveaway(giveaway, messageId);
  } catch (err) {
    console.error('[staff] could not record giveaway:', err);
  }

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

    if (isVb(giveaway) && winners.length > 0) {
      await channel.send({
        content:
          `🎉 Congratulations ${winners.map((id) => `<@${id}>`).join(', ')}! ` +
          `You won **${giveaway.prize}**${winners.length > 1 ? ' each' : ''}.\n` +
          'It is already in your balance. Check it with `/inv` and spend it in `/item shop`.',
        allowedMentions: { users: winners },
      });
      return;
    }

    if (isShop(giveaway) && winners.length > 0) {
      await announceShopGiveaway(channel, messageId, giveaway);
      return;
    }

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
      content: `Not enough entrants for **${giveaway.prize}**.`,
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
      `🤝 ${ss.players.map((id) => `<@${id}>`).join(' & ')} picked! ` +
      (failed.length
        ? `Can't DM ${failed.map((id) => `<@${id}>`).join(' & ')}, use the button.`
        : 'Check your DMs.'),
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
            (winners.includes(playerId) ? `\nClaim in <#${giveaway.channelId}>.` : '')
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

      // Claim time that was running when the bot went down.
      if (giveaway.claimDeadline && !giveaway.claimExpiredShown && unclaimedWinners(giveaway).length) {
        armClaimExpiry(client, messageId);
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
  buildAlreadyJoinedPayload,
  extraUsed,
  buildClaimRow,
  buildChoicePayload,
  describeOutcome,
  pickWinners,
  endGiveaway,
  grantShopItem: grantItem,
  buildPickRow,
  buildPickContent,
  itemLabel,
  resolveSplitSteal,
  refreshClaimButton,
  rememberClaimMessage,
  claimExpired,
  formatDuration,
  scheduleGiveaway,
  rearmActiveGiveaways,
};
