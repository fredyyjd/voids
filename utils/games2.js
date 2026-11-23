const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { box, priv } = require('./box');
const {
  sleep, rand, pick, nm, uid, shuffle, head,
  say, edit, winnerBox, lockFor, track, LOCK_SECONDS, run, collectMessages, lobby,
} = require('./gameKit');

/* =========================================================
   More games: word scramble, math race, reaction test,
   defuse the bomb, heads or tails, memory match
========================================================= */

const WORDS = [
  'diamond', 'creeper', 'netherite', 'spawner', 'obsidian', 'pickaxe', 'zombie', 'skeleton', 'enderman',
  'villager', 'emerald', 'redstone', 'minecart', 'portal', 'treasure', 'giveaway', 'champion', 'lightning',
  'discord', 'keyboard', 'server', 'warrior', 'dragon', 'volcano', 'rainbow', 'galaxy', 'pyramid', 'monster',
  'victory', 'jackpot', 'rocket', 'thunder', 'mystery', 'fortune', 'puzzle', 'camera', 'balloon', 'penguin',
];

const EMOJI_POOL = ['🍎', '🍌', '🍇', '🍒', '🍉', '🥝', '🍍', '🥕', '🌽', '🍔', '🍕', '🍩', '🍪', '⚽', '🏀', '🎸', '🚗', '🚀', '⭐', '🔥', '💎', '🎁', '👑', '🐸', '🐙', '🦊'];

function scramble(word) {
  let out = word;
  for (let i = 0; i < 10 && out === word; i++) out = shuffle(word.split('')).join('');
  return out;
}

