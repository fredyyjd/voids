const { MessageFlags } = require('discord.js');
const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const {
  setSticky,
  removeSticky,
  updateLastMessageId
} = require('../utils/stickyManager');

const { isAdmin } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Pin a message to the bottom of a channel')
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set the sticky')
        .addStringOption(opt =>
          opt
            .setName('message')
            .setDescription('Sticky text')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove the sticky')
    ),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        content: "You can't use this command.",
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const content = interaction.options.getString('message');

      setSticky(interaction.channel.id, content);

      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setDescription(content)
        .setFooter({ text: '📌 Sticky' })
        .setTimestamp();

      const msg = await interaction.channel.send({
        embeds: [embed]
      });

      updateLastMessageId(interaction.channel.id, msg.id);

      return interaction.reply({
        content: '✅ Sticky set.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'remove') {
      const sticky = removeSticky(interaction.channel.id);

      if (!sticky) {
        return interaction.reply({
          content: 'No sticky in this channel.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (sticky.lastMessageId) {
        const old = await interaction.channel.messages
          .fetch(sticky.lastMessageId)
          .catch(() => null);

        if (old) await old.delete().catch(() => {});
      }

      return interaction.reply({
        content: '✅ Sticky removed.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
