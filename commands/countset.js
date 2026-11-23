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
    if (!perms?.has(['ViewChannel', 'SendMessages', 'AddReactions', 'ManageMessages'])) {
      return interaction.reply({
        content: `I need **View Channel**, **Send Messages**, **Add Reactions** and **Manage Messages** in ${channel}.`,
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
          '• Start by typing **1**, next person types **2**, and so on.',
          '• Right number = loading, then ✅ and **2 VB**. Wrong number = loading, then ❌.',
          `• **${COUNTING.cooldownMs / 3600000}h cooldown** per user per count. Too soon = loading, then your message is deleted.`,
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
            .setDescription(
              `Start by typing **1**, next person types **2**.\n${COUNTING.cooldownMs / 3600000}h cooldown per user per count.`
            )
            .setFooter({ text: FOOTER }),
        ],
      })
      .catch(() => {});
  },
};