// Ranks a score map and posts the final table. Returns the winner ids (ties allowed).
async function finishScores(channel, title, scores) {
  if (!scores.size) {
    await say(channel, [head(title), '😴 Nobody scored.']);
    return null;
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const medals = ['🥇', '🥈', '🥉'];
  const best = ranked[0][1];
  const winners = ranked.filter(([, s]) => s === best).map(([id]) => id);

  await say(channel, [
    head(title),
    '### 📊 Final scores',
    ranked.slice(0, 10).map(([id, s], i) => `${medals[i] || '▫️'} ${nm(id)} · **${s}**`).join('\n'),
  ]);

  await winnerBox(channel, winners.length > 1 ? 'Tied winners' : 'Winner', winners);
  return winners;
}

/* =========================================================
   1. Word scramble
========================================================= */

async function wordScramble(interaction) {
  return run(interaction, 'word-scramble', true, async () => {
    const channel = interaction.channel;
    const ROUNDS = 5;
    const scores = new Map();

    await interaction.reply({
      ...box([
        head('word scramble'),
        `> Unscramble the word. First to type it wins the round. **${ROUNDS} rounds.**`,
        `-# 🔒 Starting in ${LOCK_SECONDS}s`,
      ]),
      allowedMentions: { parse: [] },
    });

    const words = shuffle(WORDS).slice(0, ROUNDS);
    await lockFor(channel);

    for (let r = 0; r < ROUNDS; r++) {
      const word = words[r];
      await say(channel, [`### 🔤 Round ${r + 1}/${ROUNDS}`, `# \`${scramble(word)}\``, '-# ⏱️ 20 seconds']);

      const started = Date.now();
      let won = null;

      await collectMessages(channel, {
        time: 20000,
        max: 1,
        filter: (m) => !m.author.bot && m.content.trim().toLowerCase() === word,
        onCollect: (m) => {
          won = { id: m.author.id, ms: Date.now() - started };
          m.react('✅').catch(() => {});
        },
      });

      if (won) {
        scores.set(won.id, (scores.get(won.id) || 0) + 1);
        await say(channel, `✅ ${nm(won.id)} got **${word}** in **${(won.ms / 1000).toFixed(2)}s**`);
      } else {
        await say(channel, `⏰ Time's up. The word was **${word}**.`);
      }

      await sleep(2000);
    }

    await finishScores(channel, 'word scramble', scores);
  });
}

/* =========================================================
   2. Math race
========================================================= */

function mathQuestion(level) {
  const ops = level < 2 ? ['+', '-'] : level < 4 ? ['+', '-', '×'] : ['×', '+', '-'];
  const op = pick(ops);
  let a;
  let b;

  if (op === '×') {
    a = rand(3, 5 + level * 2);
    b = rand(3, 12);
  } else {
    a = rand(10, 30 + level * 25);
    b = rand(5, 25 + level * 15);
  }

  if (op === '-' && b > a) [a, b] = [b, a];
  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
  return { text: `${a} ${op} ${b}`, answer };
}

async function mathRace(interaction) {
  return run(interaction, 'math-race', true, async () => {
    const channel = interaction.channel;
    const ROUNDS = 6;
    const scores = new Map();

    await interaction.reply({
      ...box([
        head('math race'),
        `> Solve the sum. First correct answer wins the round. **${ROUNDS} rounds**, getting harder.`,
        `-# 🔒 Starting in ${LOCK_SECONDS}s`,
      ]),
      allowedMentions: { parse: [] },
    });

    await lockFor(channel);

    for (let r = 0; r < ROUNDS; r++) {
      const q = mathQuestion(r);
      await say(channel, [`### ➗ Round ${r + 1}/${ROUNDS}`, `# ${q.text} = ?`, '-# ⏱️ 20 seconds']);

      const started = Date.now();
      let won = null;

      await collectMessages(channel, {
        time: 20000,
        max: 1,
        filter: (m) => !m.author.bot && m.content.trim() === String(q.answer),
        onCollect: (m) => {
          won = { id: m.author.id, ms: Date.now() - started };
          m.react('✅').catch(() => {});
        },
      });

      if (won) {
        scores.set(won.id, (scores.get(won.id) || 0) + 1);
        await say(channel, `✅ ${nm(won.id)} solved it in **${(won.ms / 1000).toFixed(2)}s**`);
      } else {
        await say(channel, `⏰ Time's up. The answer was **${q.answer}**.`);
      }

      await sleep(2000);
    }

    await finishScores(channel, 'math race', scores);
  });
}

/* =========================================================
   3. Reaction test (buttons)
========================================================= */

async function reactionTest(interaction) {
  return run(interaction, 'reaction', false, async () => {
    const channel = interaction.channel;
    const ROUNDS = 5;

    const l = await lobby(interaction, {
      title: 'reaction test',
      rules: `wait for the button to turn green, then press it first. pressing early locks you out of the round. ${ROUNDS} rounds.`,
      min: 2,
      max: 30,
    });
    if (!l) return;

    const ids = new Set(l.players.map((p) => p.id));
    const scores = new Map();

    for (let r = 0; r < ROUNDS; r++) {
      const id = uid();
      const early = new Set();
      let winner = null;
      let goAt = 0;

      const row = (ready, off = false) =>
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`g:react:${id}`)
            .setLabel(ready ? 'PRESS NOW!' : 'Wait...')
            .setEmoji(ready ? '🟢' : '🔴')
            .setStyle(ready ? ButtonStyle.Success : ButtonStyle.Danger)
            .setDisabled(off)
        );

      const msg = await say(channel, [head('reaction test'), `### 🚦 Round ${r + 1}/${ROUNDS}`, 'Wait for green...'], {
        rows: [row(false)],
      });

      const col = track(msg.channelId, msg.createMessageComponentCollector({ time: 20000 }));

      col.on('collect', async (i) => {
        try {
          if (!ids.has(i.user.id)) return i.reply(priv(box("You're not in this game."))).catch(() => {});
          if (early.has(i.user.id)) return i.reply(priv(box("You pressed too early. You're out of this round."))).catch(() => {});

          if (!goAt) {
            early.add(i.user.id);
            return i.reply(priv(box('🚫 Too early! You are out of this round.'))).catch(() => {});
          }

          if (!winner) {
            winner = { id: i.user.id, ms: Date.now() - goAt };
            await i.deferUpdate().catch(() => {});
            col.stop('won');
          }
        } catch (err) {
          console.error('[games] reaction:', err);
        }
      });

      const ended = new Promise((resolve) => col.on('end', () => resolve()));

      await sleep(rand(2500, 7000));
      goAt = Date.now();
      await msg.edit(box([head('reaction test'), `### 🚦 Round ${r + 1}/${ROUNDS}`, '🟢 **GO! GO! GO!**'], { rows: [row(true)] })).catch(() => {});
      await ended;

      if (winner) {
        scores.set(winner.id, (scores.get(winner.id) || 0) + 1);
        await edit(msg, [
          head('reaction test'),
          `### 🚦 Round ${r + 1}/${ROUNDS}`,
          `⚡ ${nm(winner.id)} pressed it in **${winner.ms}ms**`,
          early.size ? `-# 🚫 Too early: ${[...early].map(nm).join(' ')}` : null,
        ]);
      } else {
        await edit(msg, [head('reaction test'), `### 🚦 Round ${r + 1}/${ROUNDS}`, '😴 Nobody pressed it.']);
      }

      await sleep(2000);
    }

    await finishScores(channel, 'reaction test', scores);
  });
}

