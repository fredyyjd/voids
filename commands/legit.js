const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const { fail, done, NO_PERMS } = require('../utils/reply');
const legit = require('../utils/legitPanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('legit')
    .setDescription('Are we legit tools')
    .addSubcommand((s) => s.setName('panel').setDescription('Post the "Are we legit?" panel')),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) return fail(interaction, NO_PERMS);

    try {
      const msg = await interaction.channel.send({ embeds: [legit.buildPanelEmbed()] });

      // yes first, then no
      await msg.react(`${legit.YES_EMOJI.name}:${legit.YES_EMOJI.id}`);
      await msg.react(`${legit.NO_EMOJI.name}:${legit.NO_EMOJI.id}`);

      const data = legit.load();
      data[msg.id] = { channelId: msg.channelId, guildId: interaction.guildId };
      legit.save(data);

      return done(interaction, 'Panel posted.');
    } catch (err) {
      console.error('[legit] could not post panel:', err);
      return fail(interaction, "I couldn't post it. Check I can send messages, add reactions and use external emojis there.");
    }
  },
};
