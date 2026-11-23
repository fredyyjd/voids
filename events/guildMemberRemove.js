const config = require('../config.json');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    const channelId = config.leaveChannelId || config.welcomeChannelId;
    if (!channelId || channelId.startsWith('PUT_')) return;

    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const memberCount = member.guild.memberCount;
    const name = member.user?.tag || member.user?.username || 'Someone';

    await channel
      .send(`👋 ${name} has left the server. We now have ${memberCount} members.`)
      .catch((err) => console.error('Failed to send leave message:', err));
  },
};
