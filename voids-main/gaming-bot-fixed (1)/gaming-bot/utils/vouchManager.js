const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const OPTION_LABELS = {
  spawner_sell: 'Spawner Sell',
  spawner_buy: 'Spawner Buy',
  giveaway_claim: 'Giveaway Claim',
};

function buildYesNoRow(requesterId, optionValue) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vouch_yes_${requesterId}|${optionValue}`)
      .setLabel('Yes')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`vouch_no_${requesterId}|${optionValue}`)
      .setLabel('No')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );
}

function buildStarsRow(requesterId, optionValue) {
  const row = new ActionRowBuilder();
  for (let i = 1; i <= 5; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`vouch_stars_${requesterId}|${optionValue}|${i}`)
        .setLabel(`${i}⭐`)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return row;
}

// Sends the initial "please vouch" DM with Yes/No buttons.
// Returns true if it was sent, false if the DM couldn't go through.
async function sendVouchRequestDm(target, requester, optionValue) {
  const optionLabel = OPTION_LABELS[optionValue] || optionValue;

  const embed = new EmbedBuilder()
    .setTitle('Vouch Request')
    .setDescription(
      `**${requester.tag}** would like you to leave a vouch for your recent **${optionLabel}** experience.\n\nWould you like to vouch?`
    )
    .setColor('#2b2d31');

  const dm = await target.createDM().catch(() => null);
  if (!dm) return false;

  const message = await dm
    .send({ embeds: [embed], components: [buildYesNoRow(requester.id, optionValue)] })
    .catch(() => null);

  return !!message;
}

module.exports = { OPTION_LABELS, buildYesNoRow, buildStarsRow, sendVouchRequestDm };
