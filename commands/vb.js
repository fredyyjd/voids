const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { balanceEmbed } = require('../utils/shop');

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
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild.members.cache.get(target.id);
    return interaction.reply({ embeds: [balanceEmbed(target, member)], flags: MessageFlags.Ephemeral });
  },
};
