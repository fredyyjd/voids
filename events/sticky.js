const {
  getSticky,
  updateLastMessageId,
  buildStickyEmbed,
  isStickyMessage,
} = require('../utils/stickyManager');

/* =========================================================
   STICKY MESSAGES
   Every new message in a channel with a sticky (members, other bots,
   webhooks and this bot itself) pushes the sticky back to the bottom.
   - waits a moment after the last message so a busy channel doesn't spam
   - one repost at a time per channel, so it can never post two
   - old sticky copies are cleaned up, and nothing is reposted if the sticky
     is already the last message
========================================================= */

const DELAY_MS = 1500;

const timers = new Map(); // channelId -> timeout
const running = new Set(); // channelId currently reposting
const again = new Set(); // channelId that got a message while reposting

async function repost(client, channelId) {
  if (running.has(channelId)) {
    again.add(channelId);
    return;
  }
  running.add(channelId);

  try {
    const sticky = getSticky(channelId);
    if (!sticky) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.messages) return;

    const recent = await channel.messages.fetch({ limit: 25 }).catch(() => null);

    // Already at the bottom: nothing to do.
    const last = recent?.first();
    if (last && isStickyMessage(last, client.user.id) && last.id === sticky.lastMessageId) return;

    // Remove the old sticky and any leftover copies.
    const old = new Set();
    if (sticky.lastMessageId) old.add(sticky.lastMessageId);
    if (recent) {
      for (const m of recent.values()) if (isStickyMessage(m, client.user.id)) old.add(m.id);
    }
    for (const id of old) await channel.messages.delete(id).catch(() => {});

    const sent = await channel.send({ embeds: [buildStickyEmbed(sticky.content)] }).catch((err) => {
      console.error('[sticky] could not send:', err.message);
      return null;
    });
    if (sent) updateLastMessageId(channelId, sent.id);
  } catch (err) {
    console.error('[sticky] repost failed:', err);
  } finally {
    running.delete(channelId);
    if (again.delete(channelId)) schedule(client, channelId);
  }
}

function schedule(client, channelId) {
  clearTimeout(timers.get(channelId));
  timers.set(
    channelId,
    setTimeout(() => {
      timers.delete(channelId);
      repost(client, channelId);
    }, DELAY_MS)
  );
}

module.exports = {
  name: 'sticky',

  register(client) {
    client.on('messageCreate', (message) => {
      if (!message.guild) return;
      if (!getSticky(message.channelId)) return;

      // The sticky itself must not trigger another repost.
      if (isStickyMessage(message, client.user.id)) return;

      schedule(client, message.channelId);
    });
  },
};
