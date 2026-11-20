const { EmbedBuilder } = require('discord.js');
const extra = require('../extraConfig');
const config = require('../config.json');
const cfg = require('./staffConfig');
const records = require('./staffRecords');
const store = require('./staffStore');
const scoring = require('./staffScoring');
const activityCheck = require('./activityCheck');
const { hasBypassRole } = require('./staffBypass');
const { weekStartFor, protection } = require('./staffPoints');

const DAY = 24 * 60 * 60 * 1000;
const BLUE = 0x3b82f6;
const GREEN = 0x57f287;
const RED = 0xed4245;
const GREY = 0x95a5a6;

const LADDER = cfg.ladder;
const rankIndexByKey = new Map(LADDER.map((r, i) => [r.key, i]));

let running = false;
const lastAttempt = new Map();

const reviewId = (week) => `review-${week}`;
const labelOf = (key) => LADDER.find((r) => r.key === key)?.label || key;

/* =========================================================
   ROSTER: who is on the team and what can be done to them
========================================================= */

function classify(member) {
  const roles = member.roles.cache;
  const held = LADDER.map((r, i) => (roles.has(r.roleId) ? i : -1)).filter((i) => i >= 0);
  const hasBase = !!cfg.baseRoleId && roles.has(cfg.baseRoleId);
  const bypass = hasBypassRole(member);

  let manualReason = null;
  if (member.id === member.guild.ownerId) manualReason = 'server owner';
  else if (cfg.manualOnlyRoleIds.some((id) => roles.has(id))) manualReason = 'manual-only rank';
  else if (
    roles.some(
      (r) =>
        r.id !== member.guild.id &&
        !cfg.managedRoleIds.has(r.id) &&
        !cfg.bypassRoleIds.includes(r.id) &&
        r.permissions?.has?.('Administrator')
    )
  ) {
    manualReason = 'holds a manual Administrator role';
  }

  const onLoa = !!cfg.loaRoleId && roles.has(cfg.loaRoleId);

  let rankKey = null;
  let rankLabel = 'Staff (no rank role)';
  let ambiguous = false;

  if (held.length === 1) {
    rankKey = LADDER[held[0]].key;
    rankLabel = LADDER[held[0]].label;
  } else if (held.length > 1) {
    ambiguous = true;
    rankLabel = held.map((i) => LADDER[i].label).join(' + ');
  } else if (!hasBase) {
    rankLabel = 'Management';
  }

  let exemptReason = null;
  if (bypass) exemptReason = 'bypass role';
  else if (manualReason) exemptReason = manualReason;

  return { rankKey, rankLabel, hasBase, held, bypass, manual: manualReason, exemptReason, onLoa, ambiguous };
}

async function buildRoster(guild, week) {
  const members = await guild.members.fetch({ time: 120000 });
  const roster = new Map();
  const activeIds = new Set(store.weekUserIds(week));

  for (const member of members.values()) {
    if (member.user.bot) continue;

    const info = classify(member);
    const onTeam = info.hasBase || info.held.length > 0;

    // Management only shows up when they actually did something this week.
    if (!onTeam && !(info.exemptReason && activeIds.has(member.id))) continue;
    roster.set(member.id, { member, ...info });
  }

  return { roster, members };
}

/* =========================================================
   PLANNING (one synchronous block, so it is saved atomically)
========================================================= */

function conductFor(userId, from, to, now) {
  const warnFrom = Math.max(from, to - cfg.conduct.warnLookbackDays * DAY);
  return {
    warns: records.warnsBetween(userId, from, to).length,
    strikes: records.strikesBetween(userId, from, to).length,
    recentWarns: records.warnsBetween(userId, warnFrom, to).length,
    recentStrikes: records.strikesBetween(userId, to - cfg.conduct.strikeLookbackWeeks * 7 * DAY, to).length,
    valid: records.validStrikes(userId, now),
  };
}

function snapshotStats(stats, activeDays) {
  return {
    msgs: stats.msgs,
    activeDays,
    handled: stats.handled,
    closed: stats.closed,
    giveaways: stats.giveaways,
    schematics: stats.schematics,
    duties: stats.mod + stats.events,
  };
}

