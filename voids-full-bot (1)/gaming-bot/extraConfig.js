// =====================================================================
// EXTRA FEATURE SETTINGS (schematics, partner pings, staff strikes, ping guard)
// Everything you'll want to edit for these features is in this file.
// Any value that starts with PUT_ is treated as "not set yet".
// =====================================================================
module.exports = {
  // ---------------------------------------------------------------
  // SCHEMATIC POSTER
  // Staff forward (or post) a schematic in a SOURCE channel. The bot
  // re-posts the files in the matching POSTING (public) channel using
  // the template below, then updates the count panel.
  // ---------------------------------------------------------------
  schematics: {
    enabled: true,

    // key      = short id used by the bot (don't change once schematics exist)
    // source   = the channel staff forward the schem to (the bot reads it, never posts here)
    // posting  = the public SCHEMS channel the bot posts it in
    // emoji    = shown on the panel + dropdown. Normal emoji or '<:name:id>' / '<a:name:id>'
    categories: [
      { key: 'stashes', label: 'Stashes',       emoji: '🏠', source: '1568023356522102794', posting: '1565869443861708910' },
      { key: 'gamble',  label: 'Gamble Bases',  emoji: '🎰', source: '1568023402541744238', posting: '1565869764633436241' },
      { key: 'regear',  label: 'Regear Bases',  emoji: '🛡️', source: '1568023446879735931', posting: '1565870049372410057' },
      { key: 'rgear',   label: 'Rgear',         emoji: '⚔️', source: '1568023500621488229', posting: '1565870328134107156' },
      { key: 'traps',   label: 'Traps',         emoji: '🪤', source: '1568023563657805865', posting: '1565870447252349038' },
    ],

    // Channel the /schem panel is posted in (the schematic count + search).
    countChannelId: '1567859007589449789',

    // Posting cooldown: one schematic post per person every N seconds.
    postCooldownSeconds: 20,

    // If someone keeps posting during the cooldown (spamming), they get a DM.
    spamWarn: {
      attempts: 10, // blocked tries inside the window below = DM
      windowSeconds: 60,
      dmCooldownMinutes: 30, // don't DM the same person again for this long
      dm: "Hey, we see you're locked in on posting schems, but don't post so much. It looks like you're trying to abuse the points system. If it happens again you may be warned.",
    },

    // Extra roles allowed to post schematics. Staff (admin / support / mod roles)
    // and anyone with Administrator are always allowed.
    posterRoleIds: [],

    // The post. {title} = schematic name, {id} = schematic id (SI).
    template: {
      title: '## <:Emojis_32x32_96:1545306265004023858> __{title}__',
      lines: [
        '> Taking this schematic without right credit to the creator or this discord will result in a ban!',
        '> SI: {id}',
      ],
    },

    panel: {
      title: 'Schematic Count',
      footer: 'Auto updating schematic search',
      color: '#3B82F6',
      placeholder: 'Search schematics - pick a category',
    },

    // File types that count as images (everything else counts as "the schematic file").
    imageExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
  },

  // ---------------------------------------------------------------
  // /partner ping
  // ---------------------------------------------------------------
  partner: {
    partnershipPingRoleId: '1536027286724157491',
    memberRoleId: '1496446108279242762',

    // @Member pings are sent here with Accept / Deny buttons first.
    approvalChannelId: '1558837519276314725',

    // Optional: roles pinged on the approval message (management).
    approvalPingRoleIds: [],

    // Extra roles that can use /partner (staff are always allowed).
    managerRoleIds: [],
  },

  // ---------------------------------------------------------------
  // /staff strike | warn | view | reset   (Administrator only)
  // 3 warns = 1 strike (automatic). 3 strikes = demotion (done manually,
  // the bot just alerts management).
  // ---------------------------------------------------------------
  staff: {
    warnsPerStrike: 3,
    strikesForDemotion: 3,
    // Where strikes / warns are logged. Falls back to modLogChannelId.
    logChannelId: '',
    // Roles pinged when someone hits the demotion line. Falls back to adminRoleIds.
    alertRoleIds: [],
  },

  // ---------------------------------------------------------------
  // STAFF POINTS  (/staff lb and /staff all-time)
  // Staff earn points for tickets and schematic posts. The weekly board
  // resets every Sunday at 12pm in the timezone below.
  // ---------------------------------------------------------------
  staffPoints: {
    points: { close: 2, rename: 2, claim: 1, post: 0.25 },
    postCooldownSeconds: 20, // posts closer together than this don't earn points
    timezone: 'Australia/Sydney', // e.g. 'America/New_York', 'Europe/London', 'UTC'
    resetDay: 0, // 0 = Sunday
    resetHour: 12, // 12 = 12pm
  },

  // ---------------------------------------------------------------
  // PING GUARD (anti ping-spam)
  // ---------------------------------------------------------------
  pingGuard: {
    enabled: true,

    // 3 real @everyone / @here pings inside 10 minutes = ban
    everyone: { limit: 3, windowMinutes: 10 },

    // 3 quick drop role pings inside 1 minute = 10 minute timeout
    quickDrop: {
      roleId: '1526927287486779566',
      limit: 3,
      windowMinutes: 1,
      timeoutMinutes: 10,
    },

    // Falls back to antiNuke.alertChannelId, then modLogChannelId.
    alertChannelId: '',

    // The server owner and anyone in antiNuke.whitelistedUserIds (config.json)
    // are never punished. Add more ids here if you need to.
    whitelistedUserIds: [],
  },
};
