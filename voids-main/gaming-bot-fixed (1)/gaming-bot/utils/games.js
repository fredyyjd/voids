const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { box, priv } = require('./box');
const {
  sleep, rand, pick, nm, uid, shuffle,
  say, edit, winnerBox, awardPrize, run, collectMessages, lobby, rpsMatch,
} = require('./gameKit');

/* =========================================================
   Content
========================================================= */

const SENTENCES = [
  'the quick brown fox jumps over the lazy dog',
  'pack my box with five dozen liquor jugs',
  'a journey of a thousand miles begins with one step',
  'never gonna let a creeper blow up my base',
  'diamonds are found deep underground near lava',
  'the best way to predict the future is to build it',
  'sphinx of black quartz judge my vow',
  'keep calm and farm more spawners',
  'fortune favors the bold and the patient',
  'every expert was once a complete beginner',
  'how vexingly quick daft zebras jump',
  'the night is dark and full of zombies',
  'speed is nothing without a little accuracy',
  'sunrise over the ocean looks better than any screen',
  'bright vixens jump while dozy fowl quack',
  'typing fast is easy until the timer starts',
  'a small spark can start a very big fire',
  'trust the process and ignore the lag',
  'the cake is a lie but the loot is real',
  'always carry a water bucket in the nether',
];

const TRIVIA = [
  ['What is the capital of Australia?', 'Canberra', ['Sydney', 'Melbourne', 'Perth']],
  ['How many players are on a soccer team on the field?', '11', ['9', '10', '12']],
  ['Which planet is known as the Red Planet?', 'Mars', ['Venus', 'Jupiter', 'Mercury']],
  ['What is the hardest natural substance?', 'Diamond', ['Gold', 'Quartz', 'Iron']],
  ['How many sides does a hexagon have?', '6', ['5', '7', '8']],
  ['Which ocean is the largest?', 'Pacific', ['Atlantic', 'Indian', 'Arctic']],
  ['What gas do plants absorb from the air?', 'Carbon dioxide', ['Oxygen', 'Nitrogen', 'Helium']],
  ['In Minecraft, what do you need to craft a pickaxe besides sticks?', 'Planks, cobblestone or ore', ['Wool', 'Glass', 'Sand']],
  ['Which mob explodes in Minecraft?', 'Creeper', ['Zombie', 'Skeleton', 'Enderman']],
  ['What is 12 x 12?', '144', ['124', '132', '154']],
  ['How many continents are there?', '7', ['5', '6', '8']],
  ['What is the chemical symbol for gold?', 'Au', ['Ag', 'Gd', 'Go']],
  ['Which animal is the largest on Earth?', 'Blue whale', ['African elephant', 'Giraffe', 'Great white shark']],
  ['How many minutes are in a day?', '1440', ['1240', '1640', '1400']],
  ['Which country invented pizza?', 'Italy', ['France', 'Greece', 'Spain']],
  ['What is the square root of 81?', '9', ['8', '7', '11']],
  ['Which dimension has ghasts in Minecraft?', 'The Nether', ['The End', 'The Overworld', 'The Aether']],
  ['What is the fastest land animal?', 'Cheetah', ['Lion', 'Horse', 'Leopard']],
  ['Which planet has the most visible rings?', 'Saturn', ['Mars', 'Earth', 'Neptune']],
  ['What do bees make?', 'Honey', ['Silk', 'Wax only', 'Nectar']],
  ['How many strings does a standard guitar have?', '6', ['4', '5', '7']],
  ['What is H2O commonly known as?', 'Water', ['Salt', 'Peroxide', 'Acid']],
  ['What year did Minecraft officially release (1.0)?', '2011', ['2009', '2013', '2015']],
  ['Which is the smallest prime number?', '2', ['0', '1', '3']],
  ['What is the largest desert in the world (including polar)?', 'Antarctica', ['Sahara', 'Gobi', 'Arabian']],
  ['Which language has the most native speakers?', 'Mandarin Chinese', ['English', 'Spanish', 'Hindi']],
  ['How many bones are in the adult human body?', '206', ['186', '216', '256']],
  ['What is the boiling point of water in Celsius?', '100', ['90', '110', '120']],
  ['Who painted the Mona Lisa?', 'Leonardo da Vinci', ['Michelangelo', 'Raphael', 'Van Gogh']],
  ['What is the tallest mountain above sea level?', 'Mount Everest', ['K2', 'Kilimanjaro', 'Denali']],
];