function sotwAllowed(info) {
  return !info.exemptReason || (cfg.staffOfTheWeekAllowBypass && info.bypass && !info.manual);
}

function plan({ week, weekStart, weekEnd, guildId, roster, now = Date.now() }) {
  const degraded = store.downtimeMs(week) > cfg.maxDowntimeHoursForPromotions * 60 * 60 * 1000;
  const entries = {};
  const qualifiers = [];

  for (const [userId, info] of roster) {
    const stats = store.weekStats(week, userId);
    const active = store.activeDays(stats);
    const conduct = conductFor(userId, weekStart, weekEnd, now);
    const prot = protection(userId, weekStart);
    const result = scoring.scoreWeek(stats, active, { warns: conduct.warns, strikes: conduct.strikes }, undefined, prot.counted);

    const entry = {
      rank: info.rankKey,
      rankLabel: info.rankLabel,
      exempt: info.exemptReason,
      loa: info.onLoa,
      stats: snapshotStats(stats, active),
      conduct: {
        warns: conduct.warns,
        strikes: conduct.strikes,
        valid: conduct.valid.length,
      },
      score: result.score,
      points: prot.counted,
      safe: prot.safe,
      strong: result.strong,
      ok: result.ok,
      kinds: result.kinds,
      decision: null,
      rec: 'MAINTAIN',
      reason: '',
    };
    entries[userId] = entry;

    if (info.exemptReason) {
      entry.rec = 'EXEMPT';
      entry.reason = `Exempt (${info.exemptReason}). No automatic promotion, demotion, strike or timeout.`;

      // Only when management explicitly allows it can a bypass holder win Staff of the Week.
      if (sotwAllowed(info) && !info.onLoa && !degraded && result.strong && result.score >= cfg.staffOfTheWeek.minScore) {
        qualifiers.push({ userId, score: result.score, consistency: 0, kinds: result.kinds });
      }
      continue;
    }

    if (!info.rankKey) {
      entry.rec = 'MANUAL';
      entry.reason = info.ambiguous
        ? 'Holds more than one rank role, so nothing was changed automatically. Fix the roles by hand.'
        : 'Has the Staff role but no rank role, so there is no rank to review. Handle by hand.';
      continue;
    }

    // Weekly result goes into the member's history before anything is decided.
    store.pushHistory(userId, {
      week,
      rank: info.rankKey,
      score: result.score,
      strong: result.strong,
      ok: result.ok,
      kinds: result.kinds,
      activeDays: active,
      loa: info.onLoa,
    });

    const history = store.getHistory(userId);
    const idx = rankIndexByKey.get(info.rankKey);

    // 1) Strikes decide demotions: two valid strikes = one step down, once per review.
    if (conduct.valid.length >= records.STRIKES_FOR_DEMOTION) {
      const to = idx > 0 ? LADDER[idx - 1] : null;
      entry.decision = {
        type: to ? 'demote' : 'remove',
        from: info.rankKey,
        to: to ? to.key : null,
        state: 'pending',
        strikeIds: conduct.valid.slice(0, records.STRIKES_FOR_DEMOTION).map((s) => s.id),
      };
      entry.rec = to ? `DEMOTE to ${to.label}` : 'REMOVE from staff team';
      entry.reason = `${conduct.valid.length} valid strikes (limit ${records.STRIKES_FOR_DEMOTION}).`;
      continue;
    }

    if (info.onLoa) {
      entry.rec = 'ON LOA';
      entry.reason = 'On leave. Not judged this week and not counted against promotion progress.';
      continue;
    }

    // 2) Promotion.
    const next = LADDER[idx + 1] || null;
    const progress = scoring.streakAtRank(history, info.rankKey);
    let clean = { ok: true };
    if (conduct.valid.length > 0) clean = { ok: false, why: `${conduct.valid.length} valid strike(s) on record` };
    else if (conduct.recentStrikes > 0) clean = { ok: false, why: 'a strike was issued in the last few weeks' };
    else if (conduct.recentWarns > 0) clean = { ok: false, why: 'recent warning on record' };
    else if (degraded) clean = { ok: false, why: 'activity data for this week is incomplete (bot downtime)' };

    const check = scoring.promotionCheck({ entries: history, rankKey: info.rankKey, nextLabel: next?.label, clean });

    if (check.eligible) {
      const avg = scoring.averageScore(history, info.rankKey, check.needed);
      entry.decision = { type: 'promote', from: info.rankKey, to: next.key, state: 'pending' };
      entry.rec = `PROMOTE to ${next.label}`;
      entry.reason = `${check.strongRun} strong weeks in a row (avg score ${avg}), clean conduct, ${check.weeks} weeks at ${info.rankLabel}.`;
    } else if (result.strong) {
      entry.rec = 'MAINTAIN';
      entry.reason = `Strong week (${result.score}). Promotion: ${check.why}.`;
    } else if (result.ok) {
      entry.rec = 'MAINTAIN';
      entry.reason = `Acceptable week (${result.score}), not strong enough to count towards promotion.${gapNote(entry)}`;
    } else if (prot.safe) {
      entry.rec = 'MAINTAIN';
      entry.reason = `Score ${result.score} is low, but ${prot.counted} staff points this week keeps them safe from warnings and strikes.`;
    } else {
      entry.rec = 'NEEDS IMPROVEMENT';
      entry.reason = `Score ${result.score} is below the minimum (${prot.counted}/${prot.needed} staff points this week). No automatic action, management follow-up suggested.`;
    }

    // Candidates for Staff of the Week.
    const sotw = cfg.staffOfTheWeek;
    const cons = scoring.consistency(history);
    const clear = conduct.valid.length === 0 && conduct.recentStrikes === 0 && conduct.warns === 0;
    const steady = cons.of >= sotw.minHistoryWeeks && cons.ok / cons.of >= sotw.minConsistency;
    if (!degraded && !entry.decision && clear && steady && result.strong && result.score >= sotw.minScore) {
      qualifiers.push({
        userId,
        score: result.score,
        consistency: cons.of ? cons.ok / cons.of : 0,
        kinds: result.kinds,
      });
    }
  }

  const sotwState = store.getSotw();
  const recent = sotwState.history.slice(-cfg.staffOfTheWeek.cooldownWeeks).map((h) => h.userId);
  const winner = scoring.pickStaffOfTheWeek(qualifiers, recent);

  return {
    week,
    weekStart,
    weekEnd,
    guildId,
    startedAt: now,
    status: 'applying',
    degraded,
    entries,
    sotw: {
      state: 'pending',
      winner: winner ? winner.userId : null,
      reason: winner
        ? `Highest qualifying score (${winner.score}) with ${winner.kinds} kinds of contribution.`
        : qualifiers.length === 0
          ? `Nobody met the requirements (strong week, score ${cfg.staffOfTheWeek.minScore}+, clean conduct and steady recent weeks).`
          : '',
    },
    report: { parts: 0, sent: 0, done: false },
  };
}

