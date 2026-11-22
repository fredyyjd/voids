const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const economy = require('../utils/economy');
const { COLOR } = require('../utils/theme');
const { COUNTING, FOOTER } = require('../utils/economyConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('countset')
    .setDescription('Set the counting channel (max perms only)')
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('channel').setDescription('Channel ID (or a #channel). Type off to turn counting off').setRequired(true)
    ),

  async execute(interaction) {
    if (!hasMaxPerms(interaction.member)) {
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const raw = interaction.options.getString('channel').trim();

    if (raw.toLowerCase() === 'off') {
      economy.clearCountingChannel();
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLOR).setDescription('Counting is now **off**.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const id = (raw.match(/\d{15,25}/) || [])[0];
    const channel = id ? await interaction.guild.channels.fetch(id).catch(() => null) : null;

    if (!channel || !channel.isTextBased?.() || channel.isThread?.()) {
      return interaction.reply({ content: "I can't find a text channel with that ID.", flags: MessageFlags.Ephemeral });
    }

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(['ViewChannel', 'SendMessages', 'AddReactions'])) {
      return interaction.reply({
        content: `I need **View Channel**, **Send Messages** and **Add Reactions** in ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    economy.setCountingChannel(interaction.guildId, channel.id);

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('🔢  Counting is on')
      .setDescription(
        [
          `Counting channel: ${channel}`,
          '',
          '**How it works**',
          '• Type **1** to start, then the next number each time.',
          '• Right number = ✅ and **2 VB**. Wrong number = ❌ and the count carries on.',
          `• Everyone can count once every **${COUNTING.cooldownMs / 3600000} hours**. Too soon = ⏳ and it is not counted.`,
          '• Counting achievements pay VB too. See them with `/achievements`.',
        ].join('\n')
      )
      .setFooter({ text: FOOTER });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle('🔢  Counting starts now')
            .setDescription('Type **1** to begin. Right number = ✅ and 2 VB, once every 5 hours each.')
            .setFooter({ text: FOOTER }),
        ],
      })
      .catch(() => {});
  },
};