const TITLE = (t) => `## ${t}`;

/* =========================================================
   1. Last to stop typing
========================================================= */

async function lastTyper(interaction) {
  return run(interaction, 'last-typer', true, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'last to stop typing',
      rules: 'send a message before every timer ends. miss one and you are out. last one typing wins.',
      min: 2,
      max: 30,
    });
    if (!l) return;

    const alive = new Set(l.players.map((p) => p.id));
    let secs = 12;
    let round = 1;
    let allMissed = 0;

    while (alive.size > 1) {
      const sent = new Set();
      const end = Math.floor(Date.now() / 1000) + secs;

      await say(channel, [`**round ${round}** · send a message <t:${end}:R>`, `-# ${alive.size} left`]);

      await collectMessages(channel, {
        time: secs * 1000,
        filter: (m) => !m.author.bot && alive.has(m.author.id),
        onCollect: (m) => sent.add(m.author.id),
      });

      const out = [...alive].filter((id) => !sent.has(id));

      if (out.length === alive.size) {
        allMissed++;
        if (allMissed >= 2) {
          await say(channel, ['## game over', 'nobody was typing, no winner.']);
          return;
        }
        await say(channel, 'everyone missed, nobody is out this round.');
      } else {
        allMissed = 0;
        out.forEach((id) => alive.delete(id));
        if (out.length) await say(channel, `❌ out: ${out.map(nm).join(' ')}`);
      }

      secs = Math.max(5, secs - 1);
      round++;
      await sleep(1500);
    }

    await winnerBox(channel, 'last one typing', [...alive]);
  });
}

/* =========================================================
   2. Closest to the number (1 - 1000)
========================================================= */

async function closest(interaction) {
  return run(interaction, 'closest', true, async () => {
    const channel = interaction.channel;
    const secret = rand(1, 1000);
    const secs = 30;
    const end = Math.floor(Date.now() / 1000) + secs;
    const guesses = new Map();

    await interaction.reply({
      ...box([
        TITLE('closest to the number'),
        'i picked a number from **1 to 1000**. type one guess. closest wins.',
        `-# ends <t:${end}:R> · your guess gets hidden`,
      ]),
      allowedMentions: { parse: [] },
    });

    await collectMessages(channel, {
      time: secs * 1000,
      filter: (m) => !m.author.bot && /^\d{1,4}$/.test(m.content.trim()) && !guesses.has(m.author.id),
      onCollect: (m) => {
        const n = parseInt(m.content.trim(), 10);
        if (n < 1 || n > 1000) return;
        guesses.set(m.author.id, { n, at: m.createdTimestamp });
        m.delete().catch(() => {});
      },
    });

    if (!guesses.size) {
      return say(channel, [TITLE('closest to the number'), `nobody guessed. it was **${secret}**.`]);
    }

    const ranked = [...guesses.entries()]
      .map(([id, g]) => ({ id, ...g, diff: Math.abs(g.n - secret) }))
      .sort((a, b) => a.diff - b.diff || a.at - b.at);

    const lines = ranked.slice(0, 10).map((r, i) => `${i + 1}. ${nm(r.id)} · ${r.n} (off by ${r.diff})`);

    await say(channel, [TITLE('closest to the number'), `the number was **${secret}**`, lines.join('\n')], {
      users: [ranked[0].id],
    });
    await winnerBox(channel, 'closest guess', [ranked[0].id]);
  });
}

