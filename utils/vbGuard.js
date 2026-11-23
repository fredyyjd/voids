const { EmbedBuilder } = require('discord.js');
const economy = require('./economy');
const config = require('../config.json');
const { ACTIVITY, ABUSE } = require('./economyConfig');
const { hasMaxPerms, isMod } = require('./permissions');

const hours = (ms) => `${Math.round((ms / 3600000) * 10) / 10}h`;

function inspect(u, normalized, now) {
  const chat = u.chat;
  chat.recent ||= [];
  chat.gaps ||= [];

  let points = 0;
  let skip = false;

  if (now - (chat.seenAt || 0) < ABUSE.burstMs) points += 1;

  const key = normalized.slice(0, 60);
  if (chat.recent.includes(key)) {
    points += 2;
    skip = true;
  }

  if (new Set(normalized.replace(/\s+/g, '')).size < 4) {
    points += 1;
    skip = true;
  }

  if (chat.at && now - chat.at < ACTIVITY.minGapMs) skip = true;

  if (!skip && chat.at) {
    chat.gaps.push(now - chat.at);
    if (chat.gaps.length > 6) chat.gaps.shift();

    if (chat.gaps.length === 6 && Math.max(...chat.gaps) - Math.min(...chat.gaps) <= ABUSE.macroSpreadMs) {
      points += 3;
      chat.gaps = [];
    }
  }

  chat.recent.push(key);
  if (chat.recent.length > ACTIVITY.recentSize) chat.recent.shift();
  chat.seenAt = now;

  return { points, skip };
}

function addPoints(u, points, now) {
  const abuse = u.abuse;
  abuse.pts = abuse.pts.filter((t) => now - t < ABUSE.windowMs);
  for (let i = 0; i < points; i += 1) abuse.pts.push(now);
  if (abuse.pts.length > 60) abuse.pts = abuse.pts.slice(-60);
  return abuse.pts.length >= ABUSE.pointLimit;
}

function stepFor(strikes) {
  return ABUSE.ladder[Math.min(strikes, ABUSE.ladder.length) - 1];
}

function nextLine(strikes) {
  const next = ABUSE.ladder[Math.min(strikes + 1, ABUSE.ladder.length) - 1];
  if (next.action === 'timeout') return `Next time you will be timed out for **${hours(next.ms)}**, and it keeps getting longer.`;
  if (next.action === 'kick') return 'Next time you will be **kicked**.';
  return 'Next time you will be **banned**.';
}

async function sendLog(guild, embed) {
  const id = config.modLogChannelId;
  if (!id) return;

  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel?.isTextBased?.()) await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

async function punish(message, u) {
  const member = message.member;
  const abuse = u.abuse;

  if (!member || hasMaxPerms(member) || isMod(member)) {
    abuse.pts = [];
    return;
  }

  abuse.strikes += 1;
  abuse.rate = Math.max(ABUSE.minRate, Math.round(abuse.rate * (1 - ABUSE.rateDrop) * 1000) / 1000);
  abuse.pts = [];
  abuse.lastAt = Date.now();

  const wiped = u.vb;
  u.vb = 0;
  u.chat.n = 0;
  economy.touch();

  const step = stepFor(abuse.strikes);
  const percent = Math.round(abuse.rate * 100);

  const summary = {
    warn: 'This is your **warning**.',
    timeout: `You have been **timed out for ${hours(step.ms || 0)}**.`,
    kick: 'You have been **kicked** from the server.',
    ban: 'You have been **banned** from the server.',
  }[step.action];

  const lines = [
    `## ⚠️  Suspected VB abuse in ${message.guild.name}`,
    'Your messages looked like they were being used to farm Void Bucks (spam, repeats or a macro).',
    summary,
    `Your VB was **reset to 0** and your VB earn rate is now **${percent}%**.`,
  ];

  if (step.action !== 'ban') lines.push(step.action === 'kick' ? 'If you come back and do it again, you will be banned.' : nextLine(abuse.strikes));

  const dm = new EmbedBuilder().setColor(0xed4245).setDescription(lines.join('\n'));
  const dmSent = await member.send({ embeds: [dm] }).then(() => true).catch(() => false);

  if (!dmSent && step.action === 'warn') {
    const note = await message.channel
      .send({ content: `${member}, suspected VB abuse: your VB was reset and your earn rate dropped. Keep it up and you will be timed out.`, allowedMentions: { users: [member.id] } })
      .catch(() => null);
    if (note) setTimeout(() => note.delete().catch(() => {}), 20000);
  }

  let result = 'Warning sent';

  try {
    if (step.action === 'timeout') {
      await member.timeout(step.ms, `VB abuse (strike ${abuse.strikes})`);
      result = `Timed out for ${hours(step.ms)}`;
    } else if (step.action === 'kick') {
      await member.kick(`VB abuse (strike ${abuse.strikes})`);
      result = 'Kicked';
    } else if (step.action === 'ban') {
      await member.ban({ reason: `VB abuse (strike ${abuse.strikes})` });
      result = 'Banned';
    }
  } catch (err) {
    result = `Could not apply ${step.action}: ${err.message}`;
  }

  const log = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Suspected VB abuse')
    .setDescription(
      [
        `**User:** ${member} (${member.id})`,
        `**Strike:** ${abuse.strikes}`,
        `**Action:** ${result}`,
        `**VB wiped:** ${economy.fmt(wiped)}`,
        `**Earn rate now:** ${percent}%`,
        `**Channel:** <#${message.channelId}>`,
        `**DM delivered:** ${dmSent ? 'yes' : 'no'}`,
      ].join('\n')
    )
    .setTimestamp();

  await sendLog(message.guild, log);
}

module.exports = { inspect, addPoints, punish };
