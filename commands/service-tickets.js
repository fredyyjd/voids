const { MessageFlags } = require('discord.js');
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('services')
    .setDescription('Post the services panel'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const categories = config.serviceCategories || [];
    if (!categories.length) {
      return interaction.reply({ content: 'No services set up yet.', flags: MessageFlags.Ephemeral });
    }

    // Plain text message (not an embed): the panel text, then the footer line.
    const text = config.servicePanel?.description || 'Pick a service to open a ticket.';
    const footer = config.servicePanel?.footer || 'Voids Services';
    const content = `${text}\n\n-# ${footer}`.slice(0, 2000);

    const menu = new StringSelectMenuBuilder()
      .setCustomId('service_ticket_category_select')
      .setPlaceholder('Select a service...')
      .addOptions(
        categories.slice(0, 25).map((cat) => ({
          label: String(cat.label || cat.id).slice(0, 100),
          description: String(cat.description || 'Open a service ticket').slice(0, 100),
          value: String(cat.id),
          emoji: cat.emoji || undefined,
        }))
      );

    await interaction.channel.send({
      content,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    await interaction.reply({ content: 'Panel posted.', flags: MessageFlags.Ephemeral });
  },
};