function gapNote(entry) {
  const need = cfg.protection.points - (entry.points || 0);
  return need > 0 ? ` Needs ${Math.ceil(need)} more points this week to be safe.` : '';
}

/* =========================================================
   APPLYING ROLE CHANGES (idempotent, bypass roles are never touched)
========================================================= */

function assertSafe(roleId) {
  if (cfg.bypassRoleIds.includes(roleId)) throw new Error('refusing to touch a bypass role');
  if (!cfg.managedRoleIds.has(roleId)) throw new Error('role is not a managed staff role');
}

async function addRole(member, roleId, reason) {
  assertSafe(roleId);
  if (member.roles.cache.has(roleId)) return;

  const role = member.guild.roles.cache.get(roleId);
  if (!role) throw new Error(`role ${roleId} does not exist`);
  if (!role.editable) throw new Error(`I can't manage **${role.name}**, move my role above it`);

  await member.roles.add(roleId, reason);
}

async function removeRole(member, roleId, reason) {
  assertSafe(roleId);
  if (!member.roles.cache.has(roleId)) return;

  const role = member.guild.roles.cache.get(roleId);
  if (role && !role.editable) throw new Error(`I can't manage **${role.name}**, move my role above it`);

  await member.roles.remove(roleId, reason);
}

function currentRank(member) {
  const held = LADDER.filter((r) => member.roles.cache.has(r.roleId));
  return held.length === 1 ? held[0].key : held.length === 0 ? null : 'multiple';
}

