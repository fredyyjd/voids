const fs = require('fs');
const path = require('path');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');

const config = require('../config.json');
const { box, priv } = require('./box');
const { TYPES, normalise } = require('./eventTypes');
const store = require('./eventStore');

const COUNTDOWN_MS = 10 * 1000; // announcement -> first round
const GAP_MS = 6 * 1000; // reveal -> next round
const ITEM_DIR = path.join(__dirname, '..', 'assets', 'items');

/* =========================================================
   LOCKS + TIMERS

   Every change to an event runs through withLock(id, ...), so two members
   clicking at the same moment can never both be treated as "first", and a
   round can't be closed twice by the timer and a correct answer together.
========================================================= */

const locks = new Map();

function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(id, next);
  next.then(
    () => locks.get(id) === next && locks.delete(id),
    () => locks.get(id) === next && locks.delete(id)
  );
  return next;
}

const timers = new Map();

function schedule(client, ev) {
  clearTimeout(timers.get(ev.id));
  timers.delete(ev.id);
  if (ev.status !== 'running' || !ev.phaseEndsAt) return;

  const delay = Math.max(0, ev.phaseEndsAt - Date.now());
  timers.set(
    ev.id,
    setTimeout(() => advance(client, ev.id).catch((err) => console.error('[events] advance failed', err)), delay)
  );
}

/* =========================================================
   SMALL HELPERS
========================================================= */

const unix = (ms) => Math.floor(ms / 1000);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const medal = (i) => ['🥇', '🥈', '🥉'][i] || `**${i + 1}.**`;
const secs = (ms) => (ms / 1000).toFixed(1);

async function getChannel(client, ev) {
  return client.channels.fetch(ev.channelId);
}

async function audit(client, ev, text) {
  const id = config.eventLogChannelId;
  if (!id || String(id).startsWith('PUT_')) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (ch?.isTextBased()) ch.send(box(`🗂️ **Event #${ev.id}** (${TYPES[ev.type]?.label}) — ${text}`)).catch(() => {});
}

function standingsFor(ev) {
  return Object.entries(ev.scores)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.points - a.points || a.timeMs - b.timeMs);
}

// Ranked list of user ids, best first. Number Guess ranks by closeness.
function ranking(ev) {
  if (ev.type === 'number') return (ev.numberStandings || []).map((x) => x.uid);
  return standingsFor(ev).filter((s) => s.points > 0).map((s) => s.id);
}

function leaderboardText(ev, limit = 10) {
  const s = standingsFor(ev).slice(0, limit);
  if (!s.length) return 'No scores yet.';
  return s.map((x, i) => `${medal(i)} <@${x.id}> — **${plural(x.points, 'pt')}**`).join('\n');
}

/* =========================================================
   RENDERING
========================================================= */

function headerLines(ev) {
  const t = TYPES[ev.type];
  const round = ev.rounds.length > 1 ? `  ·  Round ${ev.roundIndex + 1}/${ev.rounds.length}` : '';
  const lines = [`## ${t.emoji} ${t.label}${round}`];
  if (ev.prize) lines.push(`🎁 **Prize:** ${ev.prize}  ·  ${plural(ev.winnerCount, 'winner')}`);
  return lines;
}

function eventContainer(textParts, { rows = [], image = null } = {}) {
  const c = new ContainerBuilder();
  for (const part of textParts.filter(Boolean)) {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(part).slice(0, 3800)));
  }
  if (image) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)));
  if (rows.length) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    c.addActionRowComponents(...rows);
  }
  return { flags: MessageFlags.IsComponentsV2, components: [c] };
}

