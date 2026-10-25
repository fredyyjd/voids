const {
  EmbedBuilder,
} = require('discord.js');


/* =========================================================
   LOGGER SERVER
========================================================= */

const LOGGER_GUILD_ID =
  '1542361762186268765';


/* =========================================================
   LOG CHANNELS

   CHANGE THESE IDs TO THE CHANNELS IN YOUR LOGGER SERVER.

   If you already have these in config.json, you can replace
   this section with your existing config values.
========================================================= */

const LOG_CHANNELS = {

  server:
    '1542362270120681646',

  tickets:
    '1542362304669032549',

  member:
    '1542364771138015334',

  moderation:
    '1542364806818832475',

  message:
    '1542364917829738496',

};

/* =========================================================
   HELPERS
========================================================= */

function clip(text, max = 1000) {

  if (!text) {
    return 'None';
  }

  text = String(text);

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 3)}...`;
}


function userText(user) {

  if (!user) {
    return 'Unknown User';
  }

  return `${user} (\`${user.id}\`)`;
}


function guildText(guild) {

  if (!guild) {
    return 'Unknown Server';
  }

  return `${guild.name} (\`${guild.id}\`)`;
}


function isLoggerServer(guild) {

  return guild?.id === LOGGER_GUILD_ID;

}


/* =========================================================
   GET LOGGER CHANNEL
========================================================= */

async function getLogChannel(client, type) {

  if (!client) {
    return null;
  }


  const channelId =
    LOG_CHANNELS[type];


  if (
    !channelId ||
    channelId.startsWith('PUT_')
  ) {

    console.error(
      `[LOGGER] No channel ID configured for "${type}" logs.`
    );

    return null;
  }


  try {

    const channel =
      await client.channels.fetch(
        channelId
      );


    if (!channel) {
      return null;
    }


    if (
      !channel.isTextBased()
    ) {
      console.error(
        `[LOGGER] Channel ${channelId} is not a text channel.`
      );

      return null;
    }


    return channel;

  } catch (err) {

    console.error(
      `[LOGGER] Failed to fetch log channel ${channelId}:`,
      err
    );

    return null;
  }
}


/* =========================================================
   SEND LOG
========================================================= */

async function sendLog(
  client,
  type,
  embed
) {

  if (!client) {
    return;
  }


  const channel =
    await getLogChannel(
      client,
      type
    );


  if (!channel) {
    return;
  }


  try {

    await channel.send({
      embeds: [embed],
    });

  } catch (err) {

    console.error(
      `[LOGGER] Failed to send ${type} log:`,
      err
    );
  }
}


/* =========================================================
   MESSAGE CREATE
========================================================= */

