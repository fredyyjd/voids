const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const economy = require('../utils/economy');
const { balanceEmbed } = require('../utils/shop');
const {
  loadGiveaways,
  saveGiveaways,
  parseDuration,
  buildGiveawayEmbed,
  buildJoinRow,
  scheduleGiveaway,
} = require('../utils/giveawayManager');

const DAY = 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vb')
    .setDescription('Void Bucks (VB)')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('giveaway')
        .setDescription('Giveaway VB (max perms only)')
        .addStringOption((o) => o.setName('duration').setDescription('How long it runs, e.g. 30m, 2h, 1d').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('amount').setDescription('How much VB each winner gets').setRequired(true).setMinValue(1).setMaxValue(100000)
        )
        .addIntegerOption((o) => o.setName('winners').setDescription('How many winners (default 1)').setMinValue(1).setMaxValue(10))
    )
    .addSubcommand((sub) =>
      sub
        .setName('balance')
        .setDescription('Check your VB or someone else\'s')
        .addUserOption((o) => o.setName('user').setDescription('Whose VB to check (default you)'))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'balance') {
      const target = interaction.options.getUser('user') || interaction.user;
      const member = interaction.guild.members.cache.get(target.id);
      return interaction.reply({ embeds: [balanceEmbed(target, member)], flags: MessageFlags.Ephemeral });
    }

    if (!hasMaxPerms(interaction.member)) {
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const ms = parseDuration(interaction.options.getString('duration'));
    const amount = interaction.options.getInteger('amount');
    const winners = interaction.options.getInteger('winners') || 1;

    if (!ms) return interaction.reply({ content: 'Use a duration like `30m`, `2h` or `1d`.', flags: MessageFlags.Ephemeral });
    if (ms < 10 * 1000) return interaction.reply({ content: 'Giveaways must run for at least 10 seconds.', flags: MessageFlags.Ephemeral });
    if (ms > 30 * DAY) return interaction.reply({ content: 'Giveaways can run for 30 days at most.', flags: MessageFlags.Ephemeral });

    const giveaway = {
      type: 'vb',
      prize: economy.fmt(amount),
      vbAmount: amount,
      description: [
        '**VB** = Void Bucks. Void Bucks can get you items in the item shop (`/item shop`).',
        '',
        '• You can buy cool roles and name colours',
        '• You can buy extra giveaway entries',
        '• More will be added soon!',
        '',
        'You can earn VB by being active in chats, earning achievements in counting or in general in the server!',
      ].join('\n'),
      winnerCount: winners,
      claimMs: null,
      startedAt: Date.now(),
      endTimestamp: Date.now() + ms,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      hostId: interaction.user.id,
      hostName: interaction.member?.displayName || interaction.user.username,
      hostAvatar: interaction.user.displayAvatarURL(),
      entrants: [],
      extra: [],
      ended: false,
    };

    const message = await interaction.channel.send({
      embeds: [buildGiveawayEmbed(giveaway)],
      components: [buildJoinRow(0)],
    });

    const giveaways = loadGiveaways();
    giveaways[message.id] = giveaway;
    saveGiveaways(giveaways);
    scheduleGiveaway(interaction.client, message.id, ms);

    return interaction.reply({
      content: `VB giveaway started in ${interaction.channel}. Winners get ${economy.fmt(amount)} automatically when it ends.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