function roundRows(ev, round, state) {
  const t = TYPES[ev.type];
  const id = (kind, extra = '') => `ev:${kind}:${ev.id}:${ev.roundIndex}${extra}`;
  const rows = [];
  const live = state === 'open';

  if (t.kind === 'choice') {
    const row = new ActionRowBuilder();
    round.options.forEach((opt, i) => {
      const tf = ev.type === 'truefalse';
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(id('a', `:${i}`))
          .setLabel(tf ? opt : `${String.fromCharCode(65 + i)}) ${opt}`.slice(0, 80))
          .setStyle(tf ? (i === 0 ? ButtonStyle.Success : ButtonStyle.Danger) : ButtonStyle.Secondary)
      );
    });
    rows.push(row);
  } else if (t.kind === 'text' || t.kind === 'number') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(id('s'))
        .setLabel(t.kind === 'number' ? 'Submit Guess' : 'Submit Answer')
        .setStyle(ButtonStyle.Primary)
    );
    if (round.hints?.length) {
      row.addComponents(new ButtonBuilder().setCustomId(id('h')).setLabel('Request Hint').setStyle(ButtonStyle.Secondary));
    }
    rows.push(row);
  } else if (t.kind === 'react') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(id('r'))
          .setLabel(live ? 'CLICK!' : 'Wait for it...')
          .setStyle(live ? ButtonStyle.Success : ButtonStyle.Danger)
          .setDisabled(!live)
      )
    );
  }

  if (ev.rounds.length > 1 && t.kind !== 'react') {
    const last = rows[rows.length - 1];
    if (last.components.length < 5) {
      last.addComponents(
        new ButtonBuilder().setCustomId(`ev:lb:${ev.id}`).setLabel('Leaderboard').setStyle(ButtonStyle.Secondary)
      );
    }
  }

  return rows;
}

// state: 'arming' | 'open' | 'closed'
function roundPayload(ev, state, revealLines = []) {
  const round = ev.rounds[ev.roundIndex];
  const t = TYPES[ev.type];
  const text = [headerLines(ev).join('\n')];
  const body = [];

  if (t.kind === 'react') {
    body.push(round.prompt);
  } else if (t.kind === 'number') {
    body.push(`**${round.prompt}** between **${round.min}** and **${round.max}**`);
    if (round.clue) body.push(`💡 Clue: ${round.clue}`);
    body.push('Closest guess wins. An exact guess wins straight away.');
  } else if (t.kind === 'choice') {
    body.push(`**${round.prompt}**`);
    if (ev.type === 'trivia') body.push(round.options.map((o, i) => `**${String.fromCharCode(65 + i)})** ${o}`).join('\n'));
  } else {
    body.push(`**${round.prompt}**`);
    if (round.display) body.push(round.display.length <= 40 ? `# ${round.display}` : `**${round.display}**`);
    if (round.clue) body.push(round.clue);
    if (round.hints?.length) body.push('-# Hint available, press Request Hint');
  }
  text.push(body.join('\n'));

  if (state === 'open') {
    text.push(`⏳ Ends <t:${unix(ev.phaseEndsAt)}:R>`);
  } else if (state === 'closed') {
    text.push(revealLines.join('\n'));
  }

  const payload = eventContainer(text, {
    rows: state === 'closed' ? [] : roundRows(ev, round, state),
    image: round.image || (round.localImage ? `attachment://${round.localImage}` : null),
  });

  if (round.localImage) {
    const file = path.join(ITEM_DIR, path.basename(round.localImage));
    if (fs.existsSync(file)) payload.files = [new AttachmentBuilder(file, { name: path.basename(round.localImage) })];
  }

  return payload;
}

/* =========================================================
   ROUND LIFECYCLE
========================================================= */

async function openRound(client, ev) {
  const t = TYPES[ev.type];
  ev.roundIndex += 1;

  try {
    ev.sub = {};
    ev.roundWinner = null;

    if (t.kind === 'react') {
      ev.phase = 'arming';
      ev.phaseEndsAt = Date.now() + 3000 + Math.floor(Math.random() * 6000);
    } else {
      ev.roundStartedAt = Date.now();
      ev.phase = 'open';
      ev.phaseEndsAt = ev.roundStartedAt + ev.timeLimit * 1000;
    }

    const channel = await getChannel(client, ev);
    const msg = await channel.send(roundPayload(ev, ev.phase === 'arming' ? 'arming' : 'open'));
    ev.roundMsgId = msg.id;
  } catch (err) {
    ev.roundIndex -= 1;
    throw err;
  }

  store.save();
  schedule(client, ev);
}

async function armRound(client, ev) {
  ev.phase = 'open';
  ev.roundStartedAt = Date.now();
  ev.phaseEndsAt = ev.roundStartedAt + ev.timeLimit * 1000;

  const channel = await getChannel(client, ev);
  await channel.messages.edit(ev.roundMsgId, roundPayload(ev, 'open')).catch(() => {});

  store.save();
  schedule(client, ev);
}

function addScore(ev, uid, elapsedMs) {
  const s = (ev.scores[uid] ||= { points: 0, correct: 0, timeMs: 0 });
  s.points += ev.points;
  s.correct += 1;
  s.timeMs += elapsedMs;
}

