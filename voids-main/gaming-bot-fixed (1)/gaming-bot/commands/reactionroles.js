const { MessageFlags } = require('discord.js');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const config = require('../config.json');
const { isAdmin } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Post the reaction roles panel'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const rr = config.reactionRoles;
    if (!rr || !rr.roles || rr.roles.length === 0) {
      return interaction.reply({ content: 'No reaction roles set up yet.', flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setTitle(rr.title || '🎭 Get Your Roles')
      .setDescription(rr.description || 'Click a button below to add or remove that role.')
      .setColor(rr.color || '#2b2d31');

    const rows = [];
    for (let i = 0; i < rr.roles.length; i += 5) {
      const chunk = rr.roles.slice(i, i + 5);
      const row = new ActionRowBuilder().addComponents(
        chunk.map((r) =>
          new ButtonBuilder()
            .setCustomId(`rr_${r.roleId}`)
            .setLabel(r.label)
            .setEmoji(r.emoji || undefined)
            .setStyle(ButtonStyle.Secondary)
        )
      );
      rows.push(row);
    }

    await interaction.channel.send({ embeds: [embed], components: rows });
    await interaction.reply({ content: '✅ Panel posted.', flags: MessageFlags.Ephemeral });
  },
};
