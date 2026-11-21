const { MessageFlags } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const pingProt = require('../utils/pingProt');

const timers = new Map();

function scheduleSync(guild, delay = 5000) {
  clearTimeout(timers.get(guild.id));
  timers.set(
    guild.id,
    setTimeout(() => {
      timers.delete(guild.id);
      pingProt.syncAutoMod(guild).catch((err) => console.error('[ping prot] sync error:', err));
    }, delay)
  );
}

module.exports = {
  name: 'pingProtPanel',

  register(client) {
    client.once('ready', () => {
      for (const guild of client.guilds.cache.values()) scheduleSync(guild, 10000);
    });

    client.on('guildMemberUpdate', (oldMember, newMember) => {
      try {
        const { roles } = pingProt.getAll();
        if (!roles.length) return;
        const before = oldMember.partial ? null : oldMember.roles.cache;
        const changed = before
          ? roles.some((id) => before.has(id) !== newMember.roles.cache.has(id))
          : roles.some((id) => newMember.roles.cache.has(id));
        if (changed) scheduleSync(newMember.guild);
      } catch (err) {
        console.error('[ping prot] member update error:', err);
      }
    });

    client.on('interactionCreate', async (interaction) => {
      try {
        const id = interaction.customId || '';
        const isPanel =
          (interaction.isUserSelectMenu() && id === 'pprot_add_u') ||
          (interaction.isRoleSelectMenu() && id === 'pprot_add_r') ||
          (interaction.isStringSelectMenu() && id === 'pprot_rm') ||
          (interaction.isButton() && id === 'pprot_clear');
        if (!isPanel) return;

        if (!hasMaxPerms(interaction.member)) {
          return interaction.reply({ content: "You can't use this.", flags: MessageFlags.Ephemeral });
        }

        await interaction.deferUpdate();

        if (id === 'pprot_add_u') {
          for (const userId of interaction.values) pingProt.add('user', userId);
        } else if (id === 'pprot_add_r') {
          for (const roleId of interaction.values) {
            if (roleId !== interaction.guild.id) pingProt.add('role', roleId);
          }
        } else if (id === 'pprot_rm') {
          for (const value of interaction.values) {
            const [kind, targetId] = value.split(':');
            pingProt.remove(kind === 'r' ? 'role' : 'user', targetId);
          }
        } else if (id === 'pprot_clear') {
          const { roles, users } = pingProt.getAll();
          roles.forEach((roleId) => pingProt.remove('role', roleId));
          users.forEach((userId) => pingProt.remove('user', userId));
        }

        const status = await pingProt.syncAutoMod(interaction.guild);
        await interaction.editReply(await pingProt.buildPanel(interaction.guild, status));
      } catch (err) {
        console.error('[ping prot] panel error:', err);
      }
    });
  },
};