// Scores the round and returns the lines shown when the answer is revealed.
function scoreRound(ev, round) {
  const t = TYPES[ev.type];
  const subs = Object.entries(ev.sub);
  const lines = [];

  if (t.kind === 'choice') {
    let right = 0;
    for (const [uid, s] of subs) {
      if (s.choice === round.correct) {
        right += 1;
        addScore(ev, uid, s.at - ev.roundStartedAt);
      }
    }
    lines.push(`✅ **Correct answer:** ${ev.type === 'trivia' ? `${String.fromCharCode(65 + round.correct)}) ` : ''}${round.options[round.correct]}`);
    lines.push(`${right} of ${subs.length} answered correctly`);
  } else if (t.kind === 'number') {
    const best = [];
    for (const [uid, s] of subs) {
      if (!s.guesses?.length) continue;
      const g = s.guesses
        .map((x) => ({ uid, guess: x.n, dist: Math.abs(x.n - round.secret), at: x.at }))
        .sort((a, b) => a.dist - b.dist || a.at - b.at)[0];
      best.push(g);
    }
    best.sort((a, b) => a.dist - b.dist || a.at - b.at);
    ev.numberStandings = best;
    best.forEach((b, i) => {
      ev.scores[b.uid] = { points: best.length - i, correct: b.dist === 0 ? 1 : 0, timeMs: b.at - ev.roundStartedAt };
    });

    lines.push(`🔢 **Secret number:** ${round.secret}`);
    if (best.length) {
      lines.push(...best.slice(0, 3).map((b, i) => `${medal(i)} <@${b.uid}> — guessed **${b.guess}** (${b.dist === 0 ? 'exact' : `off by ${b.dist}`})`));
    } else lines.push('Nobody guessed.');
  } else {
    // text + react: ev.roundWinner is set by the first correct answer / click
    if (ev.roundWinner) {
      const w = ev.roundWinner;
      addScore(ev, w.uid, w.elapsed);
      const answer = t.kind === 'text' ? ` — **${round.answers[0]}**` : '';
      lines.push(`🏆 <@${w.uid}> was first in **${secs(w.elapsed)}s**${answer}`);
    } else {
      lines.push(t.kind === 'text' ? `⏰ Nobody got it. The answer was **${round.answers[0]}**` : '⏰ Nobody clicked in time.');
    }
  }

  return lines;
}

async function closeRound(client, ev) {
  if (ev.phase !== 'open' && ev.phase !== 'arming') return;

  const round = ev.rounds[ev.roundIndex];
  const wasOpen = ev.phase === 'open';
  const lines = wasOpen ? scoreRound(ev, round) : ['⏭️ Round skipped.'];
  const last = ev.roundIndex >= ev.rounds.length - 1;

  ev.phase = 'closed';
  ev.phaseEndsAt = null;
  Object.keys(ev.sub).forEach((uid) => (ev.participants[uid] = true));

  if (!last && ev.rounds.length > 1) lines.push(`\n**Top so far**\n${leaderboardText(ev, 3)}`);
  lines.push(`-# ${plural(Object.keys(ev.participants).length, 'player')} so far`);

  const channel = await getChannel(client, ev).catch(() => null);
  if (channel) {
    const payload = roundPayload(ev, 'closed', lines);
    if (round.localImage) payload.attachments = [];
    await channel.messages.edit(ev.roundMsgId, payload).catch((err) => console.error('[events] reveal edit failed', err.message));
  }

  if (last) return finishEvent(client, ev, {});

  ev.phase = 'gap';
  ev.phaseEndsAt = Date.now() + GAP_MS;
  store.save();
  schedule(client, ev);
}

async function advance(client, id) {
  return withLock(id, async () => {
    const ev = store.getEvent(id);
    if (!ev || ev.status !== 'running') return;

    if (Date.now() < ev.phaseEndsAt - 50) return schedule(client, ev);

    try {
      if (ev.phase === 'countdown' || ev.phase === 'gap') await openRound(client, ev);
      else if (ev.phase === 'arming') await armRound(client, ev);
      else if (ev.phase === 'open') await closeRound(client, ev);
      ev.failures = 0;
    } catch (err) {
      ev.failures = (ev.failures || 0) + 1;
      console.error(`[events] event ${ev.id} step failed (${ev.failures})`, err);

      if (ev.failures >= 3) {
        await finishEvent(client, ev, { cancelled: true, reason: 'The bot could not post in the channel.' }).catch(() => {});
      } else {
        ev.phaseEndsAt = Date.now() + 5000;
        store.save();
        schedule(client, ev);
      }
    }
  });
}

