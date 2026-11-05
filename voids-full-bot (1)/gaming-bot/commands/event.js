const { SlashCommandBuilder } = require('discord.js');
const { box, priv } = require('../utils/box');
const { isEventManager } = require('../utils/eventPerms');
const { TYPES } = require('../utils/eventTypes');
const store = require('../utils/eventStore');
const flow = require('../utils/eventFlow');

const medal = (i) => ['🥇', '🥈', '🥉'][i] || `**${i + 1}.**`;
const fail = (interaction, text) => interaction.reply(priv(box(`❌ ${text}`)));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Run and view Voids Events')
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('What to do (default: create an event)')
        .addChoices(
          { name: 'Create an event', value: 'create' },
          { name: 'Running events', value: 'status' },
          { name: 'End an event early (posts results)', value: 'end' },
          { name: 'Cancel an event', value: 'cancel' },
          { name: 'Skip the current round', value: 'skip' },
          { name: 'Event history', value: 'history' },
          { name: 'Leaderboard', value: 'leaderboard' },
          { name: 'Player profile', value: 'profile' }
        )
    )
    .addUserOption((o) => o.setName('user').setDescription('Whose profile to show (default: you)')),

  async execute(interaction) {
    const action = interaction.options.getString('action') || 'create';

    // Leaderboard and profiles are open to everyone. Everything else is for event managers.
    const open = ['leaderboard', 'profile'];
    if (!open.includes(action) && !isEventManager(interaction.member)) {
      return fail(interaction, "You can't use this command.");
    }

    if (action === 'create') {
      if (!flow.inEventCategory(interaction.channel)) return fail(interaction, flow.NOT_EVENT_CHANNEL());
      return interaction.reply(flow.typeMenuPayload());
    }
    if (['end', 'cancel', 'skip'].includes(action)) return flow.manageCommand(interaction, action);
    if (action === 'status') return interaction.reply(priv(box(['## 📋 Running events', flow.statusText(interaction.guildId)])));

    if (action === 'leaderboard') {
      const rows = Object.entries(store.load().stats)
        .map(([id, s]) => ({ id, ...s }))
        .filter((s) => s.points > 0 || s.wins > 0)
        .sort((a, b) => b.points - a.points || b.wins - a.wins)
        .slice(0, 10);

      if (!rows.length) return interaction.reply(priv(box('No event results yet.')));

      return interaction.reply(
        box([
          '## 🏆 Event Leaderboard',
          rows.map((r, i) => `${medal(i)} <@${r.id}> — **${r.points}** pts · ${r.wins} wins · ${r.podiums} podiums`).join('\n'),
          '-# Skill events only. Giveaway wins are not counted here.',
        ])
      );
    }

    if (action === 'profile') {
      const user = interaction.options.getUser('user') || interaction.user;
      const s = store.load().stats[user.id] || { played: 0, wins: 0, podiums: 0, points: 0 };
      return interaction.reply(
        priv(
          box([
            `## 👤 ${user.username}'s event profile`,
            `🎮 **Events played:** ${s.played}\n🏆 **Wins:** ${s.wins}\n🥇 **Podium finishes:** ${s.podiums}\n⭐ **Event points:** ${s.points}`,
          ])
        )
      );
    }

    if (action === 'history') {
      const data = store.load();
      const recent = data.history
        .slice(-10)
        .reverse()
        .map((id) => data.events[id])
        .filter(Boolean)
        .filter((e) => e.guildId === interaction.guildId);

      if (!recent.length) return interaction.reply(priv(box('No finished events yet.')));

      const lines = recent.map((e) => {
        const winners = e.winners?.length ? e.winners.map((u) => `<@${u}>`).join(', ') : 'no winners';
        return `**#${e.id}** ${TYPES[e.type].emoji} ${TYPES[e.type].label} · ${e.prize || 'no prize'} · ${winners} · <t:${Math.floor(e.endedAt / 1000)}:R>`;
      });
      return interaction.reply(priv(box(['## 📜 Recent events', lines.join('\n')])));
    }
  },
};
