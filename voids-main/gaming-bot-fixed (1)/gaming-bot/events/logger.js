const {
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

  logGuildUpdate,
} = require('../utils/logger');


/* =========================================================
   LOGGER SERVER
========================================================= */

const LOGGER_GUILD_ID =
  '1542361762186268765';


/* =========================================================
   CHECK IF EVENT IS FROM LOGGER SERVER
========================================================= */

function isLoggerServer(guild) {
  return guild?.id === LOGGER_GUILD_ID;
}


/* =========================================================
   CROSS-SERVER LOGGER
========================================================= */

module.exports = {

  name: 'logger',

  register(client) {

    console.log(
      '[LOGGER] Registering cross-server logging listeners...'
    );


    /* =====================================================
       MESSAGE EDITED
    ===================================================== */

    client.on(
      'messageUpdate',
      async (
        oldMessage,
        newMessage
      ) => {

        try {

          if (
            isLoggerServer(
              newMessage.guild
            )
          ) {
            return;
          }

          await logMessageEdit(
            oldMessage,
            newMessage
          );

        } catch (err) {

          console.error(
            '[LOGGER] messageUpdate failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       MESSAGE DELETED
    ===================================================== */

    client.on(
      'messageDelete',
      async (message) => {

        try {

          if (
            isLoggerServer(
              message.guild
            )
          ) {
            return;
          }

          await logMessageDelete(
            message
          );

        } catch (err) {

          console.error(
            '[LOGGER] messageDelete failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       MEMBER JOIN
    ===================================================== */

    client.on(
      'guildMemberAdd',
      async (member) => {

        try {

          if (
            isLoggerServer(
              member.guild
            )
          ) {
            return;
          }

          await logMemberJoin(
            member
          );

        } catch (err) {

          console.error(
            '[LOGGER] guildMemberAdd failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       MEMBER LEAVE / KICK
    ===================================================== */

    client.on(
      'guildMemberRemove',
      async (member) => {

        try {

          if (
            isLoggerServer(
              member.guild
            )
          ) {
            return;
          }

          await logMemberLeave(
            member
          );

        } catch (err) {

          console.error(
            '[LOGGER] guildMemberRemove failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       MEMBER UPDATE
    ===================================================== */

    client.on(
      'guildMemberUpdate',
      async (
        oldMember,
        newMember
      ) => {

        try {

          if (
            isLoggerServer(
              newMember.guild
            )
          ) {
            return;
          }

          await logNicknameChange(
            oldMember,
            newMember
          );

        } catch (err) {

          console.error(
            '[LOGGER] nickname logging failed:',
            err
          );
        }


        try {

          if (
            isLoggerServer(
              newMember.guild
            )
          ) {
            return;
          }

          await logMemberRolesUpdate(
            oldMember,
            newMember
          );

        } catch (err) {

          console.error(
            '[LOGGER] role logging failed:',
            err
          );
        }


        try {

          if (
            isLoggerServer(
              newMember.guild
            )
          ) {
            return;
          }

          await logTimeout(
            oldMember,
            newMember
          );

        } catch (err) {

          console.error(
            '[LOGGER] timeout logging failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       BAN
    ===================================================== */

    client.on(
      'guildBanAdd',
      async (ban) => {

        try {

          if (
            isLoggerServer(
              ban.guild
            )
          ) {
            return;
          }

          await logBan(
            ban
          );

        } catch (err) {

          console.error(
            '[LOGGER] ban logging failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       UNBAN
    ===================================================== */

    client.on(
      'guildBanRemove',
      async (ban) => {

        try {

          if (
            isLoggerServer(
              ban.guild
            )
          ) {
            return;
          }

          await logUnban(
            ban
          );

        } catch (err) {

          console.error(
            '[LOGGER] unban logging failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       ROLE CREATED
    ===================================================== */

    client.on(
      'roleCreate',
      async (role) => {

        try {

          if (
            isLoggerServer(
              role.guild
            )
          ) {
            return;
          }

          await logRoleCreate(
            role
          );

        } catch (err) {

          console.error(
            '[LOGGER] roleCreate logging failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       ROLE DELETED
    ===================================================== */

    client.on(
      'roleDelete',
      async (role) => {

        try {

          if (
            isLoggerServer(
              role.guild
            )
          ) {
            return;
          }

          await logRoleDelete(
            role
          );

        } catch (err) {

          console.error(
            '[LOGGER] roleDelete logging failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       ROLE UPDATED
    ===================================================== */

    client.on(
      'roleUpdate',
      async (
        oldRole,
        newRole
      ) => {

        try {

          if (
            isLoggerServer(
              newRole.guild
            )
          ) {
            return;
          }

          await logRoleUpdate(
            oldRole,
            newRole
          );

        } catch (err) {

          console.error(
            '[LOGGER] roleUpdate logging failed:',
            err
          );
        }
      }
    );


    /* =====================================================
       SERVER UPDATED
    ===================================================== */

    client.on(
      'guildUpdate',
      async (
        oldGuild,
        newGuild
      ) => {

        try {

          if (
            newGuild.id ===
            LOGGER_GUILD_ID
          ) {
            return;
          }

          await logGuildUpdate(
            oldGuild,
            newGuild
          );

        } catch (err) {

          console.error(
            '[LOGGER] guildUpdate logging failed:',
            err
          );
        }
      }
    );


    console.log(
      '[LOGGER] Cross-server logger is active.'
    );

    console.log(
      `[LOGGER] Ignoring logger server: ${LOGGER_GUILD_ID}`
    );
  },
};
