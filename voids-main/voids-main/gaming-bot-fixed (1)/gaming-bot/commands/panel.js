const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const path = require('path');

const config = require('../config.json');
const { isAdmin } = require('../utils/permissions');

function hexToInt(hex) {
  if (!hex) return 0x5865f2;
  return parseInt(hex.replace('#', ''), 16);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the ticket panel'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        content: "You can't use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const container = new ContainerBuilder();

    if (config.panel.title) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${config.panel.title}`)
      );
    }

    const hasLogo = config.logoUrl && !config.logoUrl.startsWith('PUT_');

    // Description, with the server logo shown as a thumbnail beside it when available
    if (hasLogo) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(config.panel.description)
          )
          .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(config.logoUrl)
          )
      );
    } else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(config.panel.description)
      );
    }

    // Panel image — supports either a normal URL or a local "attachment://filename"
    // reference, in which case the file is pulled from the bot's /assets folder
    // and uploaded fresh each time (Discord CDN links in config.json expire).
    const files = [];
    if (config.panel.image) {
      let imageUrl = config.panel.image;

      if (imageUrl.startsWith('attachment://')) {
        const fileName = imageUrl.replace('attachment://', '');
        const filePath = path.join(__dirname, '..', 'assets', fileName);
        files.push(new AttachmentBuilder(filePath, { name: fileName }));
        imageUrl = `attachment://${fileName}`;
      }

      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
      );
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(imageUrl)
        )
      );
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('Select a ticket category…')
      .addOptions(
        config.categories.map((cat) => ({
          label: cat.label,
          description: (cat.description || '').slice(0, 100),
          value: cat.id,
          emoji: cat.emoji || undefined,
        }))
      );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(menu)
    );

    if (config.panel.footer) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${config.panel.footer}`)
      );
    }

    await interaction.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      files,
    });

    await interaction.reply({
      content: '✅ Panel posted.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
