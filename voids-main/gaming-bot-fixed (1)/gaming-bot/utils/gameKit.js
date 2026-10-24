const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { box, priv } = require('./box');
const config = require('../config.json');

/* =========================================================
   Shared helpers for the mini games
========================================================= */

// channelId -> { name, typing }. One game per channel at a time.
const active = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nm = (id) => `<@${id}>`;
const uid = () => Math.random().toString(36).slice(2, 8);

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- games channel ---------- */

function gamesChannelId() {
  const id = config.gamesChannelId;
  return id && !String(id).startsWith('PUT_') ? String(id) : null;
}

function typingActive(channelId) {
  return Boolean(active.get(channelId)?.typing);
}

// Games channel rule: if no typing game is running, delete whatever gets typed.
async function enforceGamesChannel(message) {
  const id = gamesChannelId();
  if (!id || message.channelId !== id) return false;
  if (typingActive(id)) return false;

  if (
    config.gamesChannelStaffBypass &&
    message.member?.permissions?.has('ManageMessages')
  ) {
    return false;
  }

  await message.delete().catch(() => {});
  return true;
}

/* ---------- sending ---------- */

// Plain flat box. `users` = who is allowed to be pinged by it.
function say(channel, parts, { rows = [], users = [] } = {}) {
  return channel.send({
    ...box(parts, { rows }),
    allowedMentions: { parse: [], users },
  });
}

const edit = (msg, parts, rows = []) => msg.edit(box(parts, { rows })).catch(() => {});

function winnerBox(channel, title, ids) {
  const list = ids.map(nm).join(' ');
  return say(channel, [`## 🏆 ${title}`, list || 'nobody'], { users: ids });
}

/* ---------- running a game ---------- */

// Checks channel rules, registers the game, always cleans up.
async function run(interaction, name, typing, fn) {
  const only = gamesChannelId();

  if (only && interaction.channelId !== only) {
    return interaction.reply(priv(box(`❌ Games are played in <#${only}>.`)));
  }

  if (active.has(interaction.channelId)) {
    return interaction.reply(priv(box('❌ A game is already running in this channel.')));
  }

  active.set(interaction.channelId, { name, typing });

  try {
    await fn();
  } catch (err) {
    console.error(`[games] ${name} crashed:`, err);
    await say(interaction.channel, '❌ The game crashed.').catch(() => {});
  } finally {
    active.delete(interaction.channelId);
  }
}

// Message collector as a promise (resolves when it ends).
function collectMessages(channel, { filter, time, max, onCollect }) {
  return new Promise((resolve) => {
    const col = channel.createMessageCollector({ filter, time, max });
    col.on('collect', (m) => onCollect && onCollect(m, col));
    col.on('end', () => resolve());
  });
}

/* ---------- lobby ---------- */

function lobbyRow(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`g:join:${id}`).setLabel('Join').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`g:start:${id}`).setLabel('Start').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
}

// Everyone joins with a button. Host can start early. Returns { players, msg } or null.
async function lobby(interaction, { title, rules, seconds = 30, min = 2, max = 40 }) {
  const id = interaction.id;
  const players = new Map([[interaction.user.id, interaction.user]]);
  const endTs = Math.floor(Date.now() / 1000) + seconds;

  const view = (off) =>
    box(
      [
        `## ${title}`,
        rules,
        `**players (${players.size})** ${[...players.keys()].map(nm).join(' ')}`,
        off ? null : `-# starts <t:${endTs}:R> · host can press start`,
      ],
      { rows: off ? [] : [lobbyRow(id)] }
    );

  await interaction.reply({ ...view(false), allowedMentions: { parse: [] } });
  const msg = await interaction.fetchReply();

  await new Promise((resolve) => {
    const col = msg.createMessageComponentCollector({ time: seconds * 1000 });

    col.on('collect', async (i) => {
      try {
        if (i.customId === `g:join:${id}`) {
          if (players.has(i.user.id)) {
            return i.reply(priv(box("You're already in."))).catch(() => {});
          }
          if (players.size >= max) {
            return i.reply(priv(box('The lobby is full.'))).catch(() => {});
          }
          players.set(i.user.id, i.user);
          return i.update(view(false)).catch(() => {});
        }

        if (i.customId === `g:start:${id}`) {
          if (i.user.id !== interaction.user.id) {
            return i.reply(priv(box('Only the host can start.'))).catch(() => {});
          }
          await i.deferUpdate().catch(() => {});
          col.stop('start');
        }
      } catch (err) {
        console.error('[games] lobby:', err);
      }
    });

    col.on('end', () => resolve());
  });

  if (players.size < min) {
    await edit(msg, [`## ${title}`, `❌ needs at least ${min} players`]);
    return null;
  }

  await msg.edit(view(true)).catch(() => {});
  return { players: [...players.values()], msg };
}