async function logMessageCreate(message) {

  if (!message) {
    return;
  }


  if (message.author?.bot) {
    return;
  }


  if (
    isLoggerServer(
      message.guild
    )
  ) {
    return;
  }


  if (!message.guild) {
    return;
  }


  const content =
    message.content?.trim() ||
    '*No text content*';


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('💬 Message Sent')
      .addFields(
        {
          name: 'User',
          value: userText(
            message.author
          ),
          inline: true,
        },
        {
          name: 'Server',
          value: guildText(
            message.guild
          ),
          inline: true,
        },
        {
          name: 'Channel',
          value:
            `${message.channel} (\`${message.channel.id}\`)`,
          inline: true,
        },
        {
          name: 'Message',
          value: clip(
            content,
            3500
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    message.client,
    'message',
    embed
  );
}


/* =========================================================
   MESSAGE EDIT
========================================================= */

async function logMessageEdit(
  oldMessage,
  newMessage
) {

  const guild =
    newMessage?.guild ||
    oldMessage?.guild;


  if (
    !guild ||
    isLoggerServer(guild)
  ) {
    return;
  }


  if (
    newMessage?.author?.bot ||
    oldMessage?.author?.bot
  ) {
    return;
  }


  const before =
    oldMessage?.content ||
    '*Unknown / unavailable*';


  const after =
    newMessage?.content ||
    '*No text content*';


  if (
    before === after
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('✏️ Message Edited')
      .addFields(
        {
          name: 'User',
          value: userText(
            newMessage?.author ||
            oldMessage?.author
          ),
          inline: true,
        },
        {
          name: 'Server',
          value: guildText(
            guild
          ),
          inline: true,
        },
        {
          name: 'Channel',
          value:
            newMessage?.channel
              ? `${newMessage.channel}`
              : 'Unknown',
          inline: true,
        },
        {
          name: 'Before',
          value: clip(
            before,
            1500
          ),
        },
        {
          name: 'After',
          value: clip(
            after,
            1500
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    newMessage?.client ||
    oldMessage?.client,
    'message',
    embed
  );
}


/* =========================================================
   MESSAGE DELETE
========================================================= */

async function logMessageDelete(message) {

  if (!message) {
    return;
  }


  if (
    isLoggerServer(
      message.guild
    )
  ) {
    return;
  }


  if (message.author?.bot) {
    return;
  }


  const content =
    message.content ||
    '*Message content unavailable*';


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('🗑️ Message Deleted')
      .addFields(
        {
          name: 'User',
          value: userText(
            message.author
          ),
          inline: true,
        },
        {
          name: 'Server',
          value: guildText(
            message.guild
          ),
          inline: true,
        },
        {
          name: 'Channel',
          value:
            message.channel
              ? `${message.channel}`
              : 'Unknown',
          inline: true,
        },
        {
          name: 'Message',
          value: clip(
            content,
            3500
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    message.client,
    'message',
    embed
  );
}


/* =========================================================
   MEMBER JOIN
========================================================= */

async function logMemberJoin(member) {

  if (
    !member ||
    isLoggerServer(member.guild)
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('📥 Member Joined')
      .addFields(
        {
          name: 'User',
          value: userText(
            member.user
          ),
          inline: true,
        },
        {
          name: 'Server',
          value: guildText(
            member.guild
          ),
          inline: true,
        }
      )
      .setTimestamp();


  await sendLog(
    member.client,
    'member',
    embed
  );
}


/* =========================================================
   MEMBER LEAVE
========================================================= */

async function logMemberLeave(member) {

  if (
    !member ||
    isLoggerServer(member.guild)
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('📤 Member Left')
      .addFields(
        {
          name: 'User',
          value: userText(
            member.user
          ),
          inline: true,
        },
        {
          name: 'Server',
          value: guildText(
            member.guild
          ),
          inline: true,
        }
      )
      .setTimestamp();


  await sendLog(
    member.client,
    'member',
    embed
  );
}


/* =========================================================
   NICKNAME CHANGE
========================================================= */

async function logNicknameChange(
  oldMember,
  newMember
) {

  if (
    !newMember ||
    isLoggerServer(newMember.guild)
  ) {
    return;
  }


  const oldName =
    oldMember.nickname ||
    oldMember.user?.username ||
    'None';


  const newName =
    newMember.nickname ||
    newMember.user?.username ||
    'None';


  if (
    oldName === newName
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('📝 Nickname Changed')
      .addFields(
        {
          name: 'User',
          value: userText(
            newMember.user
          ),
          inline: true,
        },
        {
          name: 'Before',
          value: clip(
            oldName
          ),
          inline: true,
        },
        {
          name: 'After',
          value: clip(
            newName
          ),
          inline: true,
        }
      )
      .setTimestamp();


  await sendLog(
    newMember.client,
    'member',
    embed
  );
}


/* =========================================================
   MEMBER ROLES
========================================================= */

async function logMemberRolesUpdate(
  oldMember,
  newMember
) {

  if (
    !newMember ||
    isLoggerServer(newMember.guild)
  ) {
    return;
  }


  const oldRoles =
    new Set(
      oldMember.roles.cache.keys()
    );


  const newRoles =
    new Set(
      newMember.roles.cache.keys()
    );


  const added =
    [...newRoles]
      .filter(
        id => !oldRoles.has(id)
      );


  const removed =
    [...oldRoles]
      .filter(
        id => !newRoles.has(id)
      );


  if (
    !added.length &&
    !removed.length
  ) {
    return;
  }


  const changes = [];


  for (const id of added) {

    const role =
      newMember.guild.roles.cache.get(
        id
      );

    if (role) {
      changes.push(
        `➕ Added ${role}`
      );
    }
  }


  for (const id of removed) {

    const role =
      newMember.guild.roles.cache.get(
        id
      );

    changes.push(
      `➖ Removed <@&${id}>`
    );
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('🎭 Member Roles Changed')
      .addFields(
        {
          name: 'User',
          value: userText(
            newMember.user
          ),
        },
        {
          name: 'Server',
          value: guildText(
            newMember.guild
          ),
        },
        {
          name: 'Changes',
          value: clip(
            changes.join('\n')
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    newMember.client,
    'member',
    embed
  );
}


/* =========================================================
   TIMEOUT
========================================================= */

async function logTimeout(
  oldMember,
  newMember
) {

  if (
    !newMember ||
    isLoggerServer(newMember.guild)
  ) {
    return;
  }


  const oldTimeout =
    oldMember.communicationDisabledUntilTimestamp;


  const newTimeout =
    newMember.communicationDisabledUntilTimestamp;


  if (
    oldTimeout === newTimeout
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle(
        newTimeout
          ? '⏱️ Member Timed Out'
          : '✅ Timeout Removed'
      )
      .addFields(
        {
          name: 'User',
          value: userText(
            newMember.user
          ),
          inline: true,
        },
        {
          name: 'Server',
          value: guildText(
            newMember.guild
          ),
          inline: true,
        }
      )
      .setTimestamp();


  if (newTimeout) {

    embed.addFields({
      name: 'Until',
      value:
        `<t:${Math.floor(newTimeout / 1000)}:F>`,
    });
  }


  await sendLog(
    newMember.client,
    'moderation',
    embed
  );
}


/* =========================================================
   BAN
========================================================= */

async function logBan(ban) {

  if (
    !ban ||
    isLoggerServer(ban.guild)
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('🔨 Member Banned')
      .addFields(
        {
          name: 'User',
          value: userText(
            ban.user
          ),
          inline: true,
        },
        {
          name: 'Server',
          value: guildText(
            ban.guild
          ),
          inline: true,
        }
      )
      .setTimestamp();


  await sendLog(
    ban.client,
    'moderation',
    embed
  );
}


/* =========================================================
   UNBAN
========================================================= */

async function logUnban(ban) {

  if (
    !ban ||
    isLoggerServer(ban.guild)
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('🔓 Member Unbanned')
      .addFields(
        {
          name: 'User',
          value: userText(
            ban.user
          ),
          inline: true,
        },
        {
          name: 'Server',
          value: guildText(
            ban.guild
          ),
          inline: true,
        }
      )
      .setTimestamp();


  await sendLog(
    ban.client,
    'moderation',
    embed
  );
}


/* =========================================================
   ROLE CREATE
========================================================= */

async function logRoleCreate(role) {

  if (
    !role ||
    isLoggerServer(role.guild)
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('➕ Role Created')
      .addFields(
        {
          name: 'Role',
          value:
            `${role} (\`${role.id}\`)`,
        },
        {
          name: 'Server',
          value: guildText(
            role.guild
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    role.client,
    'role',
    embed
  );
}


/* =========================================================
   ROLE DELETE
========================================================= */

async function logRoleDelete(role) {

  if (
    !role ||
    isLoggerServer(role.guild)
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('🗑️ Role Deleted')
      .addFields(
        {
          name: 'Role',
          value:
            `@${role.name} (\`${role.id}\`)`,
        },
        {
          name: 'Server',
          value: guildText(
            role.guild
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    role.client,
    'role',
    embed
  );
}


/* =========================================================
   ROLE UPDATE
========================================================= */

async function logRoleUpdate(
  oldRole,
  newRole
) {

  if (
    !newRole ||
    isLoggerServer(newRole.guild)
  ) {
    return;
  }


  const changes = [];


  if (
    oldRole.name !==
    newRole.name
  ) {

    changes.push(
      `Name: \`${oldRole.name}\` → \`${newRole.name}\``
    );
  }


  if (
    oldRole.hexColor !==
    newRole.hexColor
  ) {

    changes.push(
      `Color: \`${oldRole.hexColor}\` → \`${newRole.hexColor}\``
    );
  }


  if (
    oldRole.permissions.bitfield !==
    newRole.permissions.bitfield
  ) {

    changes.push(
      'Permissions changed'
    );
  }


  if (
    !changes.length
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('✏️ Role Updated')
      .addFields(
        {
          name: 'Role',
          value:
            `${newRole} (\`${newRole.id}\`)`,
        },
        {
          name: 'Server',
          value: guildText(
            newRole.guild
          ),
        },
        {
          name: 'Changes',
          value: clip(
            changes.join('\n')
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    newRole.client,
    'role',
    embed
  );
}


/* =========================================================
   CHANNEL CREATE
========================================================= */

async function logChannelCreate(channel) {

  if (
    !channel ||
    !channel.guild ||
    isLoggerServer(channel.guild)
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('➕ Channel Created')
      .addFields(
        {
          name: 'Channel',
          value:
            `${channel} (\`${channel.id}\`)`,
        },
        {
          name: 'Type',
          value:
            String(channel.type),
          inline: true,
        },
        {
          name: 'Server',
          value: guildText(
            channel.guild
          ),
          inline: true,
        }
      )
      .setTimestamp();


  await sendLog(
    channel.client,
    'channel',
    embed
  );
}


/* =========================================================
   CHANNEL DELETE
========================================================= */

async function logChannelDelete(channel) {

  if (
    !channel ||
    !channel.guild ||
    isLoggerServer(channel.guild)
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('🗑️ Channel Deleted')
      .addFields(
        {
          name: 'Channel',
          value:
            `#${channel.name || 'Unknown'} (\`${channel.id}\`)`,
        },
        {
          name: 'Server',
          value: guildText(
            channel.guild
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    channel.client,
    'channel',
    embed
  );
}


/* =========================================================
   CHANNEL UPDATE
========================================================= */

async function logChannelUpdate(
  oldChannel,
  newChannel
) {

  if (
    !newChannel ||
    !newChannel.guild ||
    isLoggerServer(newChannel.guild)
  ) {
    return;
  }


  const changes = [];


  if (
    oldChannel.name !==
    newChannel.name
  ) {

    changes.push(
      `Name: \`${oldChannel.name}\` → \`${newChannel.name}\``
    );
  }


  if (
    oldChannel.topic !==
    newChannel.topic
  ) {

    changes.push(
      'Topic changed'
    );
  }


  if (
    oldChannel.parentId !==
    newChannel.parentId
  ) {

    changes.push(
      'Category changed'
    );
  }


  if (
    !changes.length
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('✏️ Channel Updated')
      .addFields(
        {
          name: 'Channel',
          value:
            `${newChannel} (\`${newChannel.id}\`)`,
        },
        {
          name: 'Server',
          value: guildText(
            newChannel.guild
          ),
        },
        {
          name: 'Changes',
          value: clip(
            changes.join('\n')
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    newChannel.client,
    'channel',
    embed
  );
}


/* =========================================================
   SERVER UPDATE
========================================================= */

async function logGuildUpdate(
  oldGuild,
  newGuild
) {

  if (
    !newGuild ||
    newGuild.id ===
      LOGGER_GUILD_ID
  ) {
    return;
  }


  const changes = [];


  if (
    oldGuild.name !==
    newGuild.name
  ) {

    changes.push(
      `Name: \`${oldGuild.name}\` → \`${newGuild.name}\``
    );
  }


  if (
    oldGuild.description !==
    newGuild.description
  ) {

    changes.push(
      'Description changed'
    );
  }


  if (
    oldGuild.icon !==
    newGuild.icon
  ) {

    changes.push(
      'Server icon changed'
    );
  }


  if (
    !changes.length
  ) {
    return;
  }


  const embed =
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle('⚙️ Server Updated')
      .addFields(
        {
          name: 'Server',
          value: guildText(
            newGuild
          ),
        },
        {
          name: 'Changes',
          value: clip(
            changes.join('\n')
          ),
        }
      )
      .setTimestamp();


  await sendLog(
    newGuild.client,
    'server',
    embed
  );
}


/* =========================================================
   EXPORTS
========================================================= */

module.exports = {

  logMessageCreate,
  logMessageEdit,
  logMessageDelete,

  logMemberJoin,
  logMemberLeave,
  logNicknameChange,
  logMemberRolesUpdate,
  logTimeout,

  logBan,
  logUnban,

  logRoleCreate,
  logRoleDelete,
  logRoleUpdate,

  logChannelCreate,
  logChannelDelete,
  logChannelUpdate,

  logGuildUpdate,

};
