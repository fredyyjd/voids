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
    reward: 2, // VB for every correct count
    cooldownMs: 5 * 60 * 60 * 1000, // each person can count once every 5 hours
  },

  // Every achievement pays the same.
  ACHIEVEMENT_REWARD: 2,

  // VB for chatting: every `everyMessages` real messages pays `reward`.
  ACTIVITY: {
    everyMessages: 10,
    reward: 1.5,
    minGapMs: 15 * 1000, // messages sent faster than this do not count
    minChars: 4, // after links, mentions and emojis are removed
    dailyCapVb: 15, // most VB a person can earn from chatting per day
  },

  EXTRA_ENTRY_PRICE: 45,

  // Shop items. Add more here later.
  ITEMS: {
    colour_red: { type: 'colour', name: 'Red', emoji: '🔴', price: 25, color: 0xed4245, roleId: '1573906214935461999', desc: 'A bold red name' },
    colour_blue: { type: 'colour', name: 'Blue', emoji: '🔵', price: 25, color: 0x3b82f6, roleId: '1573906272980308118', desc: 'A cool blue name' },
    colour_green: { type: 'colour', name: 'Green', emoji: '🟢', price: 25, color: 0x57f287, roleId: '1573906328760615052', desc: 'A fresh green name' },
    colour_mix: {
      type: 'colour',
      name: 'Mix',
      emoji: '🟣',
      roleId: '1573906385106894959',
      price: 25,
      color: 0xa855f7,
      gradient: [0xa855f7, 0xec4899, 0x3b82f6], // used when the server supports gradient roles
      desc: 'A purple, pink and blue blend',
    },
    extra_entry: {
      type: 'entry',
      name: 'Extra Giveaway Entry',
      emoji: '🎟️',
      price: 45,
      desc: 'Doubles your chance in one giveaway you already joined',
    },
  },
};
