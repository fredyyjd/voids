const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const extra = require('../extraConfig');
const records = require('./staffRecords');
const points = require('./staffPoints');
const activity = require('./activityCheck');
const cfg = require('./staffConfig');
const store = require('./staffStore');
const scoring = require('./staffScoring');
const review = require('./staffReview');
const { hasBypassRole } = require('./staffBypass');
const { COLOR } = require('./theme');

const RED = 0xed4245;
const YELLOW = 0xfee75c;
const GREEN = 0x57f287;
const settings = extra.staff;
const isSet = cfg.isSet;
const NO_PING = { parse: [] };

const stamp = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function meter(done, total) {
  const filled = Math.max(0, Math.min(total, done));
  return `${'▰'.repeat(filled)}${'▱'.repeat(total - filled)}  **${done}/${total}**`;
}

function quote(text) {
  return String(text)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
    .slice(0, 1000);
}

function logChannelId() {
  if (isSet(settings.logChannelId)) return settings.logChannelId;
  if (isSet(activity.WARN_CHANNEL_ID)) return activity.WARN_CHANNEL_ID;
  return config.modLogChannelId;
}

async function sendStaffLog(guild, payload) {
  const id = logChannelId();
  if (!isSet(id)) return;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel && channel.isTextBased()) await channel.send({ allowedMentions: NO_PING, ...payload }).catch(() => {});
}

function alertRoles() {
  const roles = (settings.alertRoleIds && settings.alertRoleIds.length ? settings.alertRoleIds : config.adminRoleIds) || [];
  return roles.filter(isSet);
}

const dm = (user, text) => user.send(text).catch(() => {});

function logEmbed(color, title, target, by) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setThumbnail(target.displayAvatarURL({ size: 128 }))
    .setDescription(`${target}\nby ${by}`)
    .setTimestamp();
}

async function demotionAlert(guild, target, strikes) {
  const roles = alertRoles();
  const embed = new EmbedBuilder()
    .setColor(RED)
    .setTitle('Demotion queued')
    .setThumbnail(target.displayAvatarURL({ size: 128 }))
    .setDescription(
      `${target} is on **${strikes}** valid strikes (the demotion line is **${records.STRIKES_FOR_DEMOTION}**).\n` +
        `They will move down one rank at the weekly review ${stamp(points.nextResetMs())}.`
    )
    .setTimestamp();

  await sendStaffLog(guild, {
    content: roles.length ? roles.map((r) => `<@&${r}>`).join(' ') : undefined,
    embeds: [embed],
    allowedMentions: { roles },
  });
}

function result(embed, ok = true) {
  return { ok, embed };
}

function notice(text, color = COLOR) {
  return new EmbedBuilder().setColor(color).setDescription(text);
}

async function checkTarget(guild, actor, target, { selfBlocked = true, bypassBlocked = true } = {}) {
  if (target.bot) return "You can't use that on a bot.";
  if (selfBlocked && target.id === actor.id) return "You can't use that on yourself.";
  if (bypassBlocked) {
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (hasBypassRole(member)) return `${target.username} holds a management bypass role and is exempt from staff warns and strikes.`;
  }
  return null;
}

async function warn({ guild, actor, target, reason, evidence }) {
  const problem = await checkTarget(guild, actor, target);
  if (problem) return result(notice(problem, RED), false);

  const res = records.addWarn(target.id, reason, actor.id, { evidence });
  const atLine = res.strikes >= records.STRIKES_FOR_DEMOTION;

  await dm(
    target,
    `You received a **staff warning** in **${guild.name}**.\nReason: ${reason}\n` +
      (res.autoStrike
        ? `That was warning ${records.WARNS_PER_STRIKE}, so it turned into a **strike** (${res.strikes}/${records.STRIKES_FOR_DEMOTION}).`
        : `Warns: ${res.warns}/${records.WARNS_PER_STRIKE}`)
  );

  const embed = logEmbed(res.autoStrike ? RED : YELLOW, res.autoStrike ? 'Staff Warn became a Strike' : 'Staff Warn', target, actor)
    .addFields({ name: 'Reason', value: quote(reason) });

  if (res.autoStrike) {
    embed.addFields({ name: 'Valid strikes', value: meter(res.strikes, records.STRIKES_FOR_DEMOTION), inline: true });
  } else {
    embed.addFields({ name: 'Warns', value: meter(res.warns, records.WARNS_PER_STRIKE), inline: true });
  }
  if (evidence) embed.addFields({ name: 'Evidence', value: String(evidence).slice(0, 1000) });

  await sendStaffLog(guild, { embeds: [embed] });
  if (res.autoStrike && atLine) await demotionAlert(guild, target, res.strikes);

  return result(
    notice(
      res.autoStrike
        ? `Warned ${target}. That was warn ${records.WARNS_PER_STRIKE}, so it became a **strike** (${res.strikes}/${records.STRIKES_FOR_DEMOTION}).` +
            (atLine ? '\nThey are at the demotion line and management was alerted.' : '')
        : `Warned ${target}.\nWarns  ${meter(res.warns, records.WARNS_PER_STRIKE)}`,
      res.autoStrike ? RED : YELLOW
    )
  );
}

