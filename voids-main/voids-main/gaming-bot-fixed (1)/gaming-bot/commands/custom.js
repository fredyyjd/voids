const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DEV_ROLE_ID = '1539513728972628058';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('custom')
    .setDescription('Post a custom ticket panel')
    .addStringOption((option) => option.setName('description').setDescription('Panel text').setRequired(true).setMaxLength(4096))
    .addStringOption((option) => option.setName('title').setDescription('Panel title').setRequired(false).setMaxLength(256)),

  async execute(interaction) {
    const description = interaction.options.getString('description');
    const title = interaction.options.getString('title');
    const role = await interaction.guild.roles.fetch(DEV_ROLE_ID).catch(() => null);

    if (!role) {
      return interaction.reply({ content: "Couldn't find the dev role.", flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setDescription(description)
      .setColor('#2b2d31');

    if (title) embed.setTitle(title);

    const button = new ButtonBuilder()
      .setCustomId(`custom_ticket_create:${DEV_ROLE_ID}`)
      .setLabel('Create a Ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.channel.send({ embeds: [embed], components: [row] });

    await interaction.reply({
      content: `✅ Panel posted. ${role} handles these tickets.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