/* =========================================================
   3. Elimination roulette
========================================================= */

async function roulette(interaction) {
  return run(interaction, 'roulette', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'elimination roulette',
      rules: 'one player is eliminated every round. last one left wins.',
      min: 3,
      max: 40,
    });
    if (!l) return;

    let alive = [...l.players];
    const status = await say(channel, [TITLE('elimination roulette'), 'spinning...']);

    while (alive.length > 1) {
      await sleep(3000);
      const [dead] = alive.splice(rand(0, alive.length - 1), 1);

      await edit(status, [
        TITLE('elimination roulette'),
        `🔫 ${nm(dead.id)} was eliminated`,
        `**left (${alive.length})** ${alive.map((p) => nm(p.id)).join(' ')}`,
      ]);
    }

    await winnerBox(channel, 'last one standing', [alive[0].id]);
  });
}

/* =========================================================
   4. Boat racing
========================================================= */

async function boats(interaction) {
  return run(interaction, 'boats', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'boat race',
      rules: 'every round each boat moves forward. press paddle once per round for a boost. first to the finish wins.',
      min: 2,
      max: 12,
    });
    if (!l) return;

    const LEN = 20;
    const racers = l.players.map((p) => ({ user: p, pos: 0 }));
    const paddled = new Set();
    const id = uid();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`g:paddle:${id}`).setLabel('Paddle').setEmoji('🚣').setStyle(ButtonStyle.Primary)
    );

    const track = () =>
      '```\n' +
      racers
        .map((r) => {
          const p = Math.min(r.pos, LEN);
          const name = r.user.username.slice(0, 10).padEnd(10);
          return `${name} |${'-'.repeat(p)}>${'.'.repeat(LEN - p)}|`;
        })
        .join('\n') +
      '\n```';

    const msg = await say(channel, [TITLE('boat race'), track(), '-# press paddle for a boost each round'], {
      rows: [row],
    });

    const col = msg.createMessageComponentCollector({ time: 4 * 60 * 1000 });
    col.on('collect', async (i) => {
      if (!racers.some((r) => r.user.id === i.user.id)) {
        return i.reply(priv(box("You're not in this race."))).catch(() => {});
      }
      paddled.add(i.user.id);
      i.deferUpdate().catch(() => {});
    });

    let winners = [];

    for (let round = 0; round < 60 && !winners.length; round++) {
      await sleep(2500);

      for (const r of racers) {
        r.pos += rand(0, 2) + (paddled.has(r.user.id) ? 1 : 0);
      }
      paddled.clear();

      const top = Math.max(...racers.map((r) => r.pos));
      if (top >= LEN) winners = racers.filter((r) => r.pos === top);

      await edit(msg, [TITLE('boat race'), track(), winners.length ? null : '-# press paddle for a boost each round'],
        winners.length ? [] : [row]);
    }

    col.stop('done');
    await winnerBox(channel, 'race winner', [pick(winners.length ? winners : racers).user.id]);
  });
}

/* =========================================================
   5. Rock paper scissors tournament
========================================================= */

async function rpsTournament(interaction) {
  return run(interaction, 'rps-tournament', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'rock paper scissors tournament',
      rules: 'knockout rounds. win your match to move on. ties are replayed.',
      min: 2,
      max: 16,
    });
    if (!l) return;

    let alive = shuffle(l.players);
    let round = 1;

    while (alive.length > 1) {
      await say(channel, [`## round ${round}`, `${alive.length} players left`]);

      const pairs = [];
      let bye = null;
      for (let i = 0; i < alive.length; i += 2) {
        if (alive[i + 1]) pairs.push([alive[i], alive[i + 1]]);
        else bye = alive[i];
      }

      if (bye) await say(channel, `${nm(bye.id)} gets a bye`);

      const results = await Promise.all(
        pairs.map(([a, b]) => rpsMatch(channel, a, b, { replayTies: true, header: `round ${round} · ` }))
      );

      alive = results.map((r) => r.winner);
      if (bye) alive.push(bye);
      alive = shuffle(alive);
      round++;
      await sleep(1500);
    }

    await winnerBox(channel, 'champion', [alive[0].id]);
  });
}

