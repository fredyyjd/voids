const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const pingProt = require('../utils/pingProt');

const ROLE_OPTIONS = ['role', 'role2', 'role3'];
const USER_OPTIONS = ['user', 'user2', 'user3', 'user4', 'user5'];

const data = new SlashCommandBuilder().setName('ping').setDescription('Ping tools');

data.addSubcommand((sub) => {
  sub.setName('prot').setDescription('Ping protect roles or people');
  ROLE_OPTIONS.forEach((name) => sub.addRoleOption((o) => o.setName(name).setDescription('Role to protect')));
  USER_OPTIONS.forEach((name) => sub.addUserOption((o) => o.setName(name).setDescription('Person to protect')));
  return sub;
});

module.exports = {
  data,

  async execute(interaction) {
    if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

    for (const name of ROLE_OPTIONS) {
      const role = interaction.options.getRole(name);
      if (role && role.id !== interaction.guild.id) pingProt.add('role', role.id);
    }
    for (const name of USER_OPTIONS) {
      const user = interaction.options.getUser(name);
      if (user) pingProt.add('user', user.id);
    }

    const panel = await pingProt.buildPanel(interaction.guild);
    return interaction.reply({ ...panel, flags: MessageFlags.Ephemeral });
  },
};
