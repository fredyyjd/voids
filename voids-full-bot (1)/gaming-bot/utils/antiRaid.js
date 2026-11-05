const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

/* =========================================================
   ANTI-RAID (harsher)

   `joinThreshold` joins inside `windowSeconds` = raid. For the next
   `raidMinutes` minutes:
     - accounts younger than `banAccountAgeMinutes` are BANNED
     - accounts younger than `minAccountAgeMinutes` are KICKED
   The people who made the burst trigger are checked straight away too.

   config.json "antiRaid" block (all optional except enabled):
     enabled, joinThreshold (4), windowSeconds (10), raidMinutes (10),
     minAccountAgeMinutes (4320 = 3 days), banAccountAgeMinutes (60),
     alertChannelId
========================================================= */

let recentJoins = []; // { t, member }
let raidActiveUntil = 0;

function settings() {
  const s = config.antiRaid || {};
  return {
    enabled: !!s.enabled,
    threshold: s.joinThreshold || 4,
    windowMs: (s.windowSeconds || 10) * 1000,
    raidMs: (s.raidMinutes || 10) * 60 * 1000,
    minAgeMs: (s.minAccountAgeMinutes || 4320) * 60 * 1000,
    banAgeMs: (s.banAccountAgeMinutes || 60) * 60 * 1000,
    alertChannelId: s.alertChannelId,
  };
}

async function getAlertChannel(guild, cfg) {
  const id = cfg.alertChannelId;
  if (!id || String(id).startsWith('PUT_')) return null;
  return guild.channels.fetch(id).catch(() => null);
}

// Bans or kicks one new account. Returns 'banned' | 'kicked' | null.
async function punishNewAccount(member, cfg, now) {
  const age = now - member.user.createdTimestamp;

  if (age < cfg.banAgeMs) {
    const ok = await member
      .ban({ reason: 'Anti-raid: brand new account during an active raid', deleteMessageSeconds: 60 * 60 })
      .then(() => true)
      .catch(() => false);
    return ok ? 'banned' : null;
  }

  if (age < cfg.minAgeMs) {
    const ok = await member
      .kick('Anti-raid: account too new during an active raid window')
      .then(() => true)
      .catch(() => false);
    return ok ? 'kicked' : null;
  }

  return null;
}

async function checkMemberJoin(member) {
  const cfg = settings();
  if (!cfg.enabled) return;

  const now = Date.now();

  recentJoins.push({ t: now, member });
  recentJoins = recentJoins.filter((j) => now - j.t <= cfg.windowMs);

  // A burst of joins starts a raid window and checks everyone in the burst.
  if (recentJoins.length >= cfg.threshold && now > raidActiveUntil) {
    raidActiveUntil = now + cfg.raidMs;

    const burst = recentJoins.map((j) => j.member);
    let banned = 0;
    let kicked = 0;
    for (const m of burst) {
      const result = await punishNewAccount(m, cfg, now);
      if (result === 'banned') banned += 1;
      if (result === 'kicked') kicked += 1;
    }

    const channel = await getAlertChannel(member.guild, cfg);
    if (channel) {
      const embed = new EmbedBuilder()
        .setTitle('Possible Raid Detected')
        .setDescription(
          `${burst.length} members joined within ${Math.round(cfg.windowMs / 1000)} seconds.\n` +
            `Raid protection is on for ${Math.round(cfg.raidMs / 60000)} minutes: accounts under ` +
            `${Math.round(cfg.banAgeMs / 60000)} minutes old are banned, under ` +
            `${Math.round(cfg.minAgeMs / 60000)} minutes are kicked.\n\n` +
            `From the burst: **${banned}** banned, **${kicked}** kicked.`
        )
        .setColor('#ED4245')
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
    return;
  }

  // During an active raid window every new join is checked.
  if (now < raidActiveUntil) {
    const result = await punishNewAccount(member, cfg, now);
    if (!result) return;

    const channel = await getAlertChannel(member.guild, cfg);
    if (channel) {
      await channel
        .send(
          `${result === 'banned' ? '🔨 Banned' : '👢 Kicked'} ${member.user.tag} (${member.id}) - account created too recently during active raid protection.`
        )
        .catch(() => {});
    }
  }
}

module.exports = { checkMemberJoin };
