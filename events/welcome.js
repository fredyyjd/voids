module.exports = {
  name: 'welcome',
  register(client) {
    client.on('guildMemberAdd', async (member) => {
      try {
        await member.user.send("**welcome to Void's Cove**");
      } catch (err) {
        console.log(
          `[WELCOME] Could not DM ${member.user?.tag || member.user?.username || member.id}. DMs may be closed.`
        );
      }
    });
  },
};
