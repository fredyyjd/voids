const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
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
    .setName('apply')
    .setDescription('Post the staff application panel'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const apps = config.applications || [];
    if (apps.length === 0) {
      return interaction.reply({ content: 'No applications set up yet.', flags: MessageFlags.Ephemeral });
    }

    const panel = config.applicationsPanel || {};
    const container = new ContainerBuilder().setAccentColor(hexToInt(panel.color));

    // Title
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${panel.title || 'Applications'}`)
    );

    // Requirements heading
    if (panel.requirementsHeading) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(panel.requirementsHeading)
      );
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    );

    // Requirements list
    const requirements = panel.requirements || [];
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        requirements.map((r) => `- ${r}`).join('\n')
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    );

    // Note
    const notes = panel.note || [];
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        ['**Note:**', ...notes].join('\n')
      )
    );

    // Panel image — supports either a normal URL or a local "attachment://filename"
    // reference, in which case the file is pulled from the bot's /assets folder
    // and uploaded fresh each time (Discord CDN links expire, local files don't).
    const files = [];
    if (panel.image) {
      let imageUrl = panel.image;

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
      .setCustomId('application_select')
      .setPlaceholder('Select an application…')
      .addOptions(
        apps.map((app) => ({
          label: app.label,
          description: app.description,
          value: app.id,
          emoji: app.emoji || undefined,
        }))
      );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(menu)
    );

    await interaction.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      files,
    });
    await interaction.reply({ content: '✅ Panel posted.', flags: MessageFlags.Ephemeral });
  },
};
