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
    // source   = private channel where staff forward the schem
    // posting  = public channel where the bot posts it
    // emoji    = shown on the panel + dropdown. Normal emoji or '<:name:id>' / '<a:name:id>'
    categories: [
      { key: 'stashes', label: 'Stashes',      emoji: '🏠', source: '1565869443861708910', posting: '1568023356522102794' },
      { key: 'gamble',  label: 'Gamble Bases', emoji: '🎰', source: '1565869764633436241', posting: '1568023446879735931' },
      // NOTE: this posting id is the same as Gamble's - send me the right one if that was a typo.
      { key: 'regear',  label: 'Regear Bases', emoji: '🛡️', source: '1565870049372410057', posting: '1568023446879735931' },
      { key: 'traps',   label: 'Traps',        emoji: '🪤', source: '1565870328134107156', posting: '1568023500621488229' },
    ],

    // Channel the /schem panel is posted in (the schematic count + search).
    countChannelId: '1567859007589449789',

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
