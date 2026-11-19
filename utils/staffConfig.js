const extra = require('../extraConfig');
const config = require('../config.json');

const DEFAULTS = {
  enabled: true,
  bypassRoleIds: [],
  exemptFromAntiNuke: true,
  baseRoleId: null,
  ladder: [],
  manualOnlyRoleIds: [],
  reportChannelId: null,
  staffOfTheWeekRoleId: null,
  staffOfTheWeekAllowBypass: false,
  excludedMessageChannelIds: [],
  excludeTicketChannels: true,

  messages: {
    minChars: 8,
    minWords: 2,
    minGapSeconds: 8,
    maxPerHour: 40,
    maxPerDay: 150,
    conversationWindowMinutes: 15,
    minMessagesForActiveDay: 3,
  },

  tickets: { minCloseAgeSeconds: 120, maxClosesPerHour: 12 },
  giveaways: { minEntrants: 3, minRuntimeSeconds: 300, expectedPerWeek: 1 },
  schematics: { maxPerDay: 10 },

  scoring: {
    targets: { messages: 60, activeDays: 5, tickets: 8, schematics: 4, duties: 4 },
    weights: { consistency: 25, messages: 15, tickets: 25, giveaways: 10, schematics: 10, duties: 15 },
    giveawayBonusEach: 2.5,
    giveawayBonusMax: 5,
    warnPenalty: 5,
    strikePenalty: 20,
    strongScore: 70,
    okScore: 40,
    minActiveDaysForStrong: 4,
    minMessagesForStrong: 15,
    minContributionKinds: 2,
  },

  // everyWeeks: promotion is only reviewed when the weeks spent at the rank
  // are a multiple of this. strongWeeks: consecutive strong weeks required.
  promotion: {
    trial: { everyWeeks: 2, strongWeeks: 2 },
    helper: { everyWeeks: 1, strongWeeks: 3 },
    srhelper: { everyWeeks: 2, strongWeeks: 4 },
    mod: { everyWeeks: 2, strongWeeks: 4 },
    srmod: { everyWeeks: 1, strongWeeks: 6 },
  },

  conduct: { warnLookbackDays: 14, strikeLookbackWeeks: 4 },
  strikes: { expiryDays: 60 },

  staffOfTheWeek: { minScore: 75, cooldownWeeks: 3, equalMargin: 8, cleanWeeks: 4 },

  maxDowntimeHoursForPromotions: 12,
  historyWeeks: 26,
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const [key, value] of Object.entries(over || {})) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && typeof base[key] === 'object' && !Array.isArray(base[key])
        ? merge(base[key], value)
        : value;
  }
  return out;
}

function isSet(id) {
  return typeof id === 'string' && /^\d{15,25}$/.test(id);
}

const cfg = merge(DEFAULTS, extra.staffManagement || {});

cfg.bypassRoleIds = (cfg.bypassRoleIds || []).filter(isSet);
cfg.manualOnlyRoleIds = (cfg.manualOnlyRoleIds || []).filter(isSet);
cfg.baseRoleId = isSet(cfg.baseRoleId) ? cfg.baseRoleId : null;
cfg.reportChannelId = isSet(cfg.reportChannelId) ? cfg.reportChannelId : null;
cfg.staffOfTheWeekRoleId = isSet(cfg.staffOfTheWeekRoleId) ? cfg.staffOfTheWeekRoleId : null;
cfg.excludedMessageChannelIds = (cfg.excludedMessageChannelIds || []).filter(isSet);

// A ladder role that is also bypass or manual only is dropped, never managed.
const blocked = new Set([...cfg.bypassRoleIds, ...cfg.manualOnlyRoleIds]);
cfg.ladder = (cfg.ladder || []).filter((r) => r && r.key && isSet(r.roleId) && !blocked.has(r.roleId));

cfg.ladderIds = new Set(cfg.ladder.map((r) => r.roleId));
cfg.managedRoleIds = new Set(
  [...cfg.ladderIds, cfg.baseRoleId, cfg.staffOfTheWeekRoleId].filter(Boolean)
);
cfg.loaRoleId = isSet(extra.loa?.roleId) ? extra.loa.roleId : null;

function ticketCategoryIds() {
  const ids = [
    config.ticketCategoryId,
    config.applicationTicketCategoryId,
    config.serviceTicketCategoryId,
    ...Object.values(config.ticketCategoryParents || {}),
  ];
  return new Set(ids.filter(isSet));
}

cfg.ticketCategoryIds = ticketCategoryIds();
cfg.isSet = isSet;
cfg.DEFAULTS = DEFAULTS;

module.exports = cfg;
