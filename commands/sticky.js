const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  setSticky,
  removeSticky,
  getSticky,
  updateLastMessageId,
  buildStickyEmbed,
} = require('../utils/stickyManager');
const { isAdmin } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Pin a message to the bottom of a channel')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set the sticky')
        .addStringOption((opt) =>
          opt.setName('message').setDescription('Sticky text (use \\n for a new line)').setRequired(true).setMaxLength(4000)
        )
    )
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove the sticky')),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.channel;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const content = interaction.options.getString('message').replace(/\\n/g, '\n');

      // Replace the old sticky instead of leaving it behind.
      const previous = getSticky(channel.id);
      if (previous?.lastMessageId) {
        await channel.messages.delete(previous.lastMessageId).catch(() => {});
      }

      setSticky(channel.id, content);

      const msg = await channel.send({ embeds: [buildStickyEmbed(content)] });
      updateLastMessageId(channel.id, msg.id);

      return interaction.reply({ content: '✅ Sticky set.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'remove') {
      const sticky = removeSticky(channel.id);

      if (!sticky) {
        return interaction.reply({ content: 'No sticky in this channel.', flags: MessageFlags.Ephemeral });
      }

      if (sticky.lastMessageId) {
        await channel.messages.delete(sticky.lastMessageId).catch(() => {});
      }

      return interaction.reply({ content: '✅ Sticky removed.', flags: MessageFlags.Ephemeral });
    }
  },
};