/* =========================================================
   4. Defuse the bomb (wires)
========================================================= */

const WIRES = [
  ['red', '🔴', ButtonStyle.Danger],
  ['blue', '🔵', ButtonStyle.Primary],
  ['green', '🟢', ButtonStyle.Success],
  ['yellow', '🟡', ButtonStyle.Secondary],
];

async function defuse(interaction) {
  return run(interaction, 'defuse', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'defuse the bomb',
      rules: 'each round everyone cuts a wire. one wire is wired to the bomb and anyone who cut it is out. no cut also means out. last one standing wins.',
      min: 3,
      max: 30,
    });
    if (!l) return;

    let alive = new Set(l.players.map((p) => p.id));
    let round = 1;

    while (alive.size > 1) {
      const id = uid();
      const secs = 15;
      const cuts = new Map();
      const bad = pick(WIRES)[0];

      const row = () =>
        new ActionRowBuilder().addComponents(
          ...WIRES.map(([name, emoji, style]) =>
            new ButtonBuilder().setCustomId(`g:wire:${id}:${name}`).setLabel(name[0].toUpperCase() + name.slice(1)).setEmoji(emoji).setStyle(style)
          )
        );

      const view = () => [
        head('defuse the bomb'),
        `### 💣 Round ${round}`,
        'Cut a wire. One of them sets off the bomb.',
        `**✂️ Cut:** ${cuts.size}/${alive.size}`,
        `-# ⏱️ ${secs}s · 👥 ${alive.size} left`,
      ];

      const msg = await say(channel, view(), { rows: [row()] });

      await new Promise((resolve) => {
        const col = track(msg.channelId, msg.createMessageComponentCollector({ time: secs * 1000 }));

        col.on('collect', async (i) => {
          try {
            if (!alive.has(i.user.id)) return i.reply(priv(box("You're not in this round."))).catch(() => {});
            if (cuts.has(i.user.id)) return i.reply(priv(box('You already cut a wire.'))).catch(() => {});

            const wire = i.customId.split(':')[3];
            cuts.set(i.user.id, wire);
            await i.reply(priv(box(`✂️ You cut the **${wire}** wire. Wait for the others...`))).catch(() => {});
            await msg.edit(box(view(), { rows: [row()] })).catch(() => {});

            if (cuts.size === alive.size) col.stop('all');
          } catch (err) {
            console.error('[games] defuse:', err);
          }
        });

        col.on('end', () => resolve());
      });

      const out = [...alive].filter((uidd) => !cuts.has(uidd) || cuts.get(uidd) === bad);

      if (out.length === alive.size) {
        await edit(msg, [head('defuse the bomb'), `### 💣 Round ${round}`, `💥 The **${bad}** wire was the bomb, but everyone was out so the bomb was a dud. Nobody is out.`]);
      } else {
        out.forEach((x) => alive.delete(x));
        await edit(msg, [
          head('defuse the bomb'),
          `### 💣 Round ${round}`,
          `💥 The **${bad}** wire was the bomb!`,
          out.length ? `❌ **Out:** ${out.map(nm).join(' ')}` : '✅ Everyone survived!',
          `-# 👥 ${alive.size} left`,
        ]);
      }

      round++;
      await sleep(2500);
    }

    await winnerBox(channel, 'bomb defused', [...alive]);
  });
}

/* =========================================================
   5. Heads or tails elimination
========================================================= */

