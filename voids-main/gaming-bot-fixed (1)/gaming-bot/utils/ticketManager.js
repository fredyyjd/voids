const { MessageFlags } = require('discord.js');
const {
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const config = require('../config.json');
const { buildTranscript } = require('./transcript');
const {
  buildApplicationEmbed,
  buildDecisionRow,
  updateApplicationRefs,
} = require('./applicationManager');
const { incrementStat } = require('./staffTracker');
const { COLOR } = require('./theme');
const { box, priv, swapRow } = require('./box');

// Custom button emojis
const CLAIM_EMOJI = '<:Emojis_32x32_295:1545313653719433246>';
const CLOSE_EMOJI = '<:Emojis_32x32_95:1545306402715598879>';
const CLOSE_REASON_EMOJI = '<:Emojis_32x32_97:1545306211858260039>';

// "Giveaway Claim" -> "giveaway-claim"
function slugify(text, fallback = 'ticket') {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || fallback
  );
}


/* =========================================================
   TICKET METADATA
========================================================= */

function parseTopic(topic) {
  if (!topic) return null;

  // Custom tickets are not normal category tickets.
  // Format: custom_ticket|USER_ID|DEV_ROLE_ID
  if (topic.startsWith('custom_ticket|')) {
    const [, userId, customRoleId] = topic.split('|');

    if (!userId || !customRoleId) return null;

    return {
      userId,
      categoryId: `custom_${customRoleId}`,
      customRoleId,
      isCustom: true,
    };
  }

  if (!topic.startsWith('ticket|')) return null;

  const [, userId, categoryId] = topic.split('|');

  if (!userId || !categoryId) return null;

  return {
    userId,
    categoryId,
    isCustom: false,
  };
}


function countOpenTicketsForUser(guild, userId) {
  return guild.channels.cache.filter((channel) => {
    const meta = parseTopic(channel.topic);

    return meta && meta.userId === userId;
  }).size;
}

// Max open tickets per user, counted across every ticket type
// (normal, service, application and custom).
const MAX_OPEN_TICKETS = config.maxOpenTicketsPerUser || 2;

// Returns a reply string if the user is at the limit, otherwise null.
function getTicketLimitMessage(guild, userId) {
  const open = countOpenTicketsForUser(guild, userId);
  if (open < MAX_OPEN_TICKETS) return null;

  return `you already have ${open} open tickets. close one before opening another.`;
}


/* =========================================================
   TICKET BUTTONS
========================================================= */

function buildTicketControlRow(claimed = false, claimerId = null) {
  // When claimed, the claim button turns into an Unclaim button.
  // The claimer's ID is stored in the customId so we know who claimed it.
  const claimButton = claimed
    ? new ButtonBuilder()
        .setCustomId(`ticket_unclaim:${claimerId || '0'}`)
        .setLabel('Unclaim')
        .setEmoji(CLAIM_EMOJI)
        .setStyle(ButtonStyle.Secondary)
    : new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Claim')
        .setEmoji(CLAIM_EMOJI)
        .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(
    claimButton,

    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close')
      .setEmoji(CLOSE_EMOJI)
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId('ticket_close_reason')
      .setLabel('Close with Reason')
      .setEmoji(CLOSE_REASON_EMOJI)
      .setStyle(ButtonStyle.Secondary)
  );
}


/* =========================================================
   ROLE HELPERS
========================================================= */

function getTicketRoleIds() {
  return (config.ticketRoleIds || []).filter(
    (id) =>
      id &&
      typeof id === 'string' &&
      !id.startsWith('PUT_')
  );
}


function getApplicationTicketRoleIds() {
  return (config.applicationTicketRoleIds || []).filter(
    (id) =>
      id &&
      typeof id === 'string' &&
      !id.startsWith('PUT_')
  );
}


function getServiceTicketRoleIds() {
  const ids = (config.serviceTicketRoleIds || []).filter(
    (id) =>
      id &&
      typeof id === 'string' &&
      !id.startsWith('PUT_')
  );

  return ids.length
    ? ids
    : getTicketRoleIds();
}


/* =========================================================
   CATEGORY HELPERS
========================================================= */