/* =========================================================
   Rock paper scissors (shared by /rps and the tournament)
========================================================= */

const RPS_EMOJI = { rock: '🪨', paper: '📄', scissors: '✂️' };
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

function rpsRow(id) {
  return new ActionRowBuilder().addComponents(
    ...Object.keys(RPS_EMOJI).map((c) =>
      new ButtonBuilder()
        .setCustomId(`g:rps:${id}:${c}`)
        .setEmoji(RPS_EMOJI[c])
        .setLabel(c)
        .setStyle(ButtonStyle.Secondary)
    )
  );
}

// Plays one match between two users. Returns { winner, tie }.
// replayTies: keep going until somebody wins (tournament).
async function rpsMatch(channel, a, b, { seconds = 30, replayTies = false, header = '' } = {}) {
  for (;;) {
    const id = uid();
    const picks = new Map();

    const msg = await channel.send({
      ...box([`${header}${nm(a.id)} vs ${nm(b.id)}`, `-# pick below · ${seconds}s`], { rows: [rpsRow(id)] }),
      allowedMentions: { parse: [], users: [a.id, b.id] },
    });

    await new Promise((resolve) => {
      const col = msg.createMessageComponentCollector({ time: seconds * 1000 });

      col.on('collect', async (i) => {
        try {
          if (i.user.id !== a.id && i.user.id !== b.id) {
            return i.reply(priv(box("This isn't your match."))).catch(() => {});
          }
          if (picks.has(i.user.id)) {
            return i.reply(priv(box('You already picked.'))).catch(() => {});
          }

          const choice = i.customId.split(':')[3];
          picks.set(i.user.id, choice);
          await i.reply(priv(box(`You picked ${RPS_EMOJI[choice]}`))).catch(() => {});

          if (picks.size === 2) col.stop('done');
        } catch (err) {
          console.error('[games] rps:', err);
        }
      });

      col.on('end', () => resolve());
    });

    const pa = picks.get(a.id);
    const pb = picks.get(b.id);

    let winner = null;
    let tie = false;
    let note = '';

    if (!pa && !pb) {
      winner = replayTies ? pick([a, b]) : null;
      note = replayTies ? 'nobody picked, coin flip' : 'nobody picked';
    } else if (!pa) {
      winner = b;
      note = 'no pick = forfeit';
    } else if (!pb) {
      winner = a;
      note = 'no pick = forfeit';
    } else if (pa === pb) {
      tie = true;
    } else {
      winner = RPS_BEATS[pa] === pb ? a : b;
    }

    const shown = (p) => (p ? RPS_EMOJI[p] : '💤');
    const result = winner
      ? `**winner:** ${nm(winner.id)}`
      : tie
        ? "**it's a tie**"
        : '**no winner**';

    await edit(msg, [
      `${header}${nm(a.id)} ${shown(pa)}  vs  ${shown(pb)} ${nm(b.id)}`,
      result,
      note ? `-# ${note}` : null,
    ]);

    if (winner || !replayTies) return { winner, tie };

    await say(channel, 'tie, go again');
    await sleep(1000);
  }
}

module.exports = {
  active,
  sleep,
  rand,
  pick,
  nm,
  uid,
  shuffle,
  gamesChannelId,
  typingActive,
  enforceGamesChannel,
  say,
  edit,
  winnerBox,
  run,
  collectMessages,
  lobby,
  rpsMatch,
  RPS_EMOJI,
};