async function strike({ guild, actor, target, reason, evidence }) {
  const problem = await checkTarget(guild, actor, target);
  if (problem) return result(notice(problem, RED), false);

  const res = records.addStrike(target.id, reason, actor.id, { evidence });
  const atLine = res.strikes >= records.STRIKES_FOR_DEMOTION;

  await dm(
    target,
    `You received a **staff strike** in **${guild.name}**.\nReason: ${reason}\nValid strikes: ${res.strikes}/${records.STRIKES_FOR_DEMOTION}` +
      (atLine ? '\nYou reached the demotion line, you will be demoted at the next weekly review.' : '')
  );

  const embed = logEmbed(RED, 'Staff Strike', target, actor).addFields(
    { name: 'Reason', value: quote(reason) },
    { name: 'Valid strikes', value: meter(res.strikes, records.STRIKES_FOR_DEMOTION), inline: true }
  );
  if (evidence) embed.addFields({ name: 'Evidence', value: String(evidence).slice(0, 1000) });
  embed.setFooter({ text: `Strike ID ${res.strike.id}` });

  await sendStaffLog(guild, { embeds: [embed] });
  if (atLine) await demotionAlert(guild, target, res.strikes);

  return result(
    notice(
      `Struck ${target}.\nValid strikes  ${meter(res.strikes, records.STRIKES_FOR_DEMOTION)}` +
        (atLine ? '\nThey are at the demotion line and management was alerted.' : ''),
      RED
    )
  );
}

async function removeEntries({ guild, actor, target, kind, amount = 1 }) {
  const problem = await checkTarget(guild, actor, target, { bypassBlocked: false });
  if (problem) return result(notice(problem, RED), false);

  const isWarn = kind === 'warn';
  const res = isWarn ? records.removeWarn(target.id, amount) : records.removeStrike(target.id, amount);

  if (!res.removed) return result(notice(`${target} has no ${kind}s to remove.`), false);

  const embed = logEmbed(GREEN, isWarn ? 'Staff Warn Removed' : 'Staff Strike Removed', target, actor).addFields(
    { name: 'Removed', value: `${res.removed}`, inline: true },
    { name: 'Warns now', value: meter(res.warns, records.WARNS_PER_STRIKE), inline: true },
    { name: 'Valid strikes now', value: meter(res.strikes, records.STRIKES_FOR_DEMOTION), inline: true }
  );
  await sendStaffLog(guild, { embeds: [embed] });

  return result(
    notice(
      `Removed ${res.removed} ${kind}${res.removed === 1 ? '' : 's'} from ${target}.\nWarns  ${meter(res.warns, records.WARNS_PER_STRIKE)}\nValid strikes  ${meter(res.strikes, records.STRIKES_FOR_DEMOTION)}`,
      GREEN
    )
  );
}

async function resetRecord({ guild, actor, target }) {
  if (target.bot) return result(notice("You can't use that on a bot.", RED), false);

  records.resetRecord(target.id);
  const embed = logEmbed(COLOR, 'Staff Record Reset', target, actor).addFields({
    name: 'Cleared',
    value: 'All warns and strikes',
  });
  await sendStaffLog(guild, { embeds: [embed] });

  return result(notice(`Cleared all warns and strikes for ${target}.`));
}

function statusOf(entry) {
  if (entry.consumedBy) return 'used for a demotion';
  if (!records.isValid(entry)) return 'expired';
  return 'valid';
}

