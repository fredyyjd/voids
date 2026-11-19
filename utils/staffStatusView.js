const { EmbedBuilder } = require('discord.js');
const staffCfg = require('./staffConfig');
const review = require('./staffReview');
const points = require('./staffPoints');

const BLUE = 0x3b82f6;

const clip = (text, max = 1000) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
const stamp = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function lines(rows, fmt, empty = '*Nobody right now*') {
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

async function buildStaffEmbed(guild) {
  const draft = await review.preview(guild);
  const all = Object.entries(draft.entries);
  const reviewed = all.filter(([, e]) => !e.exempt && e.rank);
  const promos = reviewed.filter(([, e]) => e.decision?.type === 'promote');
  const demos = reviewed.filter(([, e]) => e.decision && e.decision.type !== 'promote');
  const attention = reviewed.filter(([, e]) => e.rec === 'NEEDS IMPROVEMENT');
  const strong = reviewed.filter(([, e]) => e.strong && !e.decision);
  const onLoa = all.filter(([, e]) => e.loa).length;
  const exempt = all.filter(([, e]) => e.exempt).length;

  const average = reviewed.length ? Math.round(reviewed.reduce((n, [, e]) => n + e.score, 0) / reviewed.length) : 0;
  const top = [...reviewed].sort(([, a], [, b]) => b.score - a.score).slice(0, 5);

  const embed = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle('Staff right now')
    .setDescription(
      `Week started ${stamp(draft.weekStart, 'D')} · review runs ${stamp(points.nextResetMs())}\n` +
        `Looking at **${reviewed.length}** staff · exempt **${exempt}** · on LOA **${onLoa}**\n` +
        `Average score **${average}** · strong weeks so far **${reviewed.filter(([, e]) => e.strong).length}**`
    );

  embed.addFields(
    {
      name: `⬆️ Looking like promotions (${promos.length})`,
      value: lines(promos, ([id, e]) => `<@${id}> · ${e.rankLabel} → ${e.rec.replace('PROMOTE to ', '')}`, '*Nobody is on track for a promotion this week*'),
    },
    {
      name: `⬇️ Looking like demotions (${demos.length})`,
      value: lines(demos, ([id, e]) => `<@${id}> · ${e.rankLabel} → ${e.rec.replace('DEMOTE to ', '')}`, '*None*'),
    }
  );

  const sotw = draft.sotw;
  const runnersUp = top.filter(([id]) => id !== sotw.winner).slice(0, 3);
  let sotwText = sotw.winner
    ? `**<@${sotw.winner}>** is the pick right now.\n${sotw.reason}`
    : `Nobody qualifies right now.\n${sotw.reason || ''}`.trim();
  if (runnersUp.length) {
    sotwText += `\nClosest: ${runnersUp.map(([id, e]) => `<@${id}> (${e.score})`).join(', ')}`;
  }
  if (!staffCfg.staffOfTheWeekRoleId) {
    sotwText += '\n-# The Staff of the Week role is not set yet, so nobody gets the role.';
  }
  embed.addFields({ name: '🏆 Staff of the Week (right now)', value: clip(sotwText) });

  embed.addFields(
    {
      name: 'Top scores',
      value: lines(top, ([id, e], i) => `${i + 1}. <@${id}> · ${e.rankLabel} · **${e.score}**${e.strong ? ' (strong)' : ''}`, '*No data yet*'),
    },
    {
      name: `⚠️ Needs attention (${attention.length})`,
      value: lines(attention, ([id, e]) => `<@${id}> · ${e.rankLabel} · score ${e.score} · ${e.stats.msgs} msgs, ${e.stats.activeDays} active days`, '*Nobody*'),
    },
    {
      name: 'On a strong week but not promoted yet',
      value: lines(strong.slice(0, 20), ([id, e]) => `<@${id}> · ${e.rankLabel} · ${e.score}`, '*Nobody*'),
    }
  );

  const notes = [];
  if (draft.degraded) notes.push('The bot was offline for a lot of this week, so promotions and Staff of the Week would be skipped.');
  const problems = review.diagnostics(guild);
  if (problems.length) notes.push(`Setup: ${problems.slice(0, 4).join(' · ')}`);
  notes.push('This is a live preview. Nothing is applied until the weekly review runs.');
  embed.addFields({ name: 'Notes', value: clip(notes.join('\n')) });

  return embed.setTimestamp();
}

module.exports = { buildStaffEmbed, lines, clip, stamp };
