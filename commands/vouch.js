const {
  MessageFlags,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { COLOR } = require('../utils/theme');
const tracker = require('../utils/vouchTracker');
const { isAdmin } = require('../utils/permissions');

const PER_PAGE = 8;
const MEDALS = ['🥇', '🥈', '🥉'];

const plural = (n) => `${n} vouch${n === 1 ? '' : 'es'}`;

function leaderboardEmbed() {
  const top = tracker.leaderboard().slice(0, 10);

  if (!top.length) {
    return new EmbedBuilder().setColor(COLOR).setTitle('Vouch Leaderboard').setDescription('No vouches yet.');
  }

  const lines = top.map(
    (row, i) => `${MEDALS[i] || `**${i + 1}.**`} <@${row.userId}> - **${plural(row.count)}**`
  );

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Vouch Leaderboard')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${tracker.totalVouches()} vouches in total` });
}

function seeEmbed(user, vouches, page) {
  const pages = Math.max(1, Math.ceil(vouches.length / PER_PAGE));
  const slice = vouches.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  const lines = slice.map((v) => {
    const url = tracker.messageUrl(v);
    const when = `<t:${Math.floor(v.ts / 1000)}:R>`;
    const head = `<@${v.voucherId}> - ${url ? `[${when}](${url})` : when}`;
    const comment = v.comment ? `\n> ${v.comment.replace(/\n+/g, ' ').slice(0, 200)}` : '';
    return head + comment;
  });

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`Vouches for ${user.username}`)
    .setThumbnail(user.displayAvatarURL())
    .setDescription(`<@${user.id}> has **${plural(vouches.length)}**\n\n${lines.join('\n\n')}`)
    .setFooter({ text: `Page ${page + 1}/${pages}` });
}

function pageRow(page, pages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vouchsee_prev')
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page === 0),
    new ButtonBuilder()
      .setCustomId('vouchsee_next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= pages - 1)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vouch')
    .setDescription('Vouches')
    .addSubcommand((s) => s.setName('lb').setDescription('Who has the most vouches'))
    .addSubcommand((s) => s.setName('scan').setDescription('Re-scan the vouch channels (admin)'))
    .addSubcommand((s) =>
      s
        .setName('see')
        .setDescription("See someone's vouches")
        .addUserOption((o) => o.setName('user').setDescription('Who to look up').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    /* ---------- lb ---------- */
    if (sub === 'lb') {
      return interaction.reply({ embeds: [leaderboardEmbed()] });
    }

    /* ---------- scan ---------- */
    if (sub === 'scan') {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const result = await tracker.scanAll(interaction.client, { full: true });

      if (!result) return interaction.editReply('A scan is already running, try again in a bit.');

      return interaction.editReply(
        `Scanned both channels. **${result.added}** new vouches added` +
          (result.skipped ? `, ${result.skipped} ignored (self vouches / too fast).` : '.')
      );
    }

    /* ---------- see ---------- */
    const user = interaction.options.getUser('user');
    const vouches = tracker.vouchesFor(user.id); // newest first

    if (!vouches.length) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle(`Vouches for ${user.username}`)
            .setDescription(`<@${user.id}> has no vouches yet.`),
        ],
      });
    }

    const pages = Math.ceil(vouches.length / PER_PAGE);
    let page = 0;

    const payload = (disabled = false) => ({
      embeds: [seeEmbed(user, vouches, page)],
      components: pages > 1 ? [pageRow(page, pages, disabled)] : [],
    });

    const reply = await interaction.reply({ ...payload(), fetchReply: true });
    if (pages <= 1) return;

    const collector = reply.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 5 * 60 * 1000,
    });

    collector.on('collect', async (i) => {
      page += i.customId === 'vouchsee_next' ? 1 : -1;
      page = Math.min(Math.max(page, 0), pages - 1);
      await i.update(payload()).catch(() => {});
    });

    collector.on('end', () => {
      interaction.editReply(payload(true)).catch(() => {});
    });
  },
};