/* =========================================================
   FINISH
========================================================= */

async function finishEvent(client, ev, { cancelled = false, reason = null, endedBy = null }) {
  if (ev.status !== 'running') return;
  endedBy = endedBy || ev.endedBy || null;

  clearTimeout(timers.get(ev.id));
  timers.delete(ev.id);

  ev.status = cancelled ? 'cancelled' : 'ended';
  ev.phase = 'done';
  ev.phaseEndsAt = null;
  ev.endedAt = Date.now();
  ev.sub = {};

  const channel = await getChannel(client, ev).catch(() => null);

  if (cancelled) {
    store.save();
    if (channel) {
      await channel.send(box([`## ❌ ${TYPES[ev.type].label} cancelled`, reason || 'This event was cancelled by staff.'])).catch(() => {});
    }
    return;
  }

  const ranked = ranking(ev);
  ev.winners = ranked.slice(0, ev.winnerCount);

  // Stats: giveaways are not in here, only skill events, so random draws
  // can't distort the competitive leaderboard.
  const data = store.load();
  for (const uid of Object.keys(ev.participants)) {
    const st = store.userStats(uid);
    st.played += 1;
    if (ev.winners.includes(uid)) st.wins += 1;
    if (ranked.slice(0, 3).includes(uid)) st.podiums += 1;
    if (ev.awardsPoints) {
      st.points += ev.type === 'number' ? (ev.winners.includes(uid) ? ev.points : 0) : ev.scores[uid]?.points || 0;
    }
  }
  data.history.push(ev.id);
  store.save();

  if (!channel) return;

  const out = [`## 🏆 ${TYPES[ev.type].label} — Results`];
  if (ev.prize) out.push(`🎁 **Prize:** ${ev.prize}`);

  if (!ranked.length) {
    out.push('Nobody scored this time, so there are no winners.');
  } else {
    const top = ranked.slice(0, 3).map((uid, i) => {
      if (ev.type === 'number') {
        const n = ev.numberStandings[i];
        return `${medal(i)} <@${uid}> — guessed **${n.guess}** (${n.dist === 0 ? 'exact' : `off by ${n.dist}`})`;
      }
      return `${medal(i)} <@${uid}> — **${plural(ev.scores[uid].points, 'pt')}**`;
    });
    out.push(top.join('\n'));
    if (ev.prize) out.push(`🎉 **${ev.winners.length === 1 ? 'Winner' : 'Winners'}:** ${ev.winners.map((u) => `<@${u}>`).join(', ')}`);
  }

  out.push(
    `👥 **Participants:** ${Object.keys(ev.participants).length}\n` +
      `🎙️ **Host:** <@${ev.hostId}>\n` +
      `🕒 **Completed:** <t:${unix(ev.endedAt)}:f>`
  );
  if (endedBy) out.push(`-# Ended early by <@${endedBy}>`);

  await channel.send({ ...box(out), allowedMentions: { users: ev.winners } }).catch((err) => console.error('[events] results post failed', err));
  audit(client, ev, `finished, ${plural(Object.keys(ev.participants).length, 'player')}, winners: ${ev.winners.map((u) => `<@${u}>`).join(', ') || 'none'}`);
}

/* =========================================================
   START / MANAGE
========================================================= */

async function startEvent(client, { channel, hostId, draft }) {
  const id = store.nextId();
  const t = TYPES[draft.type];

  const ev = {
    id,
    type: draft.type,
    guildId: channel.guildId,
    channelId: channel.id,
    hostId,
    prize: draft.raw.prize || null,
    winnerCount: draft.settings.winnerCount,
    timeLimit: draft.settings.timeLimit,
    points: draft.settings.points,
    awardsPoints: draft.awardsPoints,
    maxAttempts: 3,
    rounds: draft.parsed.rounds,
    roundIndex: -1,
    roundWinner: null,
    sub: {},
    scores: {},
    participants: {},
    status: 'running',
    phase: 'countdown',
    phaseEndsAt: Date.now() + COUNTDOWN_MS,
    createdAt: Date.now(),
  };

  const ping = config.eventPingRoleId && !String(config.eventPingRoleId).startsWith('PUT_') ? `<@&${config.eventPingRoleId}> ` : '';
  const how =
    t.kind === 'choice' ? 'Press the answer buttons. You get one answer per round.'
    : t.kind === 'react' ? 'Click the button as soon as it turns green.'
    : t.kind === 'number' ? 'Press **Submit Guess** and enter a number.'
    : 'Press **Submit Answer** and type your answer.';

  const msg = await channel.send({
    ...box([
      `${ping}## ${t.emoji} ${t.label}`,
      [
        ev.prize ? `🎁 **Prize:** ${ev.prize}  ·  ${plural(ev.winnerCount, 'winner')}` : null,
        `🔁 **Rounds:** ${ev.rounds.length}`,
        t.kind === 'number' || t.kind === 'react' ? null : `⏱️ **Time per round:** ${ev.timeLimit}s`,
        `🎙️ **Host:** <@${hostId}>`,
      ].filter(Boolean).join('\n'),
      how,
      `Starts <t:${unix(ev.phaseEndsAt)}:R>`,
    ]),
    allowedMentions: { roles: ping ? [config.eventPingRoleId] : [] },
  });

  ev.announcementId = msg.id;
  store.load().events[id] = ev;
  store.save();
  schedule(client, ev);
  audit(client, ev, `published by <@${hostId}> in <#${channel.id}>`);
  return ev;
}

