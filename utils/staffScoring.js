const cfg = require('./staffConfig');

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ratio = (value, target) => (target > 0 ? clamp(value / target, 0, 1) : 1);

// Weekly score = counted staff points / pointsPerScore (default: 1 score per 2 points).
// countedPoints comes from staffPoints.protection(). Warns and strikes issued that week take a little off.
// stats is still used for the "kinds" of contribution (tickets, giveaways, schematics, duties).
function scoreWeek(stats, activeDays, conduct = { warns: 0, strikes: 0 }, sc = cfg.scoring, countedPoints = 0) {
  const tickets = stats.handled + stats.closed;
  const duties = stats.mod + stats.events;

  const base = countedPoints / (sc.pointsPerScore || 2);
  const penalty = conduct.warns * sc.warnPenalty + conduct.strikes * sc.strikePenalty;
  const score = Math.round(clamp(base - penalty, 0, 100) * 10) / 10;

  // Kinds of real contribution besides chatting.
  const kinds = [tickets >= 2, stats.giveaways >= 1, stats.schematics >= 1, duties >= 1].filter(Boolean).length;

  const strong =
    score >= sc.strongScore &&
    activeDays >= sc.minActiveDaysForStrong &&
    stats.msgs >= sc.minMessagesForStrong &&
    kinds >= sc.minContributionKinds &&
    conduct.strikes === 0;

  return {
    score,
    parts: { points: base },
    kinds,
    activeDays,
    tickets,
    duties,
    strong,
    ok: score >= sc.okScore,
  };
}

// Weeks the member has spent at this rank (LOA weeks are skipped, not counted)
// and how many of the latest ones in a row were strong.
function streakAtRank(entries, rankKey) {
  let weeks = 0;
  let strongRun = 0;
  let runOpen = true;

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.rank !== rankKey) break;
    if (e.loa) continue;

    weeks += 1;
    if (runOpen && e.strong) strongRun += 1;
    else runOpen = false;
  }

  return { weeks, strongRun };
}

// How many of the last N reviewed weeks were acceptable (used as consistency).
function consistency(entries, n = 4) {
  const recent = entries.filter((e) => !e.loa).slice(-n);
  if (!recent.length) return { ok: 0, of: 0 };
  return { ok: recent.filter((e) => e.ok).length, of: recent.length };
}

function averageScore(entries, rankKey, n) {
  const recent = entries.filter((e) => e.rank === rankKey && !e.loa).slice(-n);
  if (!recent.length) return 0;
  return Math.round(recent.reduce((a, e) => a + e.score, 0) / recent.length);
}

// Promotion check. `entries` already includes the week being reviewed.
function promotionCheck({ entries, rankKey, nextLabel, clean, promotion = cfg.promotion }) {
  const rule = promotion[rankKey];
  if (!rule || !nextLabel) return { eligible: false, why: 'no automatic promotion from this rank' };

  const { weeks, strongRun } = streakAtRank(entries, rankKey);

  if (!clean.ok) return { eligible: false, why: clean.why, weeks, strongRun };
  if (weeks < rule.strongWeeks) {
    return { eligible: false, why: `${weeks}/${rule.strongWeeks} weeks at this rank so far`, weeks, strongRun };
  }
  if (weeks % rule.everyWeeks !== 0) {
    const wait = rule.everyWeeks - (weeks % rule.everyWeeks);
    return { eligible: false, why: `promotion is reviewed every ${rule.everyWeeks} weeks, next review in ${wait}`, weeks, strongRun };
  }
  if (strongRun < rule.strongWeeks) {
    return {
      eligible: false,
      why: `needs ${rule.strongWeeks} strong weeks in a row, has ${strongRun}`,
      weeks,
      strongRun,
    };
  }

  return { eligible: true, weeks, strongRun, needed: rule.strongWeeks };
}

// Staff of the Week: the best qualifier, avoiding a recent winner when someone
// almost as good qualified. `candidates` are already qualified.
function pickStaffOfTheWeek(candidates, recentWinnerIds, sc = cfg.staffOfTheWeek) {
  if (!candidates.length) return null;

  const sorted = [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      b.consistency - a.consistency ||
      b.kinds - a.kinds ||
      String(a.userId).localeCompare(String(b.userId))
  );

  const recent = new Set(recentWinnerIds);
  const top = sorted[0];
  if (!recent.has(top.userId)) return top;

  const alternative = sorted.find((c) => !recent.has(c.userId) && c.score >= top.score - sc.equalMargin);
  return alternative || top;
}

module.exports = {
  scoreWeek,
  streakAtRank,
  consistency,
  averageScore,
  promotionCheck,
  pickStaffOfTheWeek,
};