/* =========================================================
   6. Hot potato
========================================================= */

async function hotPotato(interaction) {
  return run(interaction, 'hot-potato', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'hot potato',
      rules: 'whoever holds the potato when it blows up is out. press pass to throw it to someone random.',
      min: 3,
      max: 30,
    });
    if (!l) return;

    let alive = [...l.players];

    while (alive.length > 1) {
      let holder = pick(alive);
      const fuse = rand(10, 25) * 1000;
      const id = uid();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`g:pass:${id}`).setLabel('Pass').setEmoji('🥔').setStyle(ButtonStyle.Danger)
      );

      const view = () => [TITLE('hot potato'), `🥔 ${nm(holder.id)} has it`, `-# ${alive.length} players left`];

      const msg = await say(channel, view(), { rows: [row], users: [holder.id] });

      await new Promise((resolve) => {
        const col = msg.createMessageComponentCollector({ time: fuse });

        col.on('collect', async (i) => {
          try {
            if (i.user.id !== holder.id) {
              return i.reply(priv(box("You don't have the potato."))).catch(() => {});
            }
            holder = pick(alive.filter((p) => p.id !== holder.id));
            await i.update(box(view(), { rows: [row] })).catch(() => {});
            channel.send({ content: nm(holder.id), allowedMentions: { users: [holder.id] } })
              .then((m) => setTimeout(() => m.delete().catch(() => {}), 1500))
              .catch(() => {});
          } catch (err) {
            console.error('[games] potato:', err);
          }
        });

        col.on('end', () => resolve());
      });

      await edit(msg, [TITLE('hot potato'), `💥 ${nm(holder.id)} blew up`]);
      alive = alive.filter((p) => p.id !== holder.id);
      await sleep(2000);
    }

    await winnerBox(channel, 'survivor', [alive[0].id]);
  });
}

/* =========================================================
   7. Typing race
========================================================= */

async function typingRace(interaction) {
  return run(interaction, 'typing-race', true, async () => {
    const channel = interaction.channel;
    const ROUNDS = 5;
    const scores = new Map();

    await interaction.reply({
      ...box([TITLE('typing race'), `${ROUNDS} rounds. first to type the sentence exactly wins the round.`, '-# starting in 5s']),
      allowedMentions: { parse: [] },
    });

    const sentences = shuffle(SENTENCES).slice(0, ROUNDS);
    await sleep(5000);

    for (let r = 0; r < ROUNDS; r++) {
      const target = sentences[r];
      // zero width spaces so copy and paste doesn't match
      const shown = target.split(' ').join(' \u200b');

      await say(channel, [`**round ${r + 1}/${ROUNDS}**`, `\`${shown}\``]);
      const started = Date.now();
      let won = null;

      await collectMessages(channel, {
        time: 25000,
        max: 1,
        filter: (m) => !m.author.bot && m.content.trim().toLowerCase() === target,
        onCollect: (m) => {
          won = { id: m.author.id, ms: Date.now() - started };
        },
      });

      if (won) {
        scores.set(won.id, (scores.get(won.id) || 0) + 1);
        await say(channel, `${nm(won.id)} got it in **${(won.ms / 1000).toFixed(2)}s**`);
      } else {
        await say(channel, 'nobody got it.');
      }

      await sleep(2000);
    }

    if (!scores.size) return say(channel, [TITLE('typing race'), 'nobody scored.']);

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const best = ranked[0][1];
    const winners = ranked.filter(([, s]) => s === best).map(([id]) => id);

    await say(channel, [TITLE('typing race'), ranked.map(([id, s], i) => `${i + 1}. ${nm(id)} · ${s}`).join('\n')]);
    await winnerBox(channel, winners.length > 1 ? 'tied winners' : 'winner', winners);
  });
}

