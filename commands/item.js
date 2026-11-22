const { SlashCommandBuilder } = require('discord.js');
const { shopPayload } = require('../utils/shop');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const { prizeChoices, buildModal } = require('../utils/shopGiveawayFlow');
const economy = require('../utils/economy');
const { ITEMS, FOOTER } = require('../utils/economyConfig');
const { box, priv } = require('../utils/box');

const MAX_VB = 100;
const MAX_ENTRIES = 10;

const GIVE_CHOICES = [
  { name: '💰 VB (Void Bucks)', value: 'vb' },
  ...Object.entries(ITEMS).map(([key, item]) => ({
    name: item.type === 'colour' ? `${item.emoji} ${item.name} colour` : `${item.emoji} ${item.name}`,
    value: key,
  })),
];

const no = (text) => priv(box(`❌ ${text}`));

async function give(interaction) {
  if (!hasMaxPerms(interaction.member)) return interaction.reply(no("You can't use this command."));

  const target = interaction.options.getUser('user');
  const key = interaction.options.getString('item');
  const amount = interaction.options.getInteger('amount') ?? 1;

  if (target.bot) return interaction.reply(no("You can't give things to a bot."));

  let given;
  let tip;

  if (key === 'vb') {
    if (amount < 1 || amount > MAX_VB) return interaction.reply(no(`You can give ${MAX_VB} VB at most per command.`));

    economy.addVb(target.id, amount);
    given = `**${economy.fmt(amount)}**`;
    tip = `New balance: **${economy.fmt(economy.peek(target.id).vb)}**`;
  } else {
    const item = ITEMS[key];
    if (!item) return interaction.reply(no('That item is not in the shop any more.'));

    if (item.type === 'entry') {
      if (amount < 1 || amount > MAX_ENTRIES) {
        return interaction.reply(no(`You can give ${MAX_ENTRIES} entries at most per command.`));
      }

      economy.addExtra(target.id, amount);
      given = `**${amount}× ${item.emoji} ${item.name}**`;
      tip = 'They use it by pressing **Join** again on a giveaway they are in.';
    } else if (item.type === 'colour') {
      const owner = economy.user(target.id);
      if (owner.colours.includes(key)) {
        return interaction.reply(no(`${target} already owns the ${item.emoji} ${item.name} colour.`));
      }

      owner.colours.push(key);
      economy.touch();
      given = `the **${item.emoji} ${item.name}** name colour`;
      tip = 'They can wear it from `/inv`.';
    } else {
      return interaction.reply(no("That item can't be given yet."));
    }
  }

  return interaction.reply({
    ...box(['## 🎁  Gift sent', `${interaction.user} gave ${target} ${given}.`, `${tip}\n-# ${FOOTER}`]),
    allowedMentions: { users: [target.id] },
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('item')
    .setDescription('Spend your VB')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('shop').setDescription('Open the item shop'))
    .addSubcommand((sub) =>
      sub
        .setName('give')
        .setDescription('Give someone VB, a colour or extra giveaway entries (max perms only)')
        .addUserOption((o) => o.setName('user').setDescription('Who gets it').setRequired(true))
        .addStringOption((o) =>
          o.setName('item').setDescription('What to give').setRequired(true).addChoices(...GIVE_CHOICES)
        )
        .addIntegerOption((o) =>
          o
            .setName('amount')
            .setDescription(`How many (VB max ${MAX_VB}, entries max ${MAX_ENTRIES}). Default 1`)
            .setMinValue(1)
            .setMaxValue(MAX_VB)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('giveaway')
        .setDescription('Giveaway VB (Void Bucks) or shop items (max perms only)')
        .addStringOption((o) =>
          o
            .setName('prize')
            .setDescription('What the winners get')
            .setRequired(true)
            .addChoices(...prizeChoices())
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'give') return give(interaction);

    if (sub === 'giveaway') {
      if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

      return interaction.showModal(buildModal(interaction.options.getString('prize')));
    }

    return interaction.reply(shopPayload());
  },
};
