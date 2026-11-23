const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { balanceEmbed } = require('../utils/shop');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, done, NO_PERMS } = require('../utils/reply');
const economy = require('../utils/economy');
const { COLOR } = require('../utils/theme');
const { ABUSE } = require('../utils/economyConfig');

const ladderText = (strikes) => {
  const step = ABUSE.ladder[Math.min(strikes + 1, ABUSE.ladder.length) - 1];
  if (step.action === 'timeout') return `${Math.round((step.ms / 3600000) * 10) / 10}h timeout`;
  return step.action;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vb')
    .setDescription('Void Bucks (VB)')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('balance')
        .setDescription('Check your VB or someone else\'s')
        .addUserOption((o) => o.setName('user').setDescription('Whose VB to check (default you)'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('strikes')
        .setDescription('See someone\'s VB abuse strikes')
        .addUserOption((o) => o.setName('user').setDescription('Who to check').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('pardon')
        .setDescription('Clear someone\'s VB abuse strikes and restore their earn rate')
        .addUserOption((o) => o.setName('user').setDescription('Who to pardon').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'strikes' || sub === 'pardon') {
      if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

      const target = interaction.options.getUser('user');

      if (sub === 'pardon') {
        economy.pardon(target.id);
        return done(interaction, `Cleared ${target}'s VB abuse strikes and restored their earn rate. Their VB was not given back.`);
      }

      const abuse = economy.peek(target.id).abuse;
      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('VB abuse record')
        .setDescription(
          [
            `**User:** ${target}`,
            `**Strikes:** ${abuse.strikes}`,
            `**Earn rate:** ${Math.round(abuse.rate * 100)}%`,
            `**Last strike:** ${abuse.lastAt ? `<t:${Math.floor(abuse.lastAt / 1000)}:R>` : 'never'}`,
            `**Next strike means:** ${ladderText(abuse.strikes)}`,
          ].join('\n')
        );

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild.members.cache.get(target.id);
    return interaction.reply({ embeds: [balanceEmbed(target, member)], flags: MessageFlags.Ephemeral });
  },
};