async function dm(user, text) {
  await user.send(text).catch(() => {});
}

async function applyDecision(guild, userId, entry, week) {
  const decision = entry.decision;
  if (!decision || decision.state !== 'pending') return;

  const finish = (state, error = null) => {
    decision.state = state;
    decision.error = error;
    store.saveNow();
  };

  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  if (!member) return finish('skipped', 'no longer in the server');

  // Re-checked at apply time: roles can change between planning and applying.
  const info = classify(member);
  if (info.exemptReason) return finish('skipped', `exempt (${info.exemptReason})`);

  const now = currentRank(member);
  const target = decision.to;

  if (now === target && (target !== null || !member.roles.cache.has(cfg.baseRoleId))) {
    // Already there (e.g. the bot restarted after the role change).
    return finish('applied');
  }
  // A removal that stopped half way has no rank role left but still has the base role.
  const resumable = decision.type === 'remove' && now === null;
  if (now !== decision.from && !resumable) return finish('skipped', 'rank was changed manually in the meantime');

  const reason = `Staff review: ${decision.type} (${labelOf(decision.from)} -> ${target ? labelOf(target) : 'removed'})`;
  const from = LADDER[rankIndexByKey.get(decision.from)];

  try {
    if (decision.type === 'remove') {
      for (const rank of LADDER) await removeRole(member, rank.roleId, reason);
      if (cfg.baseRoleId) await removeRole(member, cfg.baseRoleId, reason);
    } else {
      const to = LADDER[rankIndexByKey.get(target)];
      // New rank first, so a failure never leaves the member without a rank.
      await addRole(member, to.roleId, reason);
      if (cfg.baseRoleId) await addRole(member, cfg.baseRoleId, reason);
      await removeRole(member, from.roleId, reason);
    }
  } catch (err) {
    console.error(`[staff review] could not apply ${decision.type} for ${userId}:`, err);
    return finish('failed', err.message);
  }

  if (decision.type !== 'promote') {
    const used = records.consumeStrikes(userId, records.STRIKES_FOR_DEMOTION, reviewId(week));
    decision.strikesConsumed = used;
  }

  finish('applied');

  const guildName = guild.name;
  if (decision.type === 'promote') {
    await dm(member.user, `Congratulations! You were promoted to **${labelOf(target)}** in **${guildName}**.\n${entry.reason}`);
  } else if (decision.type === 'demote') {
    await dm(member.user, `Your staff rank in **${guildName}** was lowered to **${labelOf(target)}**.\nReason: ${entry.reason}`);
  } else {
    await dm(member.user, `You were removed from the staff team in **${guildName}**.\nReason: ${entry.reason}`);
  }
}

async function applySotw(guild, review) {
  const sotw = review.sotw;
  if (sotw.state !== 'pending') return;

  const roleId = cfg.staffOfTheWeekRoleId;
  if (!roleId) {
    sotw.state = 'skipped';
    sotw.error = 'Staff of the Week role is not configured';
    return store.saveNow();
  }

  try {
    assertSafe(roleId);
    const members = await guild.members.fetch({ time: 120000 });
    const removedFrom = [];

    // The previous recipient loses the role before the next one gets it.
    for (const holder of members.filter((m) => m.roles.cache.has(roleId) && m.id !== sotw.winner).values()) {
      await removeRole(holder, roleId, 'Staff of the Week ended');
      removedFrom.push(holder.id);
    }
    sotw.removedFrom = removedFrom;

    if (sotw.winner) {
      const winner = members.get(sotw.winner) || (await guild.members.fetch(sotw.winner).catch(() => null));

      if (!winner || !sotwAllowed(classify(winner))) {
        sotw.winner = null;
        sotw.reason = 'The selected member left or became exempt before the role was given.';
      } else {
        await addRole(winner, roleId, 'Staff of the Week');
      }
    }

    const s = store.getSotw();
    s.current = sotw.winner || null;
    if (sotw.winner) {
      s.history = [...s.history.filter((h) => h.week !== review.week), { week: review.week, userId: sotw.winner }].slice(-26);
    }
    sotw.state = 'done';
  } catch (err) {
    console.error('[staff review] Staff of the Week failed:', err);
    sotw.state = 'failed';
    sotw.error = err.message;
  }

  store.saveNow();
}

