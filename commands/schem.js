const { SlashCommandBuilder } = require('discord.js');
const extra = require('../extraConfig');
const schem = require('../utils/schematics');
const { isAdmin, isMod } = require('../utils/permissions');
const { fail, done, NO_PERMS } = require('../utils/reply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schem')
    .setDescription('Schematic tools')
    .addSubcommand((sub) =>
      sub.setName('panel').setDescription('Post the schematic count + search panel')
    ),

  async execute(interaction) {
    if (!isAdmin(interaction.member) && !isMod(interaction.member)) {
      return fail(interaction, NO_PERMS);
    }

    const countId = extra.schematics.countChannelId;
    const channel =
      (countId && !String(countId).startsWith('PUT_')
        ? await interaction.guild.channels.fetch(countId).catch(() => null)
        : null) || interaction.channel;

    if (!channel || !channel.isTextBased()) {
      return fail(interaction, "I can't find the schematic count channel.");
    }

    // Replace the old panel so there is only ever one auto-updating panel.
    const old = schem.getPanelRef();
    if (old) {
      const oldChannel = await interaction.client.channels.fetch(old.channelId).catch(() => null);
      const oldMessage = oldChannel ? await oldChannel.messages.fetch(old.messageId).catch(() => null) : null;
      if (oldMessage) await oldMessage.delete().catch(() => {});
    }

    const sent = await channel.send(schem.buildPanelMessage()).catch((err) => {
      console.error('[schematics] could not post the panel:', err);
      return null;
    });

    if (!sent) return fail(interaction, "Couldn't post the panel. Check I can send messages + embeds there.");

    schem.setPanelRef({ channelId: channel.id, messageId: sent.id });
    return done(interaction, `Schematic panel posted in ${channel}.`);
  },
};