function manage(client, evId, action, userId) {
  return withLock(evId, async () => {
    const ev = store.getEvent(evId);
    if (!ev || ev.status !== 'running') return { ok: false, text: 'That event is not running.' };

    if (action === 'cancel') {
      await finishEvent(client, ev, { cancelled: true });
      audit(client, ev, `cancelled by <@${userId}>`);
      return { ok: true, text: `Event #${ev.id} cancelled.` };
    }

    if (action === 'end') {
      if (ev.phase === 'open' || ev.phase === 'arming') {
        ev.endedBy = userId;
        ev.rounds = ev.rounds.slice(0, ev.roundIndex + 1); // makes this the final round
        await closeRound(client, ev);
      } else {
        await finishEvent(client, ev, { endedBy: userId });
      }
      audit(client, ev, `ended early by <@${userId}>`);
      return { ok: true, text: `Event #${ev.id} ended and results posted.` };
    }

    if (action === 'skip') {
      if (ev.phase !== 'open' && ev.phase !== 'arming') return { ok: false, text: 'There is no round open right now.' };
      await closeRound(client, ev);
      audit(client, ev, `round skipped by <@${userId}>`);
      return { ok: true, text: 'Round closed.' };
    }

    return { ok: false, text: 'Unknown action.' };
  });
}

function recover(client) {
  const running = store.runningEvents();
  for (const ev of running) {
    // A round may have run out while the bot was offline; close it shortly after boot.
    if (ev.phase === 'closed') ev.phase = 'gap';
    ev.phaseEndsAt = Math.max(ev.phaseEndsAt || 0, Date.now() + 2000);
    schedule(client, ev);
  }
  if (running.length) console.log(`[events] resumed ${running.length} running event(s)`);
}

/* =========================================================
   MEMBER INTERACTIONS
========================================================= */

const reject = (interaction, text) => interaction.reply(priv(box(`❌ ${text}`)));

function openCheck(ev, ri) {
  if (!ev || ev.status !== 'running') return 'This event is no longer running.';
  if (ev.phase !== 'open' || ev.roundIndex !== Number(ri)) return 'That round has already ended.';
  if (Date.now() > ev.phaseEndsAt + 500) return 'Time is up for this round.';
  return null;
}

function answerModal(ev, ri) {
  const t = TYPES[ev.type];
  const field = new TextInputBuilder()
    .setCustomId('answer')
    .setLabel(t.kind === 'number' ? 'Your guess (a whole number)' : 'Your answer')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  return new ModalBuilder()
    .setCustomId(`ev:sm:${ev.id}:${ri}`)
    .setTitle(t.kind === 'number' ? 'Submit your guess' : 'Submit your answer')
    .addComponents(new ActionRowBuilder().addComponents(field));
}

