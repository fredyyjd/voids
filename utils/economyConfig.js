// Everything you might want to tune for Void Bucks (VB) lives here.

module.exports = {
  CURRENCY: 'VB',
  FOOTER: 'VB = Void Bucks',

  // Colour roles are created just above this role so the colour shows.
  MEMBER_ROLE_ID: '1496446108279242762',

  // Custom emojis (fall back to plain ones if the bot cannot use them).
  EMOJI: {
    tick: '<:green_tick_head:1573510507854303323>',
    cross: '<:red_x_head:1573510477215174869>',
    loading: '<:blue_loading_head:1573510444889546942>',
  },

  COUNTING: {
    reward: 3, // VB for every correct count
    cooldownMs: 3 * 60 * 60 * 1000, // each person can count once every 3 hours
  },

  // Every achievement pays the same.
  ACHIEVEMENT_REWARD: 5,

  // Achievement messages all go here, with the achievement leaderboard stuck at the bottom.
  ACHIEVEMENT_CHANNEL_ID: '1573931945686208554',

  // VB for chatting: every `everyMessages` real messages pays `reward`.
  ACTIVITY: {
    everyMessages: 10,
    reward: 3,
    minGapMs: 20 * 1000, // messages sent faster than this do not count
    minChars: 4, // after links, mentions and emojis are removed
    dailyCapVb: 50, // most VB a person can earn from chatting per day
    recentSize: 8, // how many recent messages are checked for repeats
  },

  // Catching people who farm VB. Points add up inside the window, and reaching the limit is a strike.
  ABUSE: {
    windowMs: 10 * 60 * 1000,
    pointLimit: 12,
    rateDrop: 0.35, // every strike cuts their earn rate by this much
    minRate: 0.05,
    burstMs: 3000, // messages closer together than this count as a burst
    macroSpreadMs: 1500, // 6 counted messages all spaced almost the same = a macro
    ladder: [
      { action: 'warn' },
      { action: 'timeout', ms: 10 * 60 * 60 * 1000 },
      { action: 'timeout', ms: 24 * 60 * 60 * 1000 },
      { action: 'timeout', ms: 3 * 24 * 60 * 60 * 1000 },
      { action: 'timeout', ms: 7 * 24 * 60 * 60 * 1000 },
      { action: 'kick' },
      { action: 'ban' },
    ],
  },

  // /2x vb posts here and pings this role.
  BOOST_CHANNEL_ID: '1492832115006509127',
  BOOST_ROLE_ID: '1540984622165393428',

  MAX_SHOP_PRICE: 250,
  MAX_CUSTOM_ITEMS: 7,

  EXTRA_ENTRY_PRICE: 35,
  MAX_EXTRA_PER_GIVEAWAY: 3, // most extra entries one person can use on a single giveaway

  // What a Mystery Box can open into. Higher weight = more common.
  BOX_PRIZES: [
    { weight: 35, vb: 10 },
    { weight: 25, vb: 20 },
    { weight: 15, vb: 35 },
    { weight: 10, entries: 1 },
    { weight: 8, pass: 1 },
    { weight: 5, colour: true },
    { weight: 2, vb: 100, jackpot: true },
  ],

  // Shop items. Nothing costs more than 250 VB.
  ITEMS: {
    colour_red: { type: 'colour', name: 'Red', emoji: '🔴', price: 35, color: 0xed4245, roleId: '1573906214935461999', buttonStyle: 'Danger', desc: 'A bold red name' },
    colour_blue: { type: 'colour', name: 'Blue', emoji: '🔵', price: 35, color: 0x3b82f6, roleId: '1573906272980308118', buttonStyle: 'Primary', desc: 'A cool blue name' },
    colour_green: { type: 'colour', name: 'Green', emoji: '🟢', price: 35, color: 0x57f287, roleId: '1573906328760615052', buttonStyle: 'Success', desc: 'A fresh green name' },
    colour_gold: { type: 'colour', name: 'Gold', emoji: '🟡', price: 35, color: 0xfacc15, desc: 'A shiny gold name' },
    colour_pink: { type: 'colour', name: 'Pink', emoji: '💗', price: 35, color: 0xec4899, desc: 'A bright pink name' },
    colour_orange: { type: 'colour', name: 'Orange', emoji: '🟠', price: 35, color: 0xf97316, desc: 'A warm orange name' },
    colour_cyan: { type: 'colour', name: 'Cyan', emoji: '💧', price: 35, color: 0x22d3ee, desc: 'An icy cyan name' },
    colour_mix: {
      type: 'colour',
      name: 'Neon',
      buttonStyle: 'Secondary',
      emoji: '🟣',
      roleId: '1573906385106894959',
      price: 60,
      color: 0xa855f7,
      gradient: [0xa855f7, 0xec4899, 0x3b82f6],
      desc: 'A purple, pink and blue blend',
    },
    colour_sunset: {
      type: 'colour',
      name: 'Sunset',
      emoji: '🌅',
      price: 60,
      color: 0xf97316,
      gradient: [0xf97316, 0xec4899, 0xa855f7],
      desc: 'An orange, pink and purple blend',
    },
    colour_ocean: {
      type: 'colour',
      name: 'Ocean',
      emoji: '🌊',
      price: 60,
      color: 0x3b82f6,
      gradient: [0x22d3ee, 0x3b82f6, 0x6366f1],
      desc: 'A cyan, blue and indigo blend',
    },
    extra_entry: {
      type: 'entry',
      name: 'Extra Giveaway Entry',
      emoji: '🎟️',
      price: 35,
      buttonStyle: 'Primary',
      desc: 'One extra chance in a giveaway you already joined',
    },
    extra_entry3: {
      type: 'entry',
      name: 'Entry Bundle',
      emoji: '🎫',
      price: 90,
      amount: 3,
      buttonStyle: 'Primary',
      desc: '3 extra giveaway entries for less than buying them one by one',
    },
    count_pass: {
      type: 'pass',
      name: 'Count Pass',
      emoji: '⏩',
      price: 20,
      buttonStyle: 'Primary',
      desc: 'Count again straight away. Used automatically when you are on cooldown',
    },
    mystery_box: {
      type: 'box',
      name: 'Mystery Box',
      emoji: '🎁',
      price: 25,
      buttonStyle: 'Success',
      desc: 'Opens right away for a random prize, up to 100 VB',
    },
    role_legend: {
      type: 'role',
      name: 'Legend',
      emoji: '👑',
      price: 200,
      roleId: '1574191353124880544',
      buttonStyle: 'Secondary',
      desc: 'The Legend role, shown on your name for good',
    },
    badge_star: {
      type: 'badge',
      name: 'Star Badge',
      emoji: '⭐',
      price: 50,
      desc: 'A star next to your name in /achievements',
    },
    badge_flame: {
      type: 'badge',
      name: 'Flame Badge',
      emoji: '🔥',
      price: 50,
      desc: 'A flame next to your name in /achievements',
    },
    custom_role: {
      type: 'custom',
      name: 'Custom Role',
      emoji: '✨',
      price: 250,
      soon: true,
      desc: 'Make your own role with your own name and colour',
    },
  },
};