/* =========================================================
   REPORT
========================================================= */

function reportChannelId() {
  const candidates = [
    cfg.reportChannelId,
    extra.staff?.logChannelId,
    activityCheck.WARN_CHANNEL_ID,
    config.modLogChannelId,
  ];
  return candidates.find((id) => cfg.isSet(id)) || null;
}

function ts(ms) {
  return `<t:${Math.floor(ms / 1000)}:D>`;
}

function recIcon(rec) {
  if (rec.startsWith('PROMOTE')) return '⬆️';
  if (rec.startsWith('DEMOTE') || rec.startsWith('REMOVE')) return '⬇️';
  if (rec === 'EXEMPT') return '🛡️';
  if (rec === 'NEEDS IMPROVEMENT') return '⚠️';
  if (rec === 'ON LOA') return '🏖️';
  if (rec === 'MANUAL') return '✋';
  return '➖';
}

function decisionNote(decision) {
  if (!decision) return '';
  if (decision.state === 'applied') return ' ✅ applied';
  if (decision.state === 'failed') return ` ❌ failed: ${decision.error}`;
  if (decision.state === 'skipped') return ` ⏭️ skipped: ${decision.error}`;
  return ' ⏳ pending';
}

function memberBlock(userId, e) {
  const s = e.stats;
  const head = e.exempt
    ? `🛡️ <@${userId}> · ${e.rankLabel} · **EXEMPT**`
    : `<@${userId}> · ${e.rankLabel} · score **${e.score}**${e.strong ? ' (strong)' : ''}`;

  const lines = [
    head,
    `Msgs ${s.msgs} · Active days ${s.activeDays} · Tickets ${s.handled} handled / ${s.closed} closed · Giveaways ${s.giveaways} · Schems ${s.schematics} · Duties ${s.duties}`,
    `Strikes ${e.conduct.valid} valid (${e.conduct.strikes} new) · Warns ${e.conduct.warns} new`,
    `${recIcon(e.rec)} **${e.rec}**${decisionNote(e.decision)} - ${e.reason}`,
  ];
  return lines.join('\n');
}

function orderedEntries(review) {
  const rankOrder = (e) => (e.rank ? rankIndexByKey.get(e.rank) : -1);
  return Object.entries(review.entries).sort(([, a], [, b]) => {
    if (!!a.exempt !== !!b.exempt) return a.exempt ? 1 : -1;
    return rankOrder(b) - rankOrder(a) || b.score - a.score;
  });
}

function embedLength(embed) {
  const d = embed.data || {};
  return (
    (d.title || '').length +
    (d.description || '').length +
    (d.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0) +
    80
  );
}

