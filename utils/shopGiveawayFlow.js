const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const { hasMaxPerms } = require('./permissions');
const { fail, done, NO_PERMS } = require('./reply');
const { box, priv } = require('./box');
const economy = require('./economy');
const { ITEMS } = require('./economyConfig');
const {
  loadGiveaways,
  saveGiveaways,
  parseDuration,
  buildGiveawayEmbed,
  buildJoinRow,
  scheduleGiveaway,
  grantShopItem,
  buildPickContent,
  buildPickRow,
  itemLabel,
} = require('./giveawayManager');

const DAY = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 10;

const VB_DESCRIPTION = [
  '**VB** = Void Bucks. Void Bucks can get you items in the item shop (`/item shop`).',
  '',
  '• You can buy cool roles and name colours',
  '• You can buy extra giveaway entries',
  '• More will be added soon!',
  '',
  'You can earn VB by being active in chats, earning achievements in counting or in general in the server!',
].join('\n');

const prizeChoices = () => [
  { name: "Winner's choice (anything in the shop)", value: 'choice' },
  { name: 'VB (Void Bucks)', value: 'vb' },
  ...Object.entries(ITEMS).map(([key, item]) => ({
    name: item.type === 'colour' ? `${item.emoji} ${item.name} colour` : `${item.emoji} ${item.name}`,
    value: key,
  })),
];

const input = (id, label, placeholder, required, style = TextInputStyle.Short) =>
  new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setPlaceholder(placeholder)
      .setStyle(style)
      .setRequired(required)
  );

const needsAmount = (key) => key === 'vb' || ITEMS[key]?.type === 'entry';

function buildModal(key) {
  const rows = [
    input('duration', 'Duration', 'e.g. 30m, 2h, 1d', true),
    input('winners', 'Number of Winners', 'Default 1, max 10', false),
  ];

  if (key === 'vb') rows.push(input('amount', 'VB each winner gets', 'e.g. 50', true));
  else if (needsAmount(key)) rows.push(input('amount', 'Extra entries each winner gets', `1 to ${MAX_ENTRIES}`, true));

  rows.push(input('description', 'Description (optional)', 'Leave empty for the default text', false, TextInputStyle.Paragraph));

  return new ModalBuilder().setCustomId(`shopgw_start:${key}`).setTitle('Economy Giveaway').addComponents(...rows);
}

function describePrize(key, amount) {
  if (key === 'choice') return "Winner's choice from the shop";
  if (key === 'vb') return economy.fmt(amount);

  const item = ITEMS[key];
  if (item.type === 'colour') return `${item.emoji} ${item.name} name colour`;
  return amount > 1 ? `${amount}× ${item.emoji} ${item.name}` : `${item.emoji} ${item.name}`;
}

function defaultDescription(key) {
  if (key === 'vb') return VB_DESCRIPTION;
  if (key === 'choice') {
    return 'Every winner picks any item they like from the item shop. It goes straight into their inventory, no ticket needed.';
  }
  return 'Winners get this automatically when the giveaway ends. No ticket needed.';
}

async function handleModal(interaction) {
  if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

  const key = interaction.customId.slice('shopgw_start:'.length);
  const item = ITEMS[key];

  if (key !== 'vb' && key !== 'choice' && !item) return fail(interaction, 'That item is not in the shop any more.');

  const ms = parseDuration(interaction.fields.getTextInputValue('duration'));
  if (!ms) return fail(interaction, 'Use a duration like `30m`, `2h` or `1d`.');
  if (ms < 10 * 1000) return fail(interaction, 'Giveaways must run for at least 10 seconds.');
  if (ms > 30 * DAY) return fail(interaction, 'Giveaways can run for 30 days at most.');

  const winnersRaw = interaction.fields.getTextInputValue('winners').trim();
  const winners = winnersRaw ? Number(winnersRaw) : 1;
  if (!Number.isInteger(winners) || winners < 1 || winners > 10) {
    return fail(interaction, 'Winners must be a number from 1 to 10.');
  }

  let amount = 1;
  if (needsAmount(key)) {
    amount = Number(interaction.fields.getTextInputValue('amount').trim());
    const max = key === 'vb' ? 100000 : MAX_ENTRIES;

    if (!Number.isInteger(amount) || amount < 1 || amount > max) {
      return fail(interaction, `The amount must be a whole number from 1 to ${max.toLocaleString('en-US')}.`);
    }
  }

  const description = interaction.fields.getTextInputValue('description').trim() || defaultDescription(key);

  const giveaway = {
    type: key === 'vb' ? 'vb' : 'shop',
    prize: describePrize(key, amount),
    description,
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

  if (key === 'vb') giveaway.vbAmount = amount;
  else if (key === 'choice') giveaway.prizeKind = 'choice';
  else {
    giveaway.prizeKind = 'item';
    giveaway.itemKey = key;
    giveaway.amount = amount;
  }

  const message = await interaction.channel.send({
    embeds: [buildGiveawayEmbed(giveaway)],
    components: [buildJoinRow(0)],
  });

  const giveaways = loadGiveaways();
  giveaways[message.id] = giveaway;
  saveGiveaways(giveaways);
  scheduleGiveaway(interaction.client, message.id, ms);

  return done(interaction, `Economy giveaway started in ${interaction.channel}. Winners get it automatically when it ends.`);
}

async function handlePick(interaction) {
  const messageId = interaction.customId.slice('shopgw_pick_'.length);
  const giveaways = loadGiveaways();
  const giveaway = giveaways[messageId];
  const userId = interaction.user.id;

  if (!giveaway || giveaway.type !== 'shop' || giveaway.prizeKind !== 'choice') {
    return fail(interaction, 'This giveaway is not available any more.');
  }

  if (!(giveaway.winners || []).includes(userId)) {
    return fail(interaction, 'Only the winners can pick from this giveaway.');
  }

  giveaway.picks = giveaway.picks || {};
  if (giveaway.picks[userId]) return fail(interaction, 'You already picked your item.');

  const key = interaction.values[0];
  const item = ITEMS[key];
  if (!item) return fail(interaction, 'That item is not in the shop any more.');

  if (item.type === 'colour' && economy.peek(userId).colours.includes(key)) {
    return fail(interaction, `You already own the ${item.name} colour. Pick something else.`);
  }

  const result = grantShopItem(userId, key, 1);
  if (!result.ok) return fail(interaction, "That item can't be given yet.");

  giveaway.picks[userId] = key;
  saveGiveaways(giveaways);

  const allPicked = giveaway.winners.every((id) => giveaway.picks[id]);

  await interaction.update({
    content: buildPickContent(giveaway),
    components: allPicked ? [] : [buildPickRow(messageId)],
    allowedMentions: { parse: [] },
  });

  const tip =
    item.type === 'colour'
      ? 'Wear it from `/inv`.'
      : 'Press Join again on a giveaway you are in to use it.';

  return interaction.followUp(priv(box(`✅ You got **${itemLabel(key)}**. ${tip}`)));
}

module.exports = { prizeChoices, buildModal, handleModal, handlePick };
