const legit = require('../utils/legitPanel');

module.exports = {
  register(client) {
    // Raw packets work even though reactions/messages aren't cached.
    client.on('raw', async (packet) => {
      try {
        if (packet.t !== 'MESSAGE_REACTION_ADD' && packet.t !== 'MESSAGE_REACTION_REMOVE') return;

        const d = packet.d;
        if (d.emoji?.id !== legit.NO_EMOJI.id) return;
        if (d.user_id === client.user?.id) return;

        if (!legit.load()[d.message_id]) return; // not a legit panel

        // took the reaction back: no ban, and their warning goes away
        if (packet.t === 'MESSAGE_REACTION_REMOVE') {
          await legit.cancelVote(client, d.user_id);
          return;
        }

        if (d.member?.user?.bot) return;

        legit.addVote(client, {
          userId: d.user_id,
          messageId: d.message_id,
          channelId: d.channel_id,
          guildId: d.guild_id,
        });

        const channel = await client.channels.fetch(d.channel_id).catch(() => null);
        if (!channel) return;

        // pings everyone who currently has the no reaction: @a, @b
        await legit.sendWarning(client, channel, d.message_id, d.user_id);
      } catch (err) {
        console.error('[legit] reaction failed:', err);
      }
    });

    client.once('ready', () => legit.rearmVotes(client));
  },
};