function isApplicationTicket(categoryId) {
  return (config.applications || []).some(
    (application) =>
      application.id === categoryId
  );
}


function isServiceTicket(categoryId) {
  return (config.serviceCategories || []).some(
    (category) =>
      category.id === categoryId
  );
}


function findCategory(categoryId) {
  return (
    (config.categories || []).find(
      (category) =>
        category.id === categoryId
    )

    ||

    (config.serviceCategories || []).find(
      (category) =>
        category.id === categoryId
    )
  );
}


function getRoleIdsForTicket(categoryId) {
  const category = findCategory(categoryId);

  const categoryRoleIds = (
    category?.roleIds || []
  ).filter(
    (id) =>
      id &&
      typeof id === 'string' &&
      !id.startsWith('PUT_')
  );

  /*
    Service categories can have their own roles.
    Example:
    building_service -> builder role
    digging_service -> digging role
    regears_service -> regear role
  */

  if (categoryRoleIds.length) {
    return categoryRoleIds;
  }


  if (isApplicationTicket(categoryId)) {
    return getApplicationTicketRoleIds();
  }


  if (isServiceTicket(categoryId)) {
    return getServiceTicketRoleIds();
  }


  return getTicketRoleIds();
}


// Staff roles for a parsed ticket topic (custom, application, service or normal).
function getStaffRoleIds(meta) {
  if (meta.isCustom && meta.customRoleId) {
    return [meta.customRoleId];
  }

  if (meta.categoryId.startsWith('application_')) {
    return getApplicationTicketRoleIds();
  }

  return getRoleIdsForTicket(meta.categoryId);
}


/* =========================================================
   CREATE NORMAL / SERVICE TICKET
========================================================= */

async function createTicket(
  interaction,
  categoryId,
  answers = [],
  staffRoleOverride = null,
  guildOverride = null
) {
  // guildOverride lets this be called from a DM interaction
  // (e.g. the "Open Ticket" button on a denied application),
  // where interaction.guild is always null.
  const guild = guildOverride || interaction.guild;
  const { user } = interaction;

  if (!guild) {
    return interaction.reply({
      content: 'Tickets can only be created inside the server.',
      flags: MessageFlags.Ephemeral,
    });
  }


  const category = findCategory(categoryId);

  if (!category) {
    return interaction.reply({
      content: 'Unknown ticket category.',
      flags: MessageFlags.Ephemeral,
    });
  }


  const limitMessage = getTicketLimitMessage(guild, user.id);

  if (limitMessage) {
    return interaction.reply({
      content: limitMessage,
      flags: MessageFlags.Ephemeral,
    });
  }


  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });


  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,

      deny: [
        PermissionsBitField.Flags.ViewChannel,
      ],
    },

    {
      id: user.id,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
  ];


  /*
    Give the bot explicit access.

    Use client.user.id instead of guild.members.me.id
    because guild.members.me can occasionally be null/not
    cached when the bot is starting.
  */

  if (interaction.client.user) {
    permissionOverwrites.push({
      id: interaction.client.user.id,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    });
  }


  const configuredStaffRoleIds =
    getRoleIdsForTicket(categoryId);

  // Custom ticket panels can supply one specific role.
  // Normal ticket panels do not pass this value, so their
  // existing configured roles remain completely unchanged.
  const staffRoleIds =
    staffRoleOverride
      ? [staffRoleOverride]
      : configuredStaffRoleIds;


  for (const roleId of staffRoleIds) {
    permissionOverwrites.push({
      id: roleId,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    });
  }


  const safeName =
    user.username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20)
    ||
    'user';


  const channelOptions = {
    name: `${slugify(category.label)}-${safeName}`.slice(0, 100),

    type: ChannelType.GuildText,

    topic:
      `ticket|${user.id}|${categoryId}`,

    permissionOverwrites,
  };


  /*
    SERVICE TICKETS

    building_service
    digging_service
    regears_service

    all go into:
    config.serviceTicketCategoryId
  */

  const requestedParentId =
    (config.ticketCategoryParents &&
      config.ticketCategoryParents[categoryId]) ||
    (isServiceTicket(categoryId)
      ? config.serviceTicketCategoryId
      : config.ticketCategoryId);

  // Do not blindly pass a stale/non-category channel ID as parent.
  // If it is invalid, Discord can reject channel creation completely.
  if (requestedParentId && typeof requestedParentId === 'string' && !requestedParentId.startsWith('PUT_')) {
    const parent = await guild.channels.fetch(requestedParentId).catch(() => null);
    if (parent && parent.type === ChannelType.GuildCategory) {
      channelOptions.parent = requestedParentId;
    } else {
      console.warn(`[TICKET] Configured parent ${requestedParentId} is not a valid category; creating at server root.`);
    }
  }


  try {
    const channel =
      await guild.channels.create(
        channelOptions
      );


    const mentions = staffRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');

    // Pings go in a plain message so role mentions display properly.
    await channel.send({ content: `${user} ${mentions}`.trim() });

    const parts = [
      `## ${category.label.toLowerCase()}\nhi ${user}, thanks for reaching out.\ngive us as much detail as you can and a staff member will be with you shortly.`,
    ];

    for (const answer of answers) {
      parts.push(
        `**${String(answer.question).slice(0, 200)}**\n${String(answer.answer || 'No answer').slice(0, 500)}`
      );
    }

    await channel.send(box(parts, { rows: [buildTicketControlRow()] }));


    await interaction.editReply(box(`✅ Your ticket is ready: ${channel}`));


    return channel;
  }


  catch (err) {
    console.error(
      'Failed to create ticket:',
      err
    );


    await interaction
      .editReply({
        content:
          'Something went wrong creating your ticket. ' +
          'Please contact staff.',
      })
      .catch(() => {});


    return null;
  }
}