async function handleMember(interaction) {
  const [, kind, evId, ri, extra] = interaction.customId.split(':');
  const uid = interaction.user.id;

  if (kind === 'lb') {
    const ev = store.getEvent(evId);
    if (!ev) return reject(interaction, 'That event no longer exists.');
    return interaction.reply(priv(box([`## 📊 Leaderboard — event #${ev.id}`, leaderboardText(ev)])));
  }

  // Opening the answer box doesn't change anything, so it can skip the lock.
  if (kind === 's') {
    const ev = store.getEvent(evId);
    const problem = openCheck(ev, ri);
    if (problem) return reject(interaction, problem);

    const used = ev.sub[uid]?.attempts || 0;
    if (used >= ev.maxAttempts) return reject(interaction, `You have used all ${ev.maxAttempts} attempts this round.`);
    return interaction.showModal(answerModal(ev, ri));
  }

  return withLock(evId, async () => {
    const ev = store.getEvent(evId);
    const problem = openCheck(ev, ri);
    if (problem) return reject(interaction, problem);

    const round = ev.rounds[ev.roundIndex];
    const t = TYPES[ev.type];
    const sub = (ev.sub[uid] ||= {});

    if (kind === 'a') {
      if (t.kind !== 'choice') return reject(interaction, 'That button does not belong here.');
      const idx = Number(extra);
      if (!Number.isInteger(idx) || idx < 0 || idx >= round.options.length) return reject(interaction, 'Invalid answer.');
      if (sub.choice !== undefined) return reject(interaction, 'You already answered this round.');

      sub.choice = idx;
      sub.at = Date.now();
      ev.participants[uid] = true;
      store.saveSoon();
      return interaction.reply(priv(box(`✅ Locked in **${round.options[idx]}**. The answer is revealed when the round ends.`)));
    }

    if (kind === 'h') {
      if (!round.hints?.length) return reject(interaction, 'There are no hints for this round.');
      const n = Math.min(sub.hints || 0, round.hints.length - 1);
      sub.hints = (sub.hints || 0) + 1;
      store.saveSoon();
      return interaction.reply(priv(box(`💡 **Hint ${n + 1}/${round.hints.length}:** ${round.hints[n]}`)));
    }

    if (kind === 'r') {
      if (t.kind !== 'react') return reject(interaction, 'That button does not belong here.');
      if (ev.roundWinner) return reject(interaction, 'Someone was faster.');

      ev.participants[uid] = true;
      ev.roundWinner = { uid, elapsed: Date.now() - ev.roundStartedAt };
      await interaction.reply(priv(box('⚡ You were first!'))).catch(() => {});
      return closeRound(client(interaction), ev);
    }

    if (kind === 'sm') {
      if (t.kind !== 'text' && t.kind !== 'number') return reject(interaction, 'That form does not belong here.');
      if ((sub.attempts || 0) >= ev.maxAttempts) return reject(interaction, `You have used all ${ev.maxAttempts} attempts this round.`);

      const input = interaction.fields.getTextInputValue('answer').trim();
      sub.attempts = (sub.attempts || 0) + 1;
      ev.participants[uid] = true;
      const left = ev.maxAttempts - sub.attempts;

      if (t.kind === 'number') {
        if (!/^-?\d+$/.test(input)) {
          sub.attempts -= 1; // typos in the format don't cost an attempt
          return reject(interaction, 'Enter a whole number, for example `42`.');
        }
        const n = parseInt(input, 10);
        if (n < round.min || n > round.max) {
          sub.attempts -= 1;
          return reject(interaction, `Your guess must be between ${round.min} and ${round.max}.`);
        }

        (sub.guesses ||= []).push({ n, at: Date.now() });

        if (n === round.secret) {
          await interaction.reply(priv(box('🎯 Exact guess!'))).catch(() => {});
          return closeRound(client(interaction), ev);
        }

        store.saveSoon();
        return interaction.reply(priv(box(`🔒 Guess **${n}** locked in. ${plural(left, 'attempt')} left.`)));
      }

      const correct = round.numeric
        ? Number(input.replace(/[,\s]/g, '')) === Number(round.answers[0])
        : round.answers.some((a) => normalise(a) === normalise(input));

      if (!correct) {
        store.saveSoon();
        return interaction.reply(priv(box(`❌ Not quite. ${plural(left, 'attempt')} left.`)));
      }

      ev.roundWinner = { uid, elapsed: Date.now() - ev.roundStartedAt };
      await interaction.reply(priv(box('✅ Correct, you were first!'))).catch(() => {});
      return closeRound(client(interaction), ev);
    }

    return reject(interaction, 'Unknown action.');
  });
}

const client = (interaction) => interaction.client;

async function handle(interaction) {
  if (!interaction.customId?.startsWith('ev:')) return false;
  const kind = interaction.customId.split(':')[1];
  if (!['a', 's', 'sm', 'h', 'r', 'lb'].includes(kind)) return false;
  await handleMember(interaction);
  return true;
}

module.exports = {
  handle,
  startEvent,
  manage,
  recover,
  withLock,
  standingsFor,
  leaderboardText,
};