/* =========================================================
   8. Trivia knockout
========================================================= */

async function trivia(interaction) {
  return run(interaction, 'trivia', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'trivia knockout',
      rules: 'answer with the buttons. wrong or no answer and you are out.',
      min: 2,
      max: 40,
    });
    if (!l) return;

    const alive = new Set(l.players.map((p) => p.id));
    const questions = shuffle(TRIVIA).slice(0, 15);
    const LETTERS = ['A', 'B', 'C', 'D'];

    for (let q = 0; q < questions.length && alive.size > 1; q++) {
      const [text, right, wrong] = questions[q];
      const options = shuffle([right, ...wrong]);
      const answerIdx = options.indexOf(right);
      const id = uid();
      const secs = 15;
      const end = Math.floor(Date.now() / 1000) + secs;
      const answers = new Map();

      const row = new ActionRowBuilder().addComponents(
        options.map((_, i) =>
          new ButtonBuilder().setCustomId(`g:tq:${id}:${i}`).setLabel(LETTERS[i]).setStyle(ButtonStyle.Secondary)
        )
      );

      const msg = await say(
        channel,
        [
          `**question ${q + 1}** · ${alive.size} left`,
          text,
          options.map((o, i) => `**${LETTERS[i]}.** ${o}`).join('\n'),
          `-# ends <t:${end}:R>`,
        ],
        { rows: [row] }
      );

      await new Promise((resolve) => {
        const col = msg.createMessageComponentCollector({ time: secs * 1000 });

        col.on('collect', async (i) => {
          try {
            if (!alive.has(i.user.id)) {
              return i.reply(priv(box("You're not in this round."))).catch(() => {});
            }
            if (answers.has(i.user.id)) {
              return i.reply(priv(box('You already answered.'))).catch(() => {});
            }
            answers.set(i.user.id, parseInt(i.customId.split(':')[3], 10));
            await i.reply(priv(box(`Locked in **${LETTERS[answers.get(i.user.id)]}**`))).catch(() => {});
            if ([...alive].every((u) => answers.has(u))) col.stop('all');
          } catch (err) {
            console.error('[games] trivia:', err);
          }
        });

        col.on('end', () => resolve());
      });

      const wrongIds = [...alive].filter((u) => answers.get(u) !== answerIdx);

      let result = `answer: **${LETTERS[answerIdx]}. ${right}**`;
      if (wrongIds.length === alive.size) {
        result += '\neveryone missed it, nobody is out.';
      } else {
        wrongIds.forEach((u) => alive.delete(u));
        if (wrongIds.length) result += `\n❌ out: ${wrongIds.map(nm).join(' ')}`;
      }

      await edit(msg, [`**question ${q + 1}**`, text, result]);
      await sleep(2500);
    }

    const left = [...alive];
    await winnerBox(channel, left.length > 1 ? 'survivors' : 'last one standing', left);
  });
}

/* =========================================================
   9. Highest dice roll
========================================================= */