/* =========================================================
   OPEN A TICKET CHANNEL WITH AN APPLICANT

   Applications are posted ONLY to the review channel when
   submitted (see submitApplication below). This function is
   only called on-demand, when a staff member presses the
   "Open Ticket" button on that review post — it creates the
   actual per-applicant channel so staff can talk to them
   directly.
========================================================= */

async function createApplicationTicketChannel(
  guild,
  member,
  appId,
  appConfig,
  answers
) {
  try {
    if (!guild) {
      throw new Error(
        'Missing guild when creating application ticket.'
      );
    }


    if (!member) {
      throw new Error(
        'Missing member when creating application ticket.'
      );
    }


    if (!member.user) {
      throw new Error(
        'Missing member user when creating application ticket.'
      );
    }


    if (!appConfig) {
      throw new Error(
        'Missing application configuration.'
      );
    }


    const user =
      member.user;


    /*
      Applications are staff-only tickets.

      The applicant can see the channel so they can
      see that their application exists.

      Application staff roles can access it too.
    */

    const permissionOverwrites = [
      {
        id:
          guild.roles.everyone.id,

        deny: [
          PermissionsBitField.Flags.ViewChannel,
        ],
      },

      {
        id:
          user.id,

        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
    ];


    /*
      Explicit bot permissions.

      This fixes the problem where the channel could
      be created but the bot failed when trying to
      send the application embed.
    */

    const botId =
      guild.members.me?.id ||
      guild.client.user?.id;


    if (!botId) {
      throw new Error(
        'Could not determine bot user ID.'
      );
    }


    permissionOverwrites.push({
      id: botId,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    });


    const applicationRoleIds =
      getApplicationTicketRoleIds();


    /*
      Add configured application staff roles.
    */

    for (
      const roleId
      of applicationRoleIds
    ) {
      permissionOverwrites.push({
        id: roleId,

        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      });
    }


    /*
      Also allow the general support/admin roles.

      This prevents your application channel from
      being inaccessible if applicationTicketRoleIds
      was changed or the application staff role does
      not have the required channel access.
    */

    const extraRoleIds = [
      ...(config.supportRoleIds || []),
      ...(config.adminRoleIds || []),
    ].filter(
      (roleId) =>
        roleId &&
        typeof roleId === 'string' &&
        !roleId.startsWith('PUT_') &&
        !applicationRoleIds.includes(roleId)
    );


    for (
      const roleId
      of extraRoleIds
    ) {
      permissionOverwrites.push({
        id: roleId,

        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
        ],
      });
    }


    const safeName =
      user.username
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 20)
      ||
      'user';


    const channelOptions = {
      name:
        `${slugify(appConfig.label, 'application')}-${safeName}`.slice(0, 100),

      type:
        ChannelType.GuildText,

      topic:
        `ticket|${user.id}|application_${appId}`,

      permissionOverwrites,
    };


    /*
      APPLICATION CATEGORY PRIORITY

      1. reviewChannelId if it is actually a category
      2. applicationTicketCategoryId
      3. ticketCategoryId

      Your config currently has:
      applicationTicketCategoryId:
      1533068861174452255

      so the application will go there.
    */

    // Only use a parent ID if it actually points to a Discord category.
    // A deleted channel, text channel ID, or stale config ID causes
    // guild.channels.create() to fail and was the reason the DM flow could
    // end with "I couldn't open a ticket". If the configured application
    // parent is invalid, fall back to the normal ticket category when valid;
    // otherwise create the application at the server root instead of failing.
    const candidateParentIds = [
      config.applicationTicketCategoryId,
      config.ticketCategoryId,
    ].filter((id, index, arr) =>
      id &&
      typeof id === 'string' &&
      !id.startsWith('PUT_') &&
      arr.indexOf(id) === index
    );

    for (const candidateId of candidateParentIds) {
      const candidate = await guild.channels.fetch(candidateId).catch(() => null);
      if (candidate && candidate.type === ChannelType.GuildCategory) {
        channelOptions.parent = candidateId;
        break;
      }
    }


    console.log(
      '[APPLICATION] Creating application ticket:',
      {
        userId: user.id,
        appId,
        parentId:
          channelOptions.parent ||
          'none',
        roles:
          applicationRoleIds,
      }
    );


    const channel =
      await guild.channels.create(
        channelOptions
      );


    /*
      Keep this simple — a normal-looking ticket, not a
      second copy of the full application review UI (that
      already lives on the review post). Just enough context
      for staff to know who they're talking to, plus the
      normal Claim / Close / Close with Reason controls.
    */

    const mentions = applicationRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');

    await channel.send({ content: `${user} ${mentions}`.trim() });

    await channel.send(
      box(
        [
          `## application ticket\nhi ${user}, a staff member opened this ticket to talk about your **${appConfig.label}** application.`,
        ],
        { rows: [buildTicketControlRow()] }
      )
    );


    console.log(
      `[APPLICATION] Successfully created application ticket ${channel.id}`
    );


    // Only the channel ID is stored — no message ID, since this
    // channel no longer carries a decision-row copy that would
    // need to be kept in sync with the review post.
    updateApplicationRefs(
      user.id,
      appId,
      {
        ticketChannelId: channel.id,
        guildId: guild.id,
      }
    );


    return channel;
  }


  catch (err) {
    console.error(
      '[APPLICATION] Failed to create application ticket channel:',
      err
    );

    return null;
  }
}