async function headsOrTails(interaction) {
  return run(interaction, 'heads-or-tails', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'heads or tails',
      rules: 'pick heads or tails each round. guess the flip wrong and you are out. last one standing wins.',
      min: 2,
      max: 40,
    });
    if (!l) return;

    let alive = new Set(l.players.map((p) => p.id));
    let round = 1;

    while (alive.size > 1) {
      const id = uid();
      const secs = 12;
      const picks = new Map();

      const row = () =>
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`g:ht:${id}:heads`).setLabel('Heads').setEmoji('🪙').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`g:ht:${id}:tails`).setLabel('Tails').setEmoji('🦅').setStyle(ButtonStyle.Secondary)
        );

      const view = () => [
        head('heads or tails'),
        `### 🪙 Round ${round}`,
        'Heads or tails?',
        `**Picked:** ${picks.size}/${alive.size}`,
        `-# ⏱️ ${secs}s · 👥 ${alive.size} left`,
      ];

      const msg = await say(channel, view(), { rows: [row()] });

      await new Promise((resolve) => {
        const col = track(msg.channelId, msg.createMessageComponentCollector({ time: secs * 1000 }));

        col.on('collect', async (i) => {
          try {
            if (!alive.has(i.user.id)) return i.reply(priv(box("You're not in this round."))).catch(() => {});
            if (picks.has(i.user.id)) return i.reply(priv(box('You already picked.'))).catch(() => {});

            picks.set(i.user.id, i.customId.split(':')[3]);
            await i.reply(priv(box(`You picked **${picks.get(i.user.id)}**.`))).catch(() => {});
            await msg.edit(box(view(), { rows: [row()] })).catch(() => {});

            if (picks.size === alive.size) col.stop('all');
          } catch (err) {
            console.error('[games] heads or tails:', err);
          }
        });

        col.on('end', () => resolve());
      });

      await edit(msg, [head('heads or tails'), `### 🪙 Round ${round}`, '🌀 Flipping the coin...']);
      await sleep(2000);

      const flip = pick(['heads', 'tails']);
      const survivors = [...alive].filter((x) => picks.get(x) === flip);
      const out = [...alive].filter((x) => picks.get(x) !== flip);

      if (!survivors.length) {
        await edit(msg, [head('heads or tails'), `### 🪙 Round ${round}`, `It landed **${flip}**. Nobody got it right, so everyone stays.`]);
      } else {
        alive = new Set(survivors);
        await edit(msg, [
          head('heads or tails'),
          `### 🪙 Round ${round}`,
          `It landed on **${flip}** ${flip === 'heads' ? '🪙' : '🦅'}`,
          out.length ? `❌ **Out:** ${out.map(nm).join(' ')}` : '✅ Everyone got it right!',
          `-# 👥 ${alive.size} left`,
        ]);
      }

      round++;
      await sleep(2500);
    }

    await winnerBox(channel, 'lucky winner', [...alive]);
  });
}

/* =========================================================
   6. Memory match (type the emojis you saw)
========================================================= */

async function memoryMatch(interaction) {
  return run(interaction, 'memory-match', true, async () => {
    const channel = interaction.channel;
    const ROUNDS = 5;
    const scores = new Map();

    await interaction.reply({
      ...box([
        head('memory match'),
        `> Memorise the emojis, then type them back in order. First correct answer wins the round. **${ROUNDS} rounds**, getting longer.`,
        `-# 🔒 Starting in ${LOCK_SECONDS}s`,
      ]),
      allowedMentions: { parse: [] },
    });

    await lockFor(channel);

    for (let r = 0; r < ROUNDS; r++) {
      const len = 3 + r;
      const seq = shuffle(EMOJI_POOL).slice(0, len);
      const show = seq.join(' ');
      const secs = Math.max(3, 6 - Math.floor(r / 2));

      const msg = await say(channel, [`### 🧩 Round ${r + 1}/${ROUNDS}`, `# ${show}`, `-# 👀 Memorise it! Hiding in ${secs}s`]);
      await sleep(secs * 1000);
      await edit(msg, [`### 🧩 Round ${r + 1}/${ROUNDS}`, '# ❓ ❓ ❓', '-# ⌨️ Type the emojis in order! (20 seconds)']);

      const normalise = (s) => s.replace(/\s+/g, '');
      const target = normalise(seq.join(''));
      const started = Date.now();
      let won = null;

      await collectMessages(channel, {
        time: 20000,
        max: 1,
        filter: (m) => !m.author.bot && normalise(m.content) === target,
        onCollect: (m) => {
          won = { id: m.author.id, ms: Date.now() - started };
          m.react('✅').catch(() => {});
        },
      });

      if (won) {
        scores.set(won.id, (scores.get(won.id) || 0) + 1);
        await say(channel, `✅ ${nm(won.id)} remembered **${show}** in **${(won.ms / 1000).toFixed(2)}s**`);
      } else {
        await say(channel, `⏰ Time's up. It was ${show}`);
      }

      await sleep(2000);
    }

    await finishScores(channel, 'memory match', scores);
  });
}

module.exports = { wordScramble, mathRace, reactionTest, defuse, headsOrTails, memoryMatch };