async function rollRound(channel, players, label) {
  const id = uid();
  const rolls = new Map();
  const secs = 15;
  const ids = new Set(players.map((p) => p.id));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`g:roll:${id}`).setLabel('Roll').setEmoji('🎲').setStyle(ButtonStyle.Primary)
  );

  const view = () => [
    `**${label}**`,
    players.map((p) => `${nm(p.id)} · ${rolls.has(p.id) ? `🎲 ${rolls.get(p.id)}` : '...'}`).join('\n'),
    `-# you have ${secs}s`,
  ];

  const msg = await say(channel, view(), { rows: [row], users: [...ids] });

  await new Promise((resolve) => {
    const col = msg.createMessageComponentCollector({ time: secs * 1000 });

    col.on('collect', async (i) => {
      try {
        if (!ids.has(i.user.id)) {
          return i.reply(priv(box("You're not rolling this round."))).catch(() => {});
        }
        if (rolls.has(i.user.id)) {
          return i.reply(priv(box('You already rolled.'))).catch(() => {});
        }
        rolls.set(i.user.id, rand(1, 6));
        await i.update(box(view(), { rows: [row] })).catch(() => {});
        if (rolls.size === ids.size) col.stop('all');
      } catch (err) {
        console.error('[games] dice:', err);
      }
    });

    col.on('end', () => resolve());
  });

  // anyone who didn't roll gets an automatic roll
  for (const p of players) if (!rolls.has(p.id)) rolls.set(p.id, rand(1, 6));

  await edit(msg, [`**${label}**`, players.map((p) => `${nm(p.id)} · 🎲 ${rolls.get(p.id)}`).join('\n')]);
  return rolls;
}

async function dice(interaction) {
  return run(interaction, 'dice', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'highest dice roll',
      rules: 'everyone rolls one die. highest roll wins. ties reroll.',
      min: 2,
      max: 25,
    });
    if (!l) return;

    let players = l.players;
    let round = 1;

    for (;;) {
      const rolls = await rollRound(channel, players, round === 1 ? 'roll' : `reroll ${round - 1}`);
      const top = Math.max(...rolls.values());
      const tied = players.filter((p) => rolls.get(p.id) === top);

      if (tied.length === 1) {
        return winnerBox(channel, `highest roll (${top})`, [tied[0].id]);
      }

      await say(channel, `tie at **${top}** between ${tied.map((p) => nm(p.id)).join(' ')}`);
      players = tied;
      round++;
      await sleep(1500);
    }
  });
}

/* =========================================================
   10. Pick the winning chest
========================================================= */

async function chests(interaction) {
  return run(interaction, 'chests', false, async () => {
    const channel = interaction.channel;
    const TOTAL = 8;
    const PRIZES = 2;
    const secs = 30;
    const end = Math.floor(Date.now() / 1000) + secs;
    const id = uid();

    const prize = new Set(shuffle([...Array(TOTAL).keys()]).slice(0, PRIZES));
    const taken = new Map(); // chest index -> user id
    const byUser = new Map();

    const rows = (off = false) =>
      [0, 1].map((r) =>
        new ActionRowBuilder().addComponents(
          [0, 1, 2, 3].map((c) => {
            const i = r * 4 + c;
            return new ButtonBuilder()
              .setCustomId(`g:chest:${id}:${i}`)
              .setLabel(String(i + 1))
              .setEmoji('📦')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(off || taken.has(i));
          })
        )
      );

    const view = (off = false) =>
      box(
        [
          TITLE('pick the winning chest'),
          `${TOTAL} chests, **${PRIZES}** hold a prize. one pick each, first come first served.`,
          off ? null : `-# ends <t:${end}:R> · ${taken.size}/${TOTAL} opened`,
        ],
        { rows: rows(off) }
      );

    await interaction.reply({ ...view(), allowedMentions: { parse: [] } });
    const msg = await interaction.fetchReply();

    await new Promise((resolve) => {
      const col = msg.createMessageComponentCollector({ time: secs * 1000 });

      col.on('collect', async (i) => {
        try {
          if (byUser.has(i.user.id)) {
            return i.reply(priv(box('You already picked a chest.'))).catch(() => {});
          }
          const n = parseInt(i.customId.split(':')[3], 10);
          if (taken.has(n)) {
            return i.reply(priv(box('That chest is taken.'))).catch(() => {});
          }
          taken.set(n, i.user.id);
          byUser.set(i.user.id, n);
          await i.update(view()).catch(() => {});
          if (taken.size === TOTAL) col.stop('full');
        } catch (err) {
          console.error('[games] chests:', err);
        }
      });

      col.on('end', () => resolve());
    });

    const reveal = [...Array(TOTAL).keys()]
      .map((i) => `${i + 1}. ${prize.has(i) ? '🎁' : '💀'}${taken.has(i) ? ` ${nm(taken.get(i))}` : ''}`)
      .join('\n');

    await msg.edit(box([TITLE('pick the winning chest'), reveal])).catch(() => {});

    const winners = [...taken.entries()].filter(([n]) => prize.has(n)).map(([, u]) => u);

    if (!winners.length) return say(channel, 'nobody found a prize.');
    await winnerBox(channel, winners.length > 1 ? 'chest winners' : 'chest winner', winners);
  });
}

