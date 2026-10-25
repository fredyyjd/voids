const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} = require('discord.js');

const { COLOR } = require('./theme');
const { isMod } = require('./permissions');
const { isEventManager } = require('./eventPerms');
const { done, fail, NO_PERMS } = require('./reply');
const { createTicket, getTicketLimitMessage } = require('./ticketManager');
const { addGiveawayPrize } = require('./giveawayTotal');
const {
  loadGiveaways,
  saveGiveaways,
  parseDuration,
  buildGiveawayEmbed,
  buildJoinRow,
  buildChoicePayload,
  resolveSplitSteal,
  refreshClaimButton,
  scheduleGiveaway,
} = require('./giveawayManager');

const DAY = 24 * 60 * 60 * 1000;
const MAX_WINNERS = 50;

/* =========================================================
   /giveaway start FORM

   Giveaway       -> Duration, Number of Winners, Prize, Description
   Split or Steal -> Duration, Prize, Description (always 2 players)
========================================================= */

function buildStartModal(type) {
  const splitSteal = type === 'splitsteal';

  const input = (id, label, { value, placeholder, maxLength = 200 } = {}) => {
    const field = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(maxLength);

    if (value) field.setValue(value);
    if (placeholder) field.setPlaceholder(placeholder);

    return new ActionRowBuilder().addComponents(field);
  };

  const rows = [
    input('duration', 'Duration', { placeholder: 'Ex: 10 minutes', maxLength: 50 }),
  ];

  if (!splitSteal) {
    rows.push(input('winners', 'Number of Winners', { value: '1', maxLength: 3 }));
  }

  rows.push(input('prize', 'Prize'));

  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
  rows.push(new ActionRowBuilder().addComponents(description));

  return new ModalBuilder()
    .setCustomId(`gwstart_${splitSteal ? 'splitsteal' : 'giveaway'}`)
    .setTitle(splitSteal ? 'Start Split or Steal' : 'Start Giveaway')
    .addComponents(...rows);
}

async function handleStartModal(interaction) {
  // Event managers can start giveaways from the /event dropdown too.
  if (!isMod(interaction.member) && !isEventManager(interaction.member)) return fail(interaction, NO_PERMS);

  const splitSteal = interaction.customId === 'gwstart_splitsteal';

  const ms = parseDuration(interaction.fields.getTextInputValue('duration'));
  const prize = interaction.fields.getTextInputValue('prize').trim();
  const description = (interaction.fields.getTextInputValue('description') || '').trim();

  let winnerCount = 2;
  if (!splitSteal) {
    winnerCount = parseInt(interaction.fields.getTextInputValue('winners'), 10);
    if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > MAX_WINNERS) {
      return fail(interaction, `Number of winners must be between 1 and ${MAX_WINNERS}.`);
    }
  }

  if (!ms) return fail(interaction, 'Use a duration like `10 minutes`, `30m`, `1h` or `2d`.');
  if (ms < 10 * 1000) return fail(interaction, 'Giveaways must run for at least 10 seconds.');
  if (ms > 30 * DAY) return fail(interaction, 'Giveaways can run for 30 days at most.');
  if (!prize) return fail(interaction, 'You need to enter a prize.');

  const channel =
    interaction.channel || (await interaction.client.channels.fetch(interaction.channelId));

  const giveaway = {
    type: splitSteal ? 'splitsteal' : 'giveaway',
    prize,
    description: description || null,
    winnerCount,
    endTimestamp: Date.now() + ms,
    channelId: channel.id,
    guildId: interaction.guildId,
    hostId: interaction.user.id,
    hostName: interaction.member?.displayName || interaction.user.username,
    hostAvatar: interaction.user.displayAvatarURL(),
    entrants: [],
    ended: false,
  };

  const message = await channel.send({
    embeds: [buildGiveawayEmbed(giveaway)],
    components: [buildJoinRow(0)],
  });

  const giveaways = loadGiveaways();
  giveaways[message.id] = giveaway;
  saveGiveaways(giveaways);
  scheduleGiveaway(interaction.client, message.id, ms);

  // Counts toward the "Total Given" voice channel (/gw total).
  addGiveawayPrize(interaction.client, interaction.guildId, prize);

  // DM the host the ID so they can end it / reroll later.
  interaction.user
    .send(
      `Your **${prize}** ${splitSteal ? 'split or steal' : 'giveaway'} is live.\nID: \`${message.id}\`\n` +
        `End it early with \`/giveaway end id:${message.id}\`` +
        (splitSteal ? '' : `\nReroll with \`/giveaway reroll id:${message.id}\``)
    )
    .catch(() => {});

  return done(interaction, `${splitSteal ? 'Split or Steal' : 'Giveaway'} started in ${channel}.`);
}


/* =========================================================
   CLAIM PRIZE

   Claim Prize button -> asks for your IGN -> opens the ticket
   with the IGN inside it -> the button goes grey and says Claimed.
========================================================= */

const IGN_PATTERN = /^\.?[A-Za-z0-9_ ]{2,16}$/;
const claiming = new Set();

function buildIgnModal(messageId) {
  return new ModalBuilder()
    .setCustomId(`giveaway_claimign_${messageId}`)
    .setTitle('Claim Prize')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ign')
          .setLabel('What is your Minecraft IGN?')
          .setPlaceholder('Ex: voidplier or .voidplier')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(17)
      )
    );
}

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

