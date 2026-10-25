const { MessageFlags } = require('discord.js');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(
  __dirname,
  '..',
  'data',
  'honeypots.json'
);

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {};
    }

    return JSON.parse(
      fs.readFileSync(DATA_FILE, 'utf8')
    );
  } catch (error) {
    console.error(
      '[HONEYPOT] Failed to load data:',
      error
    );

    return {};
  }
}

function saveData(data) {
  try {
    const directory = path.dirname(DATA_FILE);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, {
        recursive: true,
      });
    }

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error(
      '[HONEYPOT] Failed to save data:',
      error
    );
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('honeypot')
    .setDescription('Set up a honeypot channel')

    .addStringOption(option =>
      option
        .setName('description')
        .setDescription(
          'Honeypot text'
        )
        .setRequired(false)
        .setMaxLength(4096)
    )

    .addStringOption(option =>
      option
        .setName('button_name')
        .setDescription(
          'Counter label'
        )
        .setRequired(false)
        .setMaxLength(60)
    )

    .addStringOption(option =>
      option
        .setName('button_emoji')
        .setDescription(
          'Counter emoji'
        )
        .setRequired(false)
        .setMaxLength(100)
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageChannels
    ),

  async execute(interaction) {
    const description =
      interaction.options.getString(
        'description'
      ) ||
      'This channel is a honeypot. Anyone who sends a message here will be automatically kicked.';

    const buttonName =
      interaction.options.getString(
        'button_name'
      ) ||
      'Kicks';

    const buttonEmoji =
      interaction.options.getString(
        'button_emoji'
      ) ||
      '🍯';

    const data = loadData();

    data[interaction.channel.id] = {
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      messageId: null,
      kicks: 0,
      description,
      buttonName,
      buttonEmoji,
    };

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('🍯 Honeypot')
      .setDescription(description)
      .setFooter({
        text:
          'Sending a message in this channel will result in a kick.',
      });

    /*
      Disabled button:
      - Shows the kick count
      - Cannot be clicked
      - Emoji can be customised
    */
    const button = new ButtonBuilder()
      .setCustomId(
        `honeypot_counter_${interaction.channel.id}`
      )
      .setLabel('Kicks: 0')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(buttonEmoji)
      .setDisabled(true);

    const row = new ActionRowBuilder()
      .addComponents(button);

    const message =
      await interaction.channel.send({
        embeds: [embed],
        components: [row],
      });

    data[interaction.channel.id].messageId =
      message.id;

    saveData(data);

    await interaction.reply({
      content:
        '✅ Honeypot is live.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