function buildReport(review) {
  const all = Object.entries(review.entries);
  const decisions = all.filter(([, e]) => e.decision);
  const promoted = decisions.filter(([, e]) => e.decision.type === 'promote');
  const demoted = decisions.filter(([, e]) => e.decision.type !== 'promote');
  const exempt = all.filter(([, e]) => e.exempt).length;
  const loa = all.filter(([, e]) => e.loa).length;

  const list = (rows, fmt) => (rows.length ? rows.map(fmt).join('\n').slice(0, 1000) : '*None*');

  const sotw = review.sotw;
  let sotwText;
  if (sotw.winner) {
    sotwText = `<@${sotw.winner}>\n${sotw.reason}`;
    if (sotw.state === 'skipped') sotwText += `\n⚠️ Role not given: ${sotw.error}`;
    if (sotw.state === 'failed') sotwText += `\n❌ Role change failed: ${sotw.error}`;
  } else {
    sotwText = `Nobody this week.\n${sotw.reason || ''}`.trim();
  }

  const header = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle('Weekly Staff Report')
    .setDescription(`Week of ${ts(review.weekStart)} to ${ts(review.weekEnd)}`)
    .addFields(
      {
        name: 'Summary',
        value: `Reviewed **${all.length - exempt}** · Exempt **${exempt}** · On LOA **${loa}** · Promoted **${promoted.length}** · Demoted **${demoted.length}**`,
      },
      { name: 'Promotions', value: list(promoted, ([id, e]) => `<@${id}> → ${e.rec.replace('PROMOTE to ', '')}${decisionNote(e.decision)}`) },
      { name: 'Demotions', value: list(demoted, ([id, e]) => `<@${id}> → ${e.rec.replace('DEMOTE to ', '')}${decisionNote(e.decision)}`) },
      { name: 'Staff of the Week', value: sotwText.slice(0, 1000) }
    );

  const notes = [];
  if (review.degraded) {
    notes.push('The bot was offline for a large part of this week, so promotions and Staff of the Week were skipped.');
  }
  notes.push(
    `Giveaway expectation: ${cfg.giveaways.expectedPerWeek} per week. Missing it lowers the score but never causes a demotion by itself.`
  );
  header.addFields({ name: 'Notes', value: notes.join('\n') });

  const embeds = [header];
  let current = [];
  let size = 0;

  const flush = () => {
    if (!current.length) return;
    embeds.push(new EmbedBuilder().setColor(GREY).setDescription(current.join('\n\n')));
    current = [];
    size = 0;
  };

  for (const [userId, e] of orderedEntries(review)) {
    const block = memberBlock(userId, e).slice(0, 900);
    if (size + block.length > 3600) flush();
    current.push(block);
    size += block.length + 2;
  }
  flush();

  // Discord allows 6000 characters of embeds per message, so pack by size.
  const parts = [];
  let group = [];
  let groupSize = 0;

  for (const embed of embeds) {
    const length = embedLength(embed);
    if (group.length && (groupSize + length > 5400 || group.length >= 4)) {
      parts.push(group);
      group = [];
      groupSize = 0;
    }
    group.push(embed);
    groupSize += length;
  }
  if (group.length) parts.push(group);

  parts.forEach((part, i) => {
    part[part.length - 1].setFooter({ text: `staffreview:${review.week}:${i + 1}/${parts.length}` });
  });

  return parts;
}

async function alreadyPosted(channel, client, marker) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent) return false;

  return recent.some(
    (m) => m.author?.id === client.user.id && m.embeds.some((e) => (e.footer?.text || '') === marker)
  );
}

async function sendReport(client, guild, review, { force = false } = {}) {
  const channelId = reportChannelId();
  const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;

  if (!channel || !channel.isTextBased()) {
    review.report.error = 'no report channel is configured or reachable';
    store.saveNow();
    return false;
  }

  const parts = buildReport(review);
  review.report.parts = parts.length;

  for (let i = 0; i < parts.length; i++) {
    if (!force && i < review.report.sent) continue;

    const marker = `staffreview:${review.week}:${i + 1}/${parts.length}`;
    if (!force && (await alreadyPosted(channel, client, marker))) {
      review.report.sent = i + 1;
      store.saveNow();
      continue;
    }

    await channel.send({ embeds: parts[i], allowedMentions: { parse: [] } });
    if (!force) {
      review.report.sent = i + 1;
      store.saveNow();
    }
  }

  review.report.done = true;
  review.report.error = null;
  store.saveNow();
  return true;
}

/* =========================================================
   RUNNING A REVIEW (restart-safe: every stage is saved)
========================================================= */

async function findGuild(client) {
  if (!cfg.baseRoleId) return null;
  const guilds = [...client.guilds.cache.values()];
  return guilds.find((g) => g.roles.cache.has(cfg.baseRoleId)) || null;
}

async function resume(client, review) {
  const guild = await client.guilds.fetch(review.guildId).catch(() => null);
  if (!guild) throw new Error('staff guild unavailable');
  await guild.roles.fetch().catch(() => {});

  if (review.status === 'applying') {
    for (const [userId, entry] of Object.entries(review.entries)) {
      await applyDecision(guild, userId, entry, review.week);
    }
    await applySotw(guild, review);
    review.status = 'reporting';
    store.saveNow();
  }

  if (review.status === 'reporting') {
    await sendReport(client, guild, review);
    review.status = 'complete';
    review.completedAt = Date.now();
    store.saveNow();
  }
}

