const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const config = require('../config.json');
const { isMod } = require('../utils/permissions');
const { logModAction } = require('../utils/modLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute or unmute a member')
    .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    if (!isMod(interaction.member)) {
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const mutedRoleId = config.mutedRoleId;
    if (!mutedRoleId || mutedRoleId.startsWith('PUT_')) {
      return interaction.reply({ content: 'The muted role isn\'t set up.', flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: 'That member isn\'t in the server.', flags: MessageFlags.Ephemeral });
    }

    const alreadyMuted = member.roles.cache.has(mutedRoleId);

    if (alreadyMuted) {
      await member.roles.remove(mutedRoleId).catch(() => {});
      await interaction.reply(`🔊 ${target} was unmuted.`);
      await logModAction(interaction.guild, { action: 'Unmute', moderator: interaction.user, target, reason });
    } else {
      await member.roles.add(mutedRoleId).catch(() => {});
      await interaction.reply(`🔇 ${target} was muted.`);
      await logModAction(interaction.guild, { action: 'Mute', moderator: interaction.user, target, reason });
    }
  },
};
