const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const pingProt = require('../utils/pingProt');

const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Ping tools')
  .addSubcommand((sub) => sub.setName('prot').setDescription('Ping protect roles or people'));

module.exports = {
  data,

  async execute(interaction) {
    if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

    const panel = await pingProt.buildPanel(interaction.guild);
    return interaction.reply({ ...panel, flags: MessageFlags.Ephemeral });
  },
};
