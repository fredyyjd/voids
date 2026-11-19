const { EmbedBuilder, MessageType } = require('discord.js');
const { COLOR } = require('../utils/theme');

const BOOST_CHANNEL_ID = '1526915568526032991';
const BOOSTER_ROLE_ID = '1496760582718886019';

const BOOST_TYPES = new Set([
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
]);

const recent = new Map();

async function thank(guild, user) {
  // Both detections below can fire for one boost, only thank once.
  const key = `${guild.id}:${user.id}`;
  if (Date.now() - (recent.get(key) || 0) < 2 * 60 * 1000) return;
  recent.set(key, Date.now());

  const channel = await guild.channels.fetch(BOOST_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0xf47fff)
    .setThumbnail(user.displayAvatarURL())
    .setDescription(`Thank you so much for the boost, you got <@&${BOOSTER_ROLE_ID}>! ty <3`)
    .setTimestamp();

  await channel
    .send({ content: `<@${user.id}>`, embeds: [embed], allowedMentions: { users: [user.id] } })
    .catch((err) => console.error('[boost] could not send thank you:', err.message));
}

// Thanks the booster in the boost channel when someone boosts the server.
module.exports = {
  register(client) {
    // Cached members: premiumSince goes from empty to a date.
    client.on('guildMemberUpdate', (oldMember, newMember) => {
      if (oldMember.partial) return; // not cached, the system message below covers it
      if (!oldMember.premiumSince && newMember.premiumSince) thank(newMember.guild, newMember.user).catch(() => {});
    });

    // Discord's own "X just boosted the server" message.
    client.on('messageCreate', (message) => {
      if (!message.guild || !BOOST_TYPES.has(message.type)) return;
      thank(message.guild, message.author).catch(() => {});
    });

    setInterval(() => {
      const now = Date.now();
      for (const [key, t] of recent) if (now - t > 10 * 60 * 1000) recent.delete(key);
    }, 10 * 60 * 1000).unref?.();
  },
};
