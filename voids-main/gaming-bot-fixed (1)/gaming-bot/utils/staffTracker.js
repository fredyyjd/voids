const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

const DATA_DIR = process.env.DATA_DIR || '/app/data';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DATA_FILE = path.join(DATA_DIR, 'staffStats.json');

function loadStats() {
  if (!fs.existsSync(DATA_FILE)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (error) {
    console.error('[STAFF TRACKER] Failed to load stats:', error);
    return {};
  }
}

function saveStats(data) {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error('[STAFF TRACKER] Failed to save stats:', error);
  }
}

function blankEntry() {
  return {
    ticketsRenamed: 0,
    ticketsHandled: 0,
    ticketsClosed: 0,
    partnersCompleted: 0,
    giveawaysSponsored: 0,
    moderationActions: 0,
    messageId: null,
  };
}

function buildStaffEmbed(userId, stats) {
  const lines = [
    '————————————————',
    `<@${userId}>`,
    '-----------------------------',
    `${stats.ticketsRenamed || 0}  - Tickets Renamed`,
    `${stats.ticketsHandled || 0}  - Tickets Handled`,
    `${stats.ticketsClosed || 0}  - Tickets Closed`,
    `${stats.moderationActions || 0}  - Moderation Actions`,
  ];

  return new EmbedBuilder()
    .setDescription(lines.join('\n'))
    .setColor('#2b2d31');
}

/**
 * Find an existing tracker message for a staff member.
 *
 * This is important because Railway containers can restart.
 * If staffStats.json is lost, we can still find the original
 * tracker message instead of creating another one.
 */
async function findExistingTracker(channel, userId) {
  try {
    let before;

    while (true) {
      const options = {
        limit: 100,
      };

      if (before) {
        options.before = before;
      }

      const messages = await channel.messages.fetch(options);

      if (!messages.size) {
        break;
      }

      for (const message of messages.values()) {
        if (!message.author?.bot) {
          continue;
        }

        if (!message.embeds?.length) {
          continue;
        }

        const description =
          message.embeds[0]?.description || '';

        if (
          description.includes(`<@${userId}>`) &&
          description.includes('Tickets Renamed') &&
          description.includes('Tickets Handled') &&
          description.includes('Tickets Closed')
        ) {
          return message;
        }
      }

      if (messages.size < 100) {
        break;
      }

      before = messages.last().id;
    }
  } catch (error) {
    console.error(
      `[STAFF TRACKER] Failed to search for tracker for ${userId}:`,
      error
    );
  }

  return null;
}

/**
 * Gets the existing tracker message.
 *
 * Priority:
 * 1. Saved message ID
 * 2. Search the channel for the existing tracker
 *
 * This prevents duplicate tracker messages after restarts.
 */
async function getTrackerMessage(channel, userId, entry) {
  // First try the saved message ID.
  if (entry.messageId) {
    const existing = await channel.messages
      .fetch(entry.messageId)
      .catch(() => null);

    if (existing) {
      return existing;
    }

    // Old message ID is invalid.
    entry.messageId = null;
  }

  // If the saved ID doesn't work, search for the old tracker.
  const found = await findExistingTracker(
    channel,
    userId
  );

  if (found) {
    entry.messageId = found.id;
    return found;
  }

  return null;
}

/**
 * Creates a tracker only when one does not already exist.
 */
async function ensureStaffEmbed(guild, userId) {
  // Staff tracker disabled.
  return null;

  const channelId = config.staffTrackerChannelId;

  if (
    !channelId ||
    channelId.startsWith('PUT_')
  ) {
    console.error(
      '[STAFF TRACKER] staffTrackerChannelId is not configured.'
    );
    return false;
  }

  const channel = await guild.channels
    .fetch(channelId)
    .catch((error) => {
      console.error(
        '[STAFF TRACKER] Could not fetch tracker channel:',
        error
      );
      return null;
    });

  if (!channel) {
    return false;
  }

  const allStats = loadStats();
  const key = `${guild.id}:${userId}`;

  let entry =
    allStats[key] || blankEntry();

  // IMPORTANT:
  // Find the existing tracker before creating anything.
  const existing = await getTrackerMessage(
    channel,
    userId,
    entry
  );

  if (existing) {
    allStats[key] = entry;
    saveStats(allStats);

    return false;
  }

  // No existing tracker was found.
  const embed = buildStaffEmbed(
    userId,
    entry
  );

  const sent = await channel
    .send({
      embeds: [embed],
    })
    .catch((error) => {
      console.error(
        '[STAFF TRACKER] Failed to create tracker:',
        error
      );
      return null;
    });

  if (!sent) {
    return false;
  }

  entry.messageId = sent.id;

  allStats[key] = entry;
  saveStats(allStats);

  console.log(
    `[STAFF TRACKER] Created tracker for ${userId}: ${sent.id}`
  );

  return true;
}

/**
 * Increment a staff member's statistic.
 *
 * IMPORTANT:
 * This function edits the existing tracker message.
 * It does NOT send another message if the bot restarts.
 */
async function incrementStat(
  guild,
  userId,
  statKey
) {
  // Staff tracker disabled.
  return;

  const channelId =
    config.staffTrackerChannelId;

  if (
    !channelId ||
    channelId.startsWith('PUT_')
  ) {
    return;
  }

  const channel = await guild.channels
    .fetch(channelId)
    .catch((error) => {
      console.error(
        '[STAFF TRACKER] Could not fetch tracker channel:',
        error
      );
      return null;
    });

  if (!channel) {
    return;
  }

  const allStats = loadStats();
  const key = `${guild.id}:${userId}`;

  const entry =
    allStats[key] || blankEntry();

  // Increase the statistic.
  entry[statKey] =
    (entry[statKey] || 0) + 1;

  /*
   * Find the existing tracker.
   *
   * This is the critical part.
   * Even if Railway restarted and the JSON file
   * disappeared, the bot searches Discord for
   * the existing tracker before creating anything.
   */
  let message = await getTrackerMessage(
    channel,
    userId,
    entry
  );

  const embed = buildStaffEmbed(
    userId,
    entry
  );

  if (message) {
    // EDIT the existing tracker.
    await message
      .edit({
        embeds: [embed],
      })
      .catch((error) => {
        console.error(
          `[STAFF TRACKER] Failed to edit tracker for ${userId}:`,
          error
        );
      });
  } else {
    /*
     * There genuinely isn't a tracker for this
     * staff member, so create the first one.
     */
    message = await channel
      .send({
        embeds: [embed],
      })
      .catch((error) => {
        console.error(
          `[STAFF TRACKER] Failed to create tracker for ${userId}:`,
          error
        );
        return null;
      });

    if (message) {
      entry.messageId = message.id;

      console.log(
        `[STAFF TRACKER] Created new tracker for ${userId}: ${message.id}`
      );
    }
  }

  allStats[key] = entry;
  saveStats(allStats);
}

module.exports = {
  incrementStat,
  ensureStaffEmbed,
  buildStaffEmbed,
  loadStats,
};
