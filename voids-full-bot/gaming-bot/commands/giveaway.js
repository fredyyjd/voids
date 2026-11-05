const { SlashCommandBuilder } = require('discord.js');
const { isMod } = require('../utils/permissions');
const { fail, done, NO_PERMS } = require('../utils/reply');
const { box } = require('../utils/box');
const {
  loadGiveaways,
  saveGiveaways,
  pickWinners,
  buildGiveawayEmbed,
  buildJoinRow,
  buildClaimRow,
  rememberClaimMessage,
  endGiveaway,
} = require('../utils/giveawayManager');
const { buildStartModal } = require('../utils/giveawayFlow');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run giveaways')
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a giveaway')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('What kind of giveaway (default: Giveaway)')
            .addChoices(
              { name: 'Giveaway', value: 'giveaway' },
              { name: 'Split, Steal', value: 'splitsteal' }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName('end')
        .setDescription('End a giveaway now')
        .addStringOption((o) => o.setName('id').setDescription('Giveaway message ID').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('Pick new winners')
        .addStringOption((o) => o.setName('id').setDescription('Giveaway message ID').setRequired(true))
    ),

  async execute(interaction) {
    if (!isMod(interaction.member)) return fail(interaction, NO_PERMS);

    const sub = interaction.options.getSubcommand();

    /* ---------- start ----------
       Opens the form. The form itself is handled in
       utils/giveawayFlow.js (handleStartModal). */
    if (sub === 'start') {
      const type = interaction.options.getString('type') || 'giveaway';
      return interaction.showModal(buildStartModal(type));
    }

    /* ---------- end ---------- */
    if (sub === 'end') {
      const id = interaction.options.getString('id');
      const giveaway = loadGiveaways()[id];

      if (!giveaway) return fail(interaction, 'Giveaway not found.');
      if (giveaway.ended) return fail(interaction, 'That giveaway already ended.');

      await done(interaction, 'Ending giveaway.');
      return endGiveaway(interaction.client, id);
    }

    /* ---------- reroll ---------- */
    if (sub === 'reroll') {
      const id = interaction.options.getString('id');
      const giveaways = loadGiveaways();
      const giveaway = giveaways[id];

      if (!giveaway || !giveaway.ended) return fail(interaction, 'Giveaway not found or still running.');
      if (giveaway.type === 'splitsteal') return fail(interaction, "Split or Steal giveaways can't be rerolled.");

      const winners = pickWinners(giveaway.entrants || [], giveaway.winnerCount);
      if (!winners.length) return fail(interaction, 'Nobody entered, so there\'s no one to pick.');

      giveaway.winners = winners;
      giveaway.claimed = []; // new winners, nobody has claimed yet
      giveaways[id] = giveaway;
      saveGiveaways(giveaways);

      try {
        const channel = await interaction.client.channels.fetch(giveaway.channelId);
        const message = await channel.messages.fetch(id).catch(() => null);
        if (message) {
          await message.edit({
            embeds: [buildGiveawayEmbed(giveaway)],
            components: [buildJoinRow((giveaway.entrants || []).length, true)],
          });
        }
      } catch (err) {
        console.error('[giveaway] reroll edit failed:', err);
      }

      // The new winners get their own Claim Prize button.
      await interaction.reply(
        box(
          `🎉 New winner${winners.length > 1 ? 's' : ''} for **${giveaway.prize}**: ${winners.map((w) => `<@${w}>`).join(', ')}`,
          { rows: [buildClaimRow(id, giveaway)] }
        )
      );

      const reply = await interaction.fetchReply().catch(() => null);
      rememberClaimMessage(id, reply);
      return;
    }
  },
};
