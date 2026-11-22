const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const extra = require('../extraConfig');
const { hasMaxPerms } = require('./permissions');
const { fail, NO_PERMS } = require('./reply');
const { COLOR } = require('./theme');

const staffRoleId = () => {
  const id = extra.staffManagement?.baseRoleId;
  return typeof id === 'string' && /^\d{15,25}$/.test(id) ? id : null;
};

// /staff announce: opens the form (max perms only).
async function openForm(interaction) {
  if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

  const modal = new ModalBuilder()
    .setCustomId(`staff_announce:${interaction.channelId}`)
    .setTitle('Staff announcement')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Title (optional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Announcement')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(3500)
      )
    );

  return interaction.showModal(modal);
}

// Form submitted: @staff, then an embed with what was written.
async function submit(interaction) {
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (!hasMaxPerms(interaction.member)) return reply("❌ You can't use this command.");

  const channelId = interaction.customId.split(':')[1];
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return reply("❌ I couldn't find that channel.");

  const title = interaction.fields.getTextInputValue('title').trim();
  const message = interaction.fields.getTextInputValue('message').trim();
  if (!message) return reply('❌ Write an announcement first.');

  const embed = new EmbedBuilder()
    .setTitle(title || 'Staff Announcement')
    .setDescription(message)
    .setColor(COLOR)
    .setFooter({
      text: `Announced by ${interaction.member?.displayName || interaction.user.username}`,
      iconURL: interaction.user.displayAvatarURL(),
    })
    .setTimestamp();

  const role = staffRoleId();
  const sent = await channel
    .send({
      content: role ? `<@&${role}>` : undefined,
      embeds: [embed],
      allowedMentions: { roles: role ? [role] : [] },
    })
    .catch((err) => {
      console.error('[staff announce] send failed:', err.message);
      return null;
    });

  if (!sent) return reply("❌ I couldn't send it, check my permissions in that channel.");
  return reply('✅ Announcement sent.');
}

module.exports = { openForm, submit };