/* =========================================================
   11. Don't press the button
========================================================= */

async function dontPress(interaction) {
  return run(interaction, 'button', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: "don't press the button",
      rules: 'take turns pressing. the button can blow up at any time and the presser is out. too slow also counts as out.',
      min: 2,
      max: 25,
    });
    if (!l) return;

    let alive = shuffle(l.players);
    let idx = 0;
    let safePresses = 0;

    while (alive.length > 1) {
      const player = alive[idx % alive.length];
      const id = uid();
      const secs = 12;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`g:btn:${id}`).setLabel("Don't press").setEmoji('🔴').setStyle(ButtonStyle.Danger)
      );

      const msg = await say(
        channel,
        [TITLE("don't press the button"), `${nm(player.id)}, it's your turn`, `-# ${alive.length} left · ${secs}s`],
        { rows: [row], users: [player.id] }
      );

      let pressed = false;

      await new Promise((resolve) => {
        const col = msg.createMessageComponentCollector({ time: secs * 1000 });

        col.on('collect', async (i) => {
          if (i.user.id !== player.id) {
            return i.reply(priv(box("It's not your turn."))).catch(() => {});
          }
          pressed = true;
          i.deferUpdate().catch(() => {});
          col.stop('pressed');
        });

        col.on('end', () => resolve());
      });

      let boom = false;
      let line;

      if (!pressed) {
        boom = true;
        line = `💤 ${nm(player.id)} took too long and is out`;
      } else {
        safePresses++;
        const chance = Math.min(0.6, 0.08 + safePresses * 0.06);
        boom = Math.random() < chance;
        line = boom ? `💥 ${nm(player.id)} pressed it and it blew up` : `✅ ${nm(player.id)} is safe`;
      }

      await edit(msg, [TITLE("don't press the button"), line]);

      if (boom) {
        alive = alive.filter((p) => p.id !== player.id);
        safePresses = 0;
        idx = alive.length ? idx % alive.length : 0;
      } else {
        idx = (idx + 1) % alive.length;
      }

      await sleep(1500);
    }

    await winnerBox(channel, 'last one alive', [alive[0].id]);
  });
}

/* =========================================================
   12. Number elimination
========================================================= */

