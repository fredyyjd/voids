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
  // 3 warns = 1 strike (automatic). 2 valid strikes = demotion, applied by the
  // weekly staff review (see staffManagement below).
  // ---------------------------------------------------------------
  staff: {
    warnsPerStrike: 3,
    strikesForDemotion: 2,
    // Where strikes / warns are logged (same channel as the automatic results).
    logChannelId: '1558783436565782598',
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
  // LOA (leave of absence)  -  /loa request
  // Staff type how many days (max 30) and why. It is sent to the channel
  // below with Accept / Deny buttons. Accept gives them the LOA role until
  // their time is up, then the bot takes it off again.
  // ---------------------------------------------------------------
  loa: {
    enabled: true,
    channelId: '1558837519276314725', // requests are sent here
    roleId: '1546334249114796033', // the role they get while on LOA
    maxDays: 30,
    reviewerRoleIds: [], // extra roles that can Accept / Deny (admins always can)
    requesterRoleIds: [], // extra roles that can request LOA (staff roles already can)
  },

  // ---------------------------------------------------------------
  // TICKET CLOSE REQUESTS
  // When staff press Close the ticket owner is asked "solved / helped?".
  // After the owner presses Deny, staff can ask again after this long.
  // ---------------------------------------------------------------
  ticketClose: {
    askAgainSeconds: 20,
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

  // ---------------------------------------------------------------
  // STAFF MANAGEMENT  (activity tracking, weekly report, promotions,
  // demotions, Staff of the Week)
  // The review runs when the staff points week ends (staffPoints.timezone /
  // resetDay / resetHour above). Only IDs and the main numbers are listed
  // here, every other number has a default in utils/staffConfig.js and can be
  // overridden by adding the same key here.
  // ---------------------------------------------------------------
  staffManagement: {
    enabled: true,

    // These roles are exempt from every automatic staff action and automod
    // punishment. The bot never removes them.
    bypassRoleIds: ['1526913504668287026', '1547869336486551643'],

    // true = bypass holders are also ignored by anti-nuke. Set false if you
    // want anti-nuke to still stop a compromised management account.
    exemptFromAntiNuke: true,

    // Base staff role (given on top of the rank role).
    baseRoleId: '1526936584253997146',

    // Automatic ranks, lowest to highest. Sr Admin, Head Manager and above are
    // manual only and must never be listed here.
    ladder: [
      { key: 'trial', label: 'Trial Staff', roleId: '1547853612607348766' },
      { key: 'helper', label: 'Helper', roleId: '1526912674649083936' },
      { key: 'srhelper', label: 'Sr Helper', roleId: '1526913846776692776' },
      { key: 'mod', label: 'Mod', roleId: '1492833649123393676' },
      { key: 'srmod', label: 'Sr Mod', roleId: '1526911450466222203' },
      { key: 'admin', label: 'Admin', roleId: '1492834161042522213' },
    ],

    // Extra roles that are manual only (Sr Admin, Head Manager, owners...).
    // Anyone holding one is never touched. Anyone holding an Administrator role
    // that is not on the ladder is also treated as manual automatically.
    manualOnlyRoleIds: [],

    // Where the weekly management report goes. Falls back to the staff log channel.
    reportChannelId: '1558783436565782598',

    // Role given to the Staff of the Week (placeholder until you make the role).
    staffOfTheWeekRoleId: 'PUT_STAFF_OF_THE_WEEK_ROLE_ID_HERE',
    // true = bypass-role holders may also be picked as Staff of the Week.
    staffOfTheWeekAllowBypass: false,

    // Messages in these channels never count as activity.
    excludedMessageChannelIds: ['1563392820885061692', '1537659467838132304'],

    // Valid strikes older than this stop counting (0 = never expire).
    strikes: { expiryDays: 60 },
  },

  // ---------------------------------------------------------------
  // AUTO MODERATION (beta): spam, @everyone / @here and mention abuse
  // Members with the bypass roles (staffManagement.bypassRoleIds), the server
  // owner and Administrators are never punished. Everything below can be tuned.
  // ---------------------------------------------------------------
  autoMod: {
    enabled: true,

    // Falls back to pingGuard.alertChannelId, antiNuke.alertChannelId, then modLogChannelId.
    logChannelId: '',

    // Added to the end of "If you think this was a mistake, ..." in the DM.
    contactText: 'please contact a higher staff member (an Admin or Manager) and they will review it.',

    exemptRoleIds: ['1526913504668287026', '1547869336486551643'],
    exemptChannelIds: [],

    // Extra roles allowed to use @everyone / @here and mention many people or roles.
    // Anyone with the Mention Everyone permission in the channel is allowed already.
    authorizedMentionRoleIds: [],

    actionCooldownSeconds: 10,

    // A repeat offence inside this time adds repeatAddMinutes to the timeout.
    repeatLookbackHours: 24,

    // About 10 messages in 15 seconds = spam. 30 minute timeout, +30 minutes per recent repeat.
    spam: { enabled: true, messages: 10, windowSeconds: 15, timeoutMinutes: 30, repeatAddMinutes: 30 },

    // Unauthorised @everyone / @here: message deleted, 1 hour timeout, +1 hour per recent repeat.
    // punishAttempts: true also catches the text when Discord blocked the real ping.
    everyone: { enabled: true, timeoutMinutes: 60, repeatAddMinutes: 60, punishAttempts: true },

    // Too many people / roles mentioned (per message, and across a short window).
    mentions: {
      enabled: true,
      maxUsersPerMessage: 6,
      maxRolesPerMessage: 3,
      windowSeconds: 30,
      maxUsersInWindow: 12,
      maxRolesInWindow: 5,
      timeoutMinutes: 15,
      repeatAddMinutes: 15,
    },
  },

  // ---------------------------------------------------------------
  // AUTOMATIC WEEKLY ACTIVITY CHECK
  // The bot posts the normal activity check (pings the staff roles, they must
  // react) in channelId once a week on a random day at the set time. The
  // results, warnings and strikes still go to the strikes channel
  // (WARN_CHANNEL_ID in utils/activityCheck.js) 5 hours later, as before.
  // firstPostAt is used once (bot timezone), then it is random every week.
  // ---------------------------------------------------------------
  activityCheckAuto: {
    enabled: true,
    channelId: '1558777181633515610',
    timezone: 'Australia/Sydney',
    hour: 17,
    minute: 0,
    firstPostAt: '2026-11-19T17:56',
  },

};