async function runForWeek(client, weekStart) {
  const week = String(weekStart);
  const weekEnd = weekStartFor(weekStart + 8 * DAY);

  let review = store.getReview(week);
  if (review && (review.status === 'complete' || review.status === 'skipped' || review.status === 'abandoned')) return review;

  if (!review) {
    // Only a fully tracked week can be judged fairly.
    if (weekStart < store.trackingStart()) {
      review = { week, weekStart, weekEnd, status: 'skipped', reason: 'tracking had not started yet for this week' };
      store.setReview(week, review);
      store.saveNow();
      return review;
    }

    const guild = await findGuild(client);
    if (!guild) throw new Error('could not find the staff guild');
    await guild.roles.fetch().catch(() => {});

    const { roster } = await buildRoster(guild, week);
    review = plan({ week, weekStart, weekEnd, guildId: guild.id, roster });

    store.setReview(week, review);
    store.saveNow();
    console.log(`[staff review] planned week ${week}: ${Object.keys(review.entries).length} members`);
  }

  await resume(client, review);
  console.log(`[staff review] week ${week} complete`);
  return review;
}

// Called every minute. Finishes unfinished reviews first, then reviews the
// week that just ended if nobody has yet.
async function tick(client, now = Date.now(), { force = false } = {}) {
  if (!cfg.enabled || running) return false;
  running = true;

  try {
    const current = weekStartFor(now);
    const previous = weekStartFor(current - 1);

    for (const [week, review] of Object.entries(store.allReviews())) {
      if (['complete', 'skipped', 'abandoned'].includes(review.status)) continue;

      if (now - Number(review.weekEnd) > 14 * DAY) {
        review.status = 'abandoned';
        store.saveNow();
        continue;
      }
      if (!force && now - (lastAttempt.get(week) || 0) < 5 * 60 * 1000) continue;
      lastAttempt.set(week, now);
      await resume(client, review).catch((err) => console.error(`[staff review] resume ${week} failed:`, err));
    }

    if (!store.getReview(String(previous))) {
      const key = String(previous);
      if (force || now - (lastAttempt.get(key) || 0) >= 5 * 60 * 1000) {
        lastAttempt.set(key, now);
        await runForWeek(client, previous).catch((err) => console.error('[staff review] failed:', err));
      }
    }
  } finally {
    running = false;
  }
  return true;
}

// Used by /staff review preview: scores the week so far without saving or applying anything.
async function preview(guild, now = Date.now()) {
  const weekStart = weekStartFor(now);
  const week = String(weekStart);
  const { roster } = await buildRoster(guild, week);

  const snapshot = {
    history: structuredClone(store.load().history),
  };

  try {
    return plan({ week, weekStart, weekEnd: weekStartFor(weekStart + 8 * DAY), guildId: guild.id, roster, now });
  } finally {
    store.load().history = snapshot.history;
  }
}

// Setup problems management should know about (shown in /staff review status and at startup).
function diagnostics(guild) {
  const problems = [];

  if (!cfg.reportChannelId) {
    const fallback = reportChannelId();
    problems.push(
      fallback
        ? `Report channel is not set, using <#${fallback}> instead (staffManagement.reportChannelId).`
        : 'Report channel is not set and no fallback channel exists (staffManagement.reportChannelId).'
    );
  }
  if (!cfg.staffOfTheWeekRoleId) problems.push('Staff of the Week role is not set (staffManagement.staffOfTheWeekRoleId).');
  if (!cfg.baseRoleId) problems.push('Base Staff role is not set (staffManagement.baseRoleId).');
  if (!LADDER.length) problems.push('No valid rank roles in staffManagement.ladder.');

  if (guild) {
    const check = (id, name) => {
      const role = guild.roles.cache.get(id);
      if (!role) problems.push(`${name} role ${id} does not exist in this server.`);
      else if (!role.editable) problems.push(`I can't manage **${role.name}**: move my bot role above it.`);
    };

    for (const rank of LADDER) check(rank.roleId, rank.label);
    if (cfg.baseRoleId) check(cfg.baseRoleId, 'Staff');
    if (cfg.staffOfTheWeekRoleId) check(cfg.staffOfTheWeekRoleId, 'Staff of the Week');
  }

  return problems;
}

module.exports = {
  diagnostics,
  classify,
  plan,
  buildRoster,
  buildReport,
  applyDecision,
  applySotw,
  sendReport,
  runForWeek,
  tick,
  preview,
  reportChannelId,
  reviewId,
  labelOf,
};
