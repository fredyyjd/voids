const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const economy = require('../utils/economy');
const { ACHIEVEMENTS } = require('../utils/achievements');
const { COLOR } = require('../utils/theme');
const { FOOTER } = require('../utils/economyConfig');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('achievements-lb')
    .setDescription('Who has unlocked the most achievements')
    .setDMPermission(false),

  async execute(interaction) {
    const top = economy.topByAchievements(10);

    const lines = top.length
      ? top.map(
          (e, i) =>
            `${MEDALS[i] || `**${i + 1}.**`}  <@${e.id}>  ·  **${e.achievements}** / ${ACHIEVEMENTS.length}`
        )
      : ['Nobody has unlocked an achievement yet.', 'Send a message or count in the counting channel!'];

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('🏆  Achievement Leaderboard')
      .setDescription(['Ranked by achievements unlocked.', '', ...lines].join('\n'))
      .setFooter({ text: FOOTER });

    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
