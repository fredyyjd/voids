const { MessageFlags, EmbedBuilder } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const pingProt = require('../utils/pingProt');
const disputes = require('../utils/disputes');
const modStats = require('../utils/modStats');
const autoMod = require('../utils/autoMod');

const recent = new Set();

const REASON = 'You pinged someone who has ping protection.';

const clip = (text, n) => {
  const s = String(text ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function formatDuration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (mins) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`);
  return parts.join(' ');
}

async function handleBlocked(execution) {
  const guild = execution.guild;
  const rule =
    execution.autoModerationRule || (await guild.autoModerationRules.fetch(execution.ruleId).catch(() => null));
  if (!rule || !rule.name.startsWith('Ping Protection')) return;

  const userId = execution.userId;
  const dedupe = `${userId}:${Math.floor(Date.now() / 10000)}`;
  if (recent.has(dedupe)) return;
  recent.add(dedupe);
  setTimeout(() => recent.delete(dedupe), 30000).unref?.();
  console.log(`[ping prot] auto mod caught ${userId} (action ${execution.action?.type})`);

  const user = await guild.client.users.fetch(userId).catch(() => null);
  if (!user) return;

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  const until = member?.communicationDisabledUntilTimestamp || 0;
  const timedOut = until > Date.now();
  const ms = timedOut ? until - Date.now() : 0;

  const evidence = execution.content
    ? [{ text: clip(execution.content, 300), channelId: execution.channelId }]
    : [];

  let dmSent = false;
  if (timedOut) {
    const punId = disputes.recordPunishment({
      guildId: guild.id,
      userId,
      kind: 'ping_protection',
      reason: REASON,
      timeoutText: formatDuration(ms),
      evidence,
    });
    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setDescription(
        `You were timed out in **${guild.name}** for **${formatDuration(ms)}**.\n` +
          `**Reason:** ${REASON}\n` +
          `Your timeout ends <t:${Math.floor(until / 1000)}:R>.\n\n` +
          'Our automatic moderation system is currently in **beta**, so it can make mistakes. ' +
          'If you think this was a mistake, press **Contact higher ups** below.'
      );
    dmSent = await user
      .send({ embeds: [embed], components: [disputes.contactRow(punId)] })
      .then(() => true)
      .catch(() => false);
  } else {
    const embed = new EmbedBuilder()
      .setColor('#FEE75C')
      .setDescription(
        `Your message in **${guild.name}** was blocked.\n**Reason:** ${REASON}\n\n` +
          "Don't ping people or roles that have ping protection."
      );
    dmSent = await user.send({ embeds: [embed] }).then(() => true).catch(() => false);
  }

  modStats.record('ping_protection', userId, { ok: timedOut });

  const log = new EmbedBuilder()
    .setTitle(timedOut ? 'Auto Mod: Protected Ping' : 'Auto Mod: Protected Ping - TIMEOUT FAILED')
    .setColor(timedOut ? '#ED4245' : '#FEE75C')
    .addFields(
      { name: 'User', value: `<@${userId}> (${user.tag})`, inline: true },
      { name: 'Channel', value: execution.channelId ? `<#${execution.channelId}>` : 'Unknown', inline: true },
      { name: 'Timeout', value: timedOut ? formatDuration(ms) : 'None', inline: true },
      { name: 'Reason', value: REASON },
      { name: 'Message', value: clip(execution.content || '*No text*', 1000) },
      { name: 'DM sent', value: dmSent ? 'Yes' : 'No (DMs closed)', inline: true }
    )
    .setFooter({ text: 'Auto moderation (beta)' })
    .setTimestamp();
  await autoMod.sendLog(guild, autoMod.settings(), log);
}

const timers = new Map();

function scheduleSync(guild, delay = 5000) {
  clearTimeout(timers.get(guild.id));
  timers.set(
    guild.id,
    setTimeout(() => {
      timers.delete(guild.id);
      pingProt.syncAutoMod(guild).catch((err) => console.error('[ping prot] sync error:', err));
    }, delay)
  );
}

module.exports = {
  name: 'pingProtPanel',

  register(client) {
    client.once('ready', () => {
      for (const guild of client.guilds.cache.values()) scheduleSync(guild, 10000);
    });

    client.on('autoModerationActionExecution', (execution) => {
      handleBlocked(execution).catch((err) => console.error('[ping prot] block handler error:', err));
    });

    client.on('guildMemberUpdate', (oldMember, newMember) => {
      try {
        const { roles } = pingProt.getAll();
        if (!roles.length) return;
        const before = oldMember.partial ? null : oldMember.roles.cache;
        const changed = before
          ? roles.some((id) => before.has(id) !== newMember.roles.cache.has(id))
          : roles.some((id) => newMember.roles.cache.has(id));
        if (changed) scheduleSync(newMember.guild);
      } catch (err) {
        console.error('[ping prot] member update error:', err);
      }
    });

    client.on('interactionCreate', async (interaction) => {
      try {
        const id = interaction.customId || '';
        const isPanel =
          (interaction.isUserSelectMenu() && id === 'pprot_add_u') ||
          (interaction.isRoleSelectMenu() && id === 'pprot_add_r') ||
          (interaction.isStringSelectMenu() && id === 'pprot_rm') ||
          (interaction.isButton() && id === 'pprot_clear');
        if (!isPanel) return;

        if (!hasMaxPerms(interaction.member)) {
          return interaction.reply({ content: "You can't use this.", flags: MessageFlags.Ephemeral });
        }

        await interaction.deferUpdate();

        if (id === 'pprot_add_u') {
          for (const userId of interaction.values) pingProt.add('user', userId);
        } else if (id === 'pprot_add_r') {
          for (const roleId of interaction.values) {
            if (roleId !== interaction.guild.id) pingProt.add('role', roleId);
          }
        } else if (id === 'pprot_rm') {
          for (const value of interaction.values) {
            const [kind, targetId] = value.split(':');
            pingProt.remove(kind === 'r' ? 'role' : 'user', targetId);
          }
        } else if (id === 'pprot_clear') {
          const { roles, users } = pingProt.getAll();
          roles.forEach((roleId) => pingProt.remove('role', roleId));
          users.forEach((userId) => pingProt.remove('user', userId));
        }

        const status = await pingProt.syncAutoMod(interaction.guild);
        await interaction.editReply(await pingProt.buildPanel(interaction.guild, status));
      } catch (err) {
        console.error('[ping prot] panel error:', err);
      }
    });
  },
};
