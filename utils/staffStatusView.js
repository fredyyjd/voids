const { EmbedBuilder } = require('discord.js');
const review = require('./staffReview');
const points = require('./staffPoints');
const activity = require('./activityCheck');

const BLUE = 0x3b82f6;

const clip = (text, max = 1000) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
const stamp = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function lines(rows, fmt, empty = '*Nobody*') {
  if (!rows.length) return empty;
  const out = [];
  let size = 0;
  for (const row of rows) {
    const line = fmt(row);
    if (size + line.length > 900) {
      out.push(`...and ${rows.length - out.length} more`);
      break;
    }
    out.push(line);
    size += line.length + 1;
  }
  return out.join('\n');
}

function bar(score) {
  const filled = Math.max(0, Math.min(10, Math.round(score / 10)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;
}

function flags(id, e) {
  const out = [];
  const missed = activity.getMissed(id);
  if (e.conduct.valid) out.push(`${e.conduct.valid} strike${e.conduct.valid === 1 ? '' : 's'}`);
  if (e.conduct.warns) out.push(`${e.conduct.warns} warn${e.conduct.warns === 1 ? '' : 's'}`);
  if (missed) out.push(`missed ${missed} check${missed === 1 ? '' : 's'}`);
  return out;
}

function tag(e) {
  if (e.decision?.type === 'promote') return 'Promotion';
  if (e.decision) return 'Demotion';
  if (e.loa) return 'On LOA';
  if (e.rec === 'NEEDS IMPROVEMENT') return 'At risk';
  if (e.strong) return 'Strong';
  if (e.safe) return 'Safe';
  return 'On track';
}

async function buildStaffEmbed(guild) {
  const draft = await review.preview(guild);
  const reviewed = Object.entries(draft.entries).filter(([, e]) => !e.exempt && e.rank);

  const promos = reviewed.filter(([, e]) => e.decision?.type === 'promote');
  const demos = reviewed.filter(([, e]) => e.decision && e.decision.type !== 'promote');
  // 15+ points this week = safe from warnings, unless they already hold a valid strike.
  const risk = reviewed.filter(
    ([id, e]) => !e.decision && !e.loa && ((!e.safe && (e.rec === 'NEEDS IMPROVEMENT' || flags(id, e).length)) || e.conduct.valid > 0)
  );
  const onLoa = reviewed.filter(([, e]) => e.loa).length;
  const strong = reviewed.filter(([, e]) => e.strong).length;
  const average = reviewed.length ? Math.round(reviewed.reduce((n, [, e]) => n + e.score, 0) / reviewed.length) : 0;

  const embed = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle('Staff Overview')
    .setDescription(
      `Week of ${stamp(draft.weekStart, 'D')} · review runs ${stamp(points.nextResetMs())}\n\n` +
        `**${reviewed.length}** staff · **${promos.length}** promotions · **${demos.length}** demotions · **${risk.length}** at risk · **${onLoa}** on LOA\n` +
        `Average score **${average}** · **${strong}** having a strong week`
    );

  embed.addFields(
    {
      name: `Promotions (${promos.length})`,
      value: lines(
        promos,
        ([id, e]) => `<@${id}> · ${e.rankLabel} to **${e.rec.replace('PROMOTE to ', '')}** · score ${e.score}`,
        '*Nobody is on track for a promotion yet*'
      ),
    },
    {
      name: `Demotions (${demos.length})`,
      value: lines(demos, ([id, e]) => `<@${id}> · ${e.rankLabel} to **${e.rec.replace('DEMOTE to ', '')}** · ${e.reason}`, '*Nobody*'),
    },
    {
      name: `At risk of a warning (${risk.length})`,
      value: lines(
        risk,
        ([id, e]) => `<@${id}> · score ${e.score}${flags(id, e).length ? ` · ${flags(id, e).join(', ')}` : ''}`,
        '*Nobody right now*'
      ),
    }
  );

  const sotw = draft.sotw;
  embed.addFields({
    name: 'Staff of the Week',
    value: clip(
      sotw.winner
        ? `<@${sotw.winner}> looks like the pick right now.\n${sotw.reason || ''}`.trim()
        : `Nobody qualifies yet.\n${sotw.reason || ''}`.trim()
    ),
  });

  const ranked = [...reviewed].sort(([, a], [, b]) => b.score - a.score);
  const rows = ranked.slice(0, 24);
  const row = ([id, e], i) =>
    `**${i + 1}.** <@${id}> · ${e.rankLabel}\n${bar(e.score)} **${e.score}** · ${points.pointsFor(id)} pts · ${tag(e)}`;

  for (let start = 0; start < rows.length; start += 6) {
    const chunk = rows.slice(start, start + 6);
    embed.addFields({
      name: start === 0 ? 'Scores and points' : '\u200b',
      value: clip(chunk.map((entry, i) => row(entry, start + i)).join('\n')),
    });
  }
  if (!rows.length) embed.addFields({ name: 'Scores and points', value: '*No activity tracked yet*' });
  if (ranked.length > rows.length) embed.addFields({ name: '\u200b', value: `*...and ${ranked.length - rows.length} more*` });

  const notes = [];
  if (draft.degraded) notes.push('The bot was offline for a lot of this week, so promotions and Staff of the Week would be skipped.');
  const problems = review.diagnostics(guild).filter((p) => !/staff of the week/i.test(p));
  if (problems.length) notes.push(problems.slice(0, 3).join(' · '));

  if (notes.length) embed.addFields({ name: 'Notes', value: clip(notes.join('\n')) });

  return embed
    .setFooter({ text: 'Live preview, nothing is applied until the weekly review runs' })
    .setTimestamp();
}

module.exports = { buildStaffEmbed, lines, clip, stamp };
