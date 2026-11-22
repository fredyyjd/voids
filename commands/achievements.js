const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const economy = require('../utils/economy');
const { ACHIEVEMENTS } = require('../utils/achievements');
const { COLOR } = require('../utils/theme');
const { ACHIEVEMENT_REWARD, FOOTER } = require('../utils/economyConfig');

function section(group, u) {
  return ACHIEVEMENTS.filter((a) => a.group === group)
    .map((a) => {
      const at = u.ach[a.key];
      return at
        ? `✅  **${a.name}**  ·  <t:${Math.floor(at / 1000)}:d>\n-# ${a.desc}`
        : `🔒  **${a.name}**\n-# ${a.desc}`;
    })
    .join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('See your achievements or someone else\'s')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Whose achievements to see (default you)')),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    if (target.bot) return interaction.reply({ content: 'Bots do not earn achievements.', flags: MessageFlags.Ephemeral });

    const u = economy.peek(target.id);
    const done = Object.keys(u.ach).filter((k) => ACHIEVEMENTS.some((a) => a.key === k)).length;
    const member = interaction.guild.members.cache.get(target.id);

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setAuthor({ name: `${member?.displayName || target.username}'s Achievements`, iconURL: target.displayAvatarURL() })
      .setDescription(
        [
          `**${done}** of **${ACHIEVEMENTS.length}** unlocked  ·  **${u.msgs.toLocaleString('en-US')}** messages  ·  **${u.counts.toLocaleString('en-US')}** counts`,
          `Every achievement pays **${economy.fmt(ACHIEVEMENT_REWARD)}**.`,
          '\u200b',
        ].join('\n')
      )
      .addFields(
        { name: '💬  Chat', value: section('Chat', u) },
        { name: '\u200b', value: '\u200b' },
        { name: '🔢  Counting', value: section('Counting', u) }
      )
      .setFooter({ text: FOOTER });

    return interaction.reply({ embeds: [embed] });
  },
};
