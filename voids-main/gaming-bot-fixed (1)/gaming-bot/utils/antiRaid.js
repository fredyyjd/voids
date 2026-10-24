const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

let recentJoins = [];
let raidActiveUntil = 0;

async function checkMemberJoin(member) {
  const settings = config.antiRaid;
  if (!settings || !settings.enabled) return;

  const now = Date.now();
  const windowMs = (settings.windowSeconds || 10) * 1000;

  recentJoins.push(now);
  recentJoins = recentJoins.filter((t) => now - t <= windowMs);

  const threshold = settings.joinThreshold || 5;
  const alertChannelId = settings.alertChannelId;

  if (recentJoins.length >= threshold && now > raidActiveUntil) {
    raidActiveUntil = now + 5 * 60 * 1000;

    if (alertChannelId && !alertChannelId.startsWith('PUT_')) {
      const channel = await member.guild.channels.fetch(alertChannelId).catch(() => null);
      if (channel) {
        const embed = new EmbedBuilder()
          .setTitle('Possible Raid Detected')
          .setDescription(
            `${recentJoins.length} members joined within ${settings.windowSeconds || 10} seconds. ` +
              `Auto-kicking new accounts younger than ${settings.minAccountAgeMinutes || 10} minutes for the next 5 minutes.`
          )
          .setColor('#ED4245')
          .setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  }

  const raidCurrentlyActive = now < raidActiveUntil;
  if (raidCurrentlyActive) {
    const accountAgeMs = now - member.user.createdTimestamp;
    const minAgeMs = (settings.minAccountAgeMinutes || 10) * 60 * 1000;

    if (accountAgeMs < minAgeMs) {
      await member.kick('Anti-raid: account too new during an active raid window').catch(() => {});

      if (alertChannelId && !alertChannelId.startsWith('PUT_')) {
        const channel = await member.guild.channels.fetch(alertChannelId).catch(() => null);
        if (channel) {
          await channel
            .send(`👢 Kicked ${member.user.tag} (${member.id}) — account created too recently during active raid protection.`)
            .catch(() => {});
        }
      }
    }
  }
}

module.exports = { checkMemberJoin };
