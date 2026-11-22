const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isMod, isAdmin } = require('../utils/permissions');
const {
  WARN_CHANNEL_ID,
  startCheck,
  runningCheck,
  getMissed,
  resetMissed,
  strikesFor,
} = require('../utils/activityCheck');

const priv = (content) => ({ content, flags: MessageFlags.Ephemeral });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('active')
    .setDescription('Staff activity checks')
    .addSubcommand((sub) =>
      sub.setName('check').setDescription('Start an activity check in this channel')
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription("See someone's missed checks and strikes")
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription("Clear someone's missed checks")
        .addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))
    ),

  async execute(interaction) {
    if (!isMod(interaction.member) && !isAdmin(interaction.member)) {
      return interaction.reply(priv("You can't use this command."));
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'check') {
      const running = runningCheck(interaction.guild.id);
      if (running) {
        return interaction.reply(
          priv(`❌ An activity check is already running. It ends <t:${Math.floor(running.endsAt / 1000)}:R>.`)
        );
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        await startCheck(interaction.client, interaction.channel, interaction.user.id);
        return interaction.editReply('✅ Sent successfully.');
      } catch (err) {
        console.error('[active] failed to start check:', err);
        return interaction.editReply("❌ Couldn't start the check. Make sure I can send messages and add reactions here.");
      }
    }

    const user = interaction.options.getUser('user');

    if (sub === 'view') {
      const missed = getMissed(user.id);
      const strikes = strikesFor(missed);
      return interaction.reply(
        priv(`${user} has missed **${missed}** activity check${missed === 1 ? '' : 's'} (**${strikes}** strike${strikes === 1 ? '' : 's'}).`)
      );
    }

    if (sub === 'reset') {
      resetMissed(user.id);
      return interaction.reply(priv(`✅ Cleared ${user}'s missed activity checks.`));
    }
  },
};