/* =========================================================
   SUBMIT APPLICATION — post to the review channel only

   No per-applicant channel is created here. This just posts
   the application embed (with join/account stats baked in via
   buildApplicationEmbed) to config.applicationLogChannelId with
   the 5-button decision row. A ticket channel with the applicant
   is only created later, on demand, via createApplicationTicketChannel
   above, when staff press "Open Ticket".
========================================================= */

async function submitApplication(
  guild,
  member,
  appId,
  appConfig,
  answers
) {
  try {
    if (!guild) {
      throw new Error('Missing guild when submitting application.');
    }

    if (!member || !member.user) {
      throw new Error('Missing member when submitting application.');
    }

    if (!appConfig) {
      throw new Error('Missing application configuration.');
    }

    if (
      !config.applicationLogChannelId ||
      String(config.applicationLogChannelId).startsWith('PUT_')
    ) {
      throw new Error('applicationLogChannelId is not configured.');
    }

    const reviewChannel = await guild.channels
      .fetch(config.applicationLogChannelId)
      .catch(() => null);

    if (!reviewChannel || !reviewChannel.isTextBased?.()) {
      throw new Error('Could not find the applications review channel.');
    }

    const embed = buildApplicationEmbed(member, appConfig, answers);
    const decisionRow = buildDecisionRow(member.user.id, appId);

    const applicationRoleIds = getApplicationTicketRoleIds();
    const mentions = applicationRoleIds
      .map((roleId) => `<@&${roleId}>`)
      .join(' ');

    const message = await reviewChannel.send({
      content: mentions || undefined,
      embeds: [embed],
      components: [decisionRow],
    });

    updateApplicationRefs(member.user.id, appId, {
      guildId: guild.id,
      logChannelId: reviewChannel.id,
      logMessageId: message.id,
      // Kept so "Open Ticket" can build the ticket channel
      // later without the applicant having to re-answer.
      answers,
    });

    console.log(
      `[APPLICATION] Posted ${appId} application from ${member.user.id} to the review channel.`
    );

    return message;
  } catch (err) {
    console.error('[APPLICATION] Failed to submit application:', err);
    return null;
  }
}