async function handleClaimButton(interaction) {
  const messageId = interaction.customId.replace('giveaway_prize_claim_', '');

  const giveaways = loadGiveaways();
  const giveaway = giveaways[messageId];

  if (!giveaway) return interaction.reply(ephemeral('This giveaway could not be found.'));

  const winners = Array.isArray(giveaway.winners) ? giveaway.winners : [];

  if (!winners.includes(interaction.user.id)) {
    return interaction.reply(ephemeral('Only the winner of this giveaway can claim this prize.'));
  }

  if ((giveaway.claimed || []).includes(interaction.user.id)) {
    return interaction.reply(ephemeral('You already claimed this prize, check your ticket.'));
  }

  const limitMessage = getTicketLimitMessage(interaction.guild, interaction.user.id);
  if (limitMessage) return interaction.reply(ephemeral(limitMessage));

  // Older claim messages weren't tracked, so remember this one so its
  // button can be updated after the claim.
  if (!giveaway.claimMessageId) {
    giveaway.claimMessageId = interaction.message.id;
    giveaway.claimChannelId = interaction.channelId;
    saveGiveaways(giveaways);
  }

  return interaction.showModal(buildIgnModal(messageId));
}

async function handleClaimModal(interaction) {
  const messageId = interaction.customId.replace('giveaway_claimign_', '');
  const userId = interaction.user.id;

  const ign = interaction.fields.getTextInputValue('ign').trim();
  if (!IGN_PATTERN.test(ign)) {
    return interaction.reply(
      ephemeral('That doesn\'t look like a valid IGN. Use something like `voidplier` or `.voidplier`, then press Claim Prize again.')
    );
  }

  const giveaway = loadGiveaways()[messageId];
  const winners = giveaway && Array.isArray(giveaway.winners) ? giveaway.winners : [];

  if (!giveaway || !winners.includes(userId)) {
    return interaction.reply(ephemeral('Only the winner of this giveaway can claim this prize.'));
  }

  const lock = `${messageId}:${userId}`;
  if ((giveaway.claimed || []).includes(userId) || claiming.has(lock)) {
    return interaction.reply(ephemeral('You already claimed this prize, check your ticket.'));
  }

  claiming.add(lock);

  try {
    const answers = [
      {
        question: 'How much did you win?',
        answer: (giveaway.payouts && giveaway.payouts[userId]) || giveaway.prize,
      },
      {
        question: 'Who was the giveaway hosted by?',
        answer: giveaway.hostId ? `<@${giveaway.hostId}>` : 'Unknown',
      },
      { question: "What's your IGN?", answer: ign },
    ];

    const channel = await createTicket(interaction, 'giveaway_claim', answers);

    // createTicket returns the new channel when it worked.
    if (channel && channel.type === ChannelType.GuildText) {
      const giveaways = loadGiveaways();
      const fresh = giveaways[messageId];

      if (fresh) {
        fresh.claimed = [...new Set([...(fresh.claimed || []), userId])];
        saveGiveaways(giveaways);
        await refreshClaimButton(interaction.client, messageId);
      }
    }
  } finally {
    claiming.delete(lock);
  }
}


/* =========================================================
   SPLIT OR STEAL BUTTONS

   gwss_steal_<id> / gwss_split_<id>  the two choice buttons (DM)
   gwss_open_<id>                     "Make your choice" fallback
                                      when a player's DMs are closed
========================================================= */

async function handleSplitStealButton(interaction) {
  const [, action, messageId] = interaction.customId.split('_');

  const giveaways = loadGiveaways();
  const giveaway = giveaways[messageId];
  const ss = giveaway && giveaway.splitSteal;
  const userId = interaction.user.id;

  if (!ss || ss.resolved) {
    const text = 'This Split or Steal is already over.';

    // In a DM, clear the buttons off the prompt itself.
    return interaction.guild
      ? interaction.reply(ephemeral(text))
      : interaction.update({ content: text, embeds: [], components: [] });
  }

  if (!ss.players.includes(userId)) {
    return interaction.reply(ephemeral("You're not one of the players in this Split or Steal."));
  }

  if (ss.choices[userId]) {
    return interaction.reply(
      ephemeral(`You already picked **${ss.choices[userId] === 'steal' ? 'Steal' : 'Split'}**.`)
    );
  }

  // Fallback button: show the choice buttons privately.
  if (action === 'open') {
    return interaction.reply({
      ...buildChoicePayload(messageId, giveaway, userId),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action !== 'split' && action !== 'steal') return;

  ss.choices[userId] = action;
  saveGiveaways(giveaways);

  const opponent = ss.players.find((id) => id !== userId);
  const bothPicked = !!ss.choices[opponent];

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('Split or Steal!')
        .setDescription(
          `You picked **${action === 'steal' ? 'Steal' : 'Split'}**.\n` +
            (bothPicked ? 'Revealing...' : `Waiting for <@${opponent}>...`)
        ),
    ],
    components: [],
  });

  if (bothPicked) await resolveSplitSteal(interaction.client, messageId);
}


/* =========================================================
   ROUTER
   Returns true when the interaction belonged to the giveaway
   system, so interactionCreate knows to stop.
========================================================= */

async function handleGiveawayInteraction(interaction) {
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('gwstart_')) {
      await handleStartModal(interaction);
      return true;
    }

    if (interaction.customId.startsWith('giveaway_claimign_')) {
      await handleClaimModal(interaction);
      return true;
    }

    return false;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('giveaway_prize_claim_')) {
      await handleClaimButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith('gwss_')) {
      await handleSplitStealButton(interaction);
      return true;
    }
  }

  return false;
}

module.exports = { buildStartModal, handleGiveawayInteraction };