async function numberElim(interaction) {
  return run(interaction, 'number-elim', false, async () => {
    const channel = interaction.channel;

    const l = await lobby(interaction, {
      title: 'number elimination',
      rules: 'pick a number from 1 to 5 each round. the bot reveals a losing number and everyone on it is out. not picking also counts as out.',
      min: 3,
      max: 40,
    });
    if (!l) return;

    const alive = new Set(l.players.map((p) => p.id));

    for (let round = 1; round <= 25 && alive.size > 1; round++) {
      const id = uid();
      const secs = 12;
      const picks = new Map();

      const row = new ActionRowBuilder().addComponents(
        [1, 2, 3, 4, 5].map((n) =>
          new ButtonBuilder().setCustomId(`g:num:${id}:${n}`).setLabel(String(n)).setStyle(ButtonStyle.Secondary)
        )
      );

      const msg = await say(channel, [`**round ${round}** · ${alive.size} left`, `pick a number, ${secs}s`], { rows: [row] });

      await new Promise((resolve) => {
        const col = msg.createMessageComponentCollector({ time: secs * 1000 });

        col.on('collect', async (i) => {
          try {
            if (!alive.has(i.user.id)) {
              return i.reply(priv(box("You're not in this round."))).catch(() => {});
            }
            if (picks.has(i.user.id)) {
              return i.reply(priv(box('You already picked.'))).catch(() => {});
            }
            const n = parseInt(i.customId.split(':')[3], 10);
            picks.set(i.user.id, n);
            await i.reply(priv(box(`Locked in **${n}**`))).catch(() => {});
            if ([...alive].every((u) => picks.has(u))) col.stop('all');
          } catch (err) {
            console.error('[games] numelim:', err);
          }
        });

        col.on('end', () => resolve());
      });

      const idle = [...alive].filter((u) => !picks.has(u));

      if (idle.length === alive.size) {
        await edit(msg, [`**round ${round}**`, 'nobody picked, game over.']);
        return;
      }

      idle.forEach((u) => alive.delete(u));

      const distinct = [...new Set(picks.values())];
      let lines = [];

      if (distinct.length > 1) {
        const losing = pick(distinct);
        const hit = [...picks.entries()].filter(([, n]) => n === losing).map(([u]) => u);
        hit.forEach((u) => alive.delete(u));
        lines.push(`losing number: **${losing}**`);
        lines.push(`❌ out: ${hit.map(nm).join(' ')}`);
      } else {
        lines.push(`everyone picked **${distinct[0]}**, nobody is out.`);
      }

      if (idle.length) lines.push(`💤 too slow: ${idle.map(nm).join(' ')}`);

      await edit(msg, [`**round ${round}**`, lines.join('\n')]);
      await sleep(2500);
    }

    const left = [...alive];
    await winnerBox(channel, left.length > 1 ? 'survivors' : 'last one standing', left);
  });
}

/* =========================================================
   Guess the number (/gtn)
========================================================= */

async function guessNumber(interaction, max) {
  return run(interaction, 'gtn', true, async () => {
    const channel = interaction.channel;
    const secret = rand(1, max);
    const secs = 120;
    const end = Math.floor(Date.now() / 1000) + secs;
    let guesses = 0;
    let winner = null;

    await interaction.reply({
      ...box([
        TITLE('guess the number'),
        `${nm(interaction.user.id)} started a game. i picked a number from **1 to ${max}**.`,
        `type your guess in chat. ⬆️ means higher, ⬇️ means lower.`,
        `-# ends <t:${end}:R>`,
      ]),
      allowedMentions: { parse: [] },
    });

    await collectMessages(channel, {
      time: secs * 1000,
      filter: (m) => {
        if (m.author.bot || !/^\d{1,3}$/.test(m.content.trim())) return false;
        const n = parseInt(m.content.trim(), 10);
        return n >= 1 && n <= max;
      },
      onCollect: (m, col) => {
        const n = parseInt(m.content.trim(), 10);
        guesses++;
        if (n === secret) {
          winner = m.author.id;
          m.react('🎉').catch(() => {});
          col.stop('won');
        } else {
          m.react(n < secret ? '⬆️' : '⬇️').catch(() => {});
        }
      },
    });

    if (!winner) {
      return say(channel, [TITLE('guess the number'), `time's up. it was **${secret}**.`]);
    }

    await say(channel, [`## 🏆 ${nm(winner)} got it`, `the number was **${secret}** · ${guesses} guess${guesses === 1 ? '' : 'es'}`], {
      users: [winner],
    });
    await awardPrize(channel, [winner]);
  });
}

module.exports = {
  lastTyper,
  closest,
  roulette,
  boats,
  rpsTournament,
  hotPotato,
  typingRace,
  trivia,
  dice,
  chests,
  dontPress,
  numberElim,
  guessNumber,
};