function historyLines(list, withStatus = false) {
  if (!list.length) return '*None*';
  return list
    .slice(-5)
    .map((e) => {
      const tag = withStatus ? ` · ${statusOf(e)}` : '';
      const evidence = e.evidence ? `\n-# evidence: ${String(e.evidence).slice(0, 120)}` : '';
      return `${stamp(e.at, 'd')}${tag} · ${String(e.reason).slice(0, 150)} *(by <@${e.by}>)*${evidence}`.slice(0, 450);
    })
    .join('\n');
}

function recordEmbed(user, rec, extraFields = []) {
  const valid = rec.strikes.filter((s) => records.isValid(s)).length;
  return new EmbedBuilder()
    .setTitle(`Staff record · ${user.username}`)
    .setColor(valid >= records.STRIKES_FOR_DEMOTION ? RED : rec.warns.length || valid ? YELLOW : GREEN)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Warns', value: `${meter(rec.warns.length, records.WARNS_PER_STRIKE)}\n${historyLines(rec.warns)}`.slice(0, 1020) },
      { name: 'Strikes', value: `${meter(valid, records.STRIKES_FOR_DEMOTION)}\n${historyLines(rec.strikes, true)}`.slice(0, 1020) },
      ...extraFields
    );
}

function lookupEmbed(user, member) {
  const missed = activity.getMissed(user.id);
  const extraFields = [
    {
      name: 'Activity checks missed',
      value: missed
        ? `**${missed}** missed · ${Math.min(missed, activity.WARNINGS_BEFORE_STRIKE)} warning${Math.min(missed, activity.WARNINGS_BEFORE_STRIKE) === 1 ? '' : 's'} · ${activity.strikesFor(missed)} strike${activity.strikesFor(missed) === 1 ? '' : 's'}`
        : '*None*',
    },
    { name: 'Staff points this week', value: `**${points.pointsFor(user.id)}**`, inline: true },
    { name: 'Staff points all time', value: `**${points.pointsFor(user.id, 'alltime')}**`, inline: true },
  ];
  const embed = recordEmbed(user, records.getRecord(user.id), extraFields);
  if (hasBypassRole(member)) embed.setFooter({ text: 'Exempt from automatic staff management' });
  return embed;
}

function activityEmbed(user, member) {
  const week = store.weekKey();
  const stats = store.weekStats(week, user.id);
  const days = store.activeDays(stats);
  const prot = points.protection(user.id);
  const res = scoring.scoreWeek(stats, days, undefined, undefined, prot.counted);
  const history = store.getHistory(user.id).slice(-4);
  const exempt = hasBypassRole(member);

  return new EmbedBuilder()
    .setTitle(`Activity this week · ${user.username}`)
    .setColor(COLOR)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setDescription(
      (exempt ? 'Exempt from automatic promotion, demotion, strikes and timeouts.\n\n' : '') +
        `Score so far **${res.score}**${res.strong ? ' (strong week)' : ''} · ${prot.counted} counted points${prot.safe ? ' · safe from warnings' : ` · needs ${Math.ceil(prot.needed - prot.counted)} more to be safe`}`
    )
    .addFields(
      { name: 'Messages', value: `${stats.msgs}`, inline: true },
      { name: 'Active days', value: `${days}`, inline: true },
      { name: 'Staff points', value: `${points.pointsFor(user.id)}`, inline: true },
      { name: 'Tickets', value: `${stats.handled} handled · ${stats.closed} closed`, inline: true },
      { name: 'Giveaways', value: `${stats.giveaways}`, inline: true },
      { name: 'Schematics', value: `${stats.schematics}`, inline: true },
      { name: 'Duties', value: `${stats.mod + stats.events}`, inline: true },
      {
        name: 'Last reviews',
        value: history.length
          ? history.map((h) => `${h.loa ? 'LOA' : h.score}${h.strong ? ' (strong)' : ''} as ${review.labelOf(h.rank)}`).join('\n')
          : '*No reviews yet*',
      }
    )
    .setFooter({ text: 'Resets with the staff points week' });
}

module.exports = {
  RED,
  YELLOW,
  GREEN,
  NO_PING,
  meter,
  stamp,
  sendStaffLog,
  warn,
  strike,
  removeEntries,
  resetRecord,
  recordEmbed,
  lookupEmbed,
  activityEmbed,
};
