const fs = require('fs');
const path = require('path');

const {
  ActionRowBuilder,
  ButtonBuilder,
} = require('discord.js');

const DATA_FILE = path.join(
  __dirname,
  '..',
  'data',
  'honeypots.json'
);

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {};
    }

    return JSON.parse(
      fs.readFileSync(DATA_FILE, 'utf8')
    );
  } catch (error) {
    console.error(
      '[HONEYPOT] Failed to load data:',
      error
    );

    return {};
  }
}

function saveData(data) {
  try {
    const directory = path.dirname(DATA_FILE);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, {
        recursive: true,
      });
    }

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error(
      '[HONEYPOT] Failed to save data:',
      error
    );
  }
}

/*
  Delete all messages from a user
  in the honeypot channel.

  Discord only allows bulk deleting messages
  newer than 14 days, so messages are deleted
  individually here.
*/
async function deleteUserMessages(
  channel,
  userId
) {
  let deleted = 0;
  let before = undefined;

  try {
    while (true) {
      const options = {
        limit: 100,
      };

      if (before) {
        options.before = before;
      }

      const messages =
        await channel.messages.fetch(options);

      if (!messages.size) {
        break;
      }

      const userMessages =
        messages.filter(
          message =>
            message.author?.id === userId
        );

      for (
        const message of userMessages.values()
      ) {
        try {
          await message.delete();
          deleted++;
        } catch (error) {
          // Ignore messages that cannot be deleted.
        }
      }

      const oldestMessage =
        messages.last();

      if (!oldestMessage) {
        break;
      }

      before = oldestMessage.id;

      if (messages.size < 100) {
        break;
      }
    }
  } catch (error) {
    console.error(
      '[HONEYPOT] Failed deleting user messages:',
      error
    );
  }

  return deleted;
}

/*
  Update the disabled kick counter button.
*/
async function updateHoneypotButton(
  client,
  honeypot
) {
  if (!honeypot?.messageId) {
    return;
  }

  try {
    const channel =
      await client.channels.fetch(
        honeypot.channelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return;
    }

    const honeypotMessage =
      await channel.messages.fetch(
        honeypot.messageId
      );

    const oldButton =
      honeypotMessage.components?.[0]
        ?.components?.[0];

    if (!oldButton) {
      return;
    }

    const kicks =
      Number(honeypot.kicks || 0);

    /*
      Button will show:

      🍯 Kicks: 0
      🍯 Kicks: 1
      🍯 Kicks: 2

      It remains disabled and cannot be clicked.
    */
    const updatedButton =
      ButtonBuilder.from(oldButton)
        .setLabel(
          `${honeypot.buttonName || 'Kicks'}: ${kicks}`
        )
        .setEmoji(
          honeypot.buttonEmoji || '🍯'
        )
        .setDisabled(true);

    const row =
      new ActionRowBuilder()
        .addComponents(
          updatedButton
        );

    await honeypotMessage.edit({
      components: [row],
    });
  } catch (error) {
    console.error(
      '[HONEYPOT] Failed to update kick count:',
      error
    );
  }
}

module.exports = {
  name: 'honeypot',

  register(client) {
    client.on(
      'messageCreate',
      async message => {
        try {
          if (!message.guild) {
            return;
          }

          /*
            Ignore bots so the honeypot does not
            accidentally react to bot messages.
          */
          if (message.author?.bot) {
            return;
          }

          const data = loadData();

          const honeypot =
            data[message.channel.id];

          /*
            This is not a honeypot channel.
          */
          if (!honeypot) {
            return;
          }

          const member =
            message.member;

          if (!member) {
            return;
          }

          /*
            Delete the message that triggered
            the honeypot immediately.
          */
          try {
            await message.delete();
          } catch (error) {
            console.warn(
              '[HONEYPOT] Could not delete triggering message.'
            );
          }

          /*
            Delete ALL messages from the user
            in this honeypot channel.
          */
          const deletedMessages =
            await deleteUserMessages(
              message.channel,
              message.author.id
            );

          /*
            Check whether the bot can kick them.
          */
          if (!member.kickable) {
            console.warn(
              `[HONEYPOT] Could not kick ${message.author.tag} (${message.author.id}). Check bot permissions and role position.`
            );

            return;
          }

          /*
            Kick the member.
          */
          await member.kick(
            'Honeypot triggered'
          );

          /*
            Only increase the counter after
            the kick successfully happens.
          */
          honeypot.kicks =
            Number(honeypot.kicks || 0) + 1;

          saveData(data);

          /*
            Update the disabled counter button.
          */
          await updateHoneypotButton(
            client,
            honeypot
          );

          console.log(
            `[HONEYPOT] Kicked ${message.author.tag} (${message.author.id}) from ${message.guild.name}. Deleted ${deletedMessages} message(s). Total kicks: ${honeypot.kicks}`
          );
        } catch (error) {
          console.error(
            '[HONEYPOT] Message handling error:',
            error
          );
        }
      }
    );
  },
};
