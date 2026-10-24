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

        // took the reaction back: no ban
        if (packet.t === 'MESSAGE_REACTION_REMOVE') {
          legit.clearVote(d.user_id);
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

        // ping everyone who currently has the no reaction: @a, @b
        const voters = legit.activeVoters(d.message_id);
        if (!voters.includes(d.user_id)) voters.push(d.user_id);

        await channel.send({
          content: legit.voteMessage(voters),
          allowedMentions: { users: voters },
        });
      } catch (err) {
        console.error('[legit] reaction failed:', err);
      }
    });

    client.once('ready', () => legit.rearmVotes(client));
  },
};
