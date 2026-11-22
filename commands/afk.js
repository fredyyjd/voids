const { SlashCommandBuilder } = require('discord.js');
const { box, priv } = require('../utils/box');
const { setAfk } = require('../utils/afkManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Go afk. Pings get an afk notice until you type again')
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Why you are afk').setMaxLength(100).setRequired(false)
    ),

  async execute(interaction) {
    const reason = interaction.options.getString('reason') || 'no reason given';

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      return interaction.reply(priv(box("❌ Couldn't find you in this server.")));
    }

    await setAfk(member, reason);

    await interaction.reply({
      ...box([`<@${interaction.user.id}> is now afk`, `Reason: ${reason}`]),
      allowedMentions: { parse: [] },
    });
  },
};