/* =========================================================
   CLAIM TICKET
========================================================= */

async function claimTicket(
  interaction
) {
  const meta = parseTopic(interaction.channel.topic);

  if (!meta) {
    return interaction.reply({
      content: 'This does not look like a ticket channel.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const member = interaction.member;

  const roleIds = getStaffRoleIds(meta);

  const isTicketStaff = roleIds.some((roleId) =>
    member.roles.cache.has(roleId)
  );

  if (
    !isTicketStaff &&
    !member.permissions.has(PermissionsBitField.Flags.ManageChannels)
  ) {
    return interaction.reply({
      content: 'Only ticket staff can claim tickets.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Prevent claiming an already claimed ticket.
  const alreadyClaimed = interaction.message.components
    .flatMap((row) => row.components)
    .some((component) =>
      component.customId?.startsWith('ticket_unclaim')
    );

  if (alreadyClaimed) {
    return interaction.reply({
      content: 'This ticket has already been claimed.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  /*
   * Hide the ticket from the other staff roles.
   * The ticket owner and the staff member who claimed it
   * keep access. Discord administrators can still see it
   * because Administrator bypasses channel permission denies.
   */
  for (const roleId of roleIds) {
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      console.warn(`[TICKET] Could not fetch staff role ${roleId} while claiming.`);
      continue;
    }

    await interaction.channel.permissionOverwrites.edit(role, {
      ViewChannel: false,
      SendMessages: false,
      ReadMessageHistory: false,
    }).catch((err) => {
      console.error(`[TICKET] Failed to hide ticket from role ${roleId}:`, err);
    });
  }

  // Explicitly restore access for the ticket owner and claimer.
  await interaction.channel.permissionOverwrites.edit(meta.userId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
  }).catch(() => {});

  await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
    ManageMessages: true,
  }).catch(() => {});

  await interaction.editReply(
    box(`claimed by ${interaction.user}. other staff can't see this ticket until it's unclaimed.`)
  );

  const claimedEdit = swapRow(interaction.message, buildTicketControlRow(true, interaction.user.id));
  if (claimedEdit) await interaction.message.edit(claimedEdit).catch(() => {});

  incrementStat(
    interaction.guild,
    interaction.user.id,
    'ticketsHandled'
  ).catch((err) => {
    console.error('Failed to update staff tracker for ticket claim:', err);
  });
}


/* =========================================================
   UNCLAIM TICKET
========================================================= */

async function unclaimTicket(
  interaction
) {
  const meta = parseTopic(interaction.channel.topic);

  if (!meta) {
    return interaction.reply({
      content: 'This does not look like a ticket channel.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // customId looks like: ticket_unclaim:CLAIMER_ID
  const claimerId = interaction.customId.split(':')[1];

  const canManage = interaction.member.permissions.has(
    PermissionsBitField.Flags.ManageChannels
  );

  if (interaction.user.id !== claimerId && !canManage) {
    return interaction.reply({
      content: 'Only the staff member who claimed this ticket can unclaim it.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const roleIds = getStaffRoleIds(meta);

  await interaction.deferReply();

  // Give the staff roles their access back.
  for (const roleId of roleIds) {
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      console.warn(`[TICKET] Could not fetch staff role ${roleId} while unclaiming.`);
      continue;
    }

    await interaction.channel.permissionOverwrites.edit(role, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      ManageMessages: true,
      AttachFiles: true,
      EmbedLinks: true,
    }).catch((err) => {
      console.error(`[TICKET] Failed to restore ticket access for role ${roleId}:`, err);
    });
  }

  // Remove the claimer's personal overwrite (their role covers them again).
  if (claimerId && claimerId !== meta.userId) {
    const claimerMember = await interaction.guild.members
      .fetch(claimerId)
      .catch(() => null);

    const hasStaffRole =
      claimerMember &&
      roleIds.some((roleId) => claimerMember.roles.cache.has(roleId));

    if (hasStaffRole) {
      await interaction.channel.permissionOverwrites
        .delete(claimerId)
        .catch(() => {});
    }
  }

  await interaction.editReply(box(`${interaction.user} unclaimed this ticket. staff can see it again.`));

  const unclaimedEdit = swapRow(interaction.message, buildTicketControlRow(false));
  if (unclaimedEdit) await interaction.message.edit(unclaimedEdit).catch(() => {});
}


/* =========================================================
   CLOSE TICKET
========================================================= */

async function closeTicket(interaction, reason) {
  const meta = parseTopic(interaction.channel.topic);

  if (!meta) {
    return interaction.reply({
      content: 'This does not look like a ticket channel.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const member = interaction.member;

  const roleIds = getStaffRoleIds(meta);

  const isTicketStaff = roleIds.some((roleId) =>
    member.roles.cache.has(roleId)
  );

  const isOwner = member.id === meta.userId;

  if (
    !isTicketStaff &&
    !isOwner &&
    !member.permissions.has(PermissionsBitField.Flags.ManageChannels)
  ) {
    return interaction.reply({
      content: 'You do not have permission to close this ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const closingBox = box(
    `closed by ${interaction.user}.` +
      (reason ? `\n**reason:** ${reason}` : '') +
      '\n\nsaving transcript, this channel will be deleted shortly.'
  );

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(closingBox);
  } else {
    await interaction.reply(closingBox);
  }

  const closerId = interaction.user.id;

  incrementStat(
    interaction.guild,
    closerId,
    'ticketsClosed'
  ).catch((err) => {
    console.error('Failed to update staff tracker for ticket close:', err);
  });

  if (meta.categoryId === 'partner') {
    incrementStat(interaction.guild, closerId, 'partnersCompleted').catch(() => {});
  } else if (meta.categoryId === 'giveaway_sponsor') {
    incrementStat(interaction.guild, closerId, 'giveawaysSponsored').catch(() => {});
  }

  try {
    const attachment = await buildTranscript(interaction.channel);
    const logChannelId = config.transcriptLogChannelId;

    if (logChannelId && !logChannelId.startsWith('PUT_')) {
      const logChannel = await interaction.guild.channels
        .fetch(logChannelId)
        .catch(() => null);

      if (logChannel && logChannel.isTextBased()) {
        const lines = [
          '## ticket closed',
          `**channel:** #${interaction.channel.name}\n` +
            `**opened by:** <@${meta.userId}>\n` +
            `**closed by:** <@${closerId}>\n` +
            `**category:** ${meta.categoryId}` +
            (reason ? `\n**reason:** ${reason.slice(0, 500)}` : ''),
          `-# <t:${Math.floor(Date.now() / 1000)}:f>`,
        ];

        await logChannel.send({
          ...box(lines, { file: attachment.name }),
          files: [attachment],
        });
      }
    }

    const opener = await interaction.guild.members
      .fetch(meta.userId)
      .catch(() => null);

    if (opener) {
      const dmAttachment = await buildTranscript(interaction.channel);
      await opener.send({
        ...box('Here is a transcript of your closed ticket.', { file: dmAttachment.name }),
        files: [dmAttachment],
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Failed to build/send transcript:', err);
  }

  setTimeout(() => {
    interaction.channel.delete().catch(() => {});
  }, (config.closeCountdownSeconds || 5) * 1000);
}


/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  createTicket,
  createApplicationTicketChannel,
  submitApplication,
  claimTicket,
  unclaimTicket,
  closeTicket,
  parseTopic,
  getStaffRoleIds,
  getTicketLimitMessage,
  buildTicketControlRow,
  findCategory,
  isServiceTicket,
};
