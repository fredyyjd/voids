const config = require('../config.json');
const { checkMemberJoin } = require('../utils/antiRaid');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    await checkMemberJoin(member);

    const channelId = config.welcomeChannelId;
    if (!channelId || channelId.startsWith('PUT_')) return;

    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const memberCount = member.guild.memberCount;

    await channel
      .send(`Hey welcome ${member}, you are member number ${memberCount}. Enjoy your stay.`)
      .catch((err) => console.error('Failed to send welcome message:', err));
  },
};
