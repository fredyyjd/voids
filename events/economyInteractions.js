const { MessageFlags } = require('discord.js');
const shop = require('../utils/shop');
const { box, priv } = require('../utils/box');
const help = require('../utils/help');

const EPHEMERAL = MessageFlags.Ephemeral;

async function handle(interaction) {
  const id = interaction.customId || '';
  const isMenu = interaction.isStringSelectMenu?.();
  const isButton = interaction.isButton?.();
  if (!isMenu && !isButton) return;

  /* ---------- help ---------- */
  if (isMenu && id === 'help_menu') {
    return interaction.update(help.helpPayload(interaction.values[0], interaction.member));
  }

  /* ---------- shop ---------- */
  // Item buttons on the shop (and the old dropdown on shops posted before this update).
  if (isButton && id.startsWith('shop_item:')) {
    return interaction.reply(priv(shop.confirmPayload(id.slice('shop_item:'.length), interaction.user.id)));
  }

  if (isMenu && id === 'shop_select') {
    return interaction.reply(priv(shop.confirmPayload(interaction.values[0], interaction.user.id)));
  }

  if (isButton && id.startsWith('shop_buy:')) {
    await interaction.deferUpdate();
    const result = await shop.purchase(interaction, id.slice('shop_buy:'.length));
    return interaction.editReply(result.payload);
  }

  if (isButton && id.startsWith('shop_equip:')) {
    await interaction.deferUpdate();
    let notice;
    try {
      notice = '✅ ' + (await shop.equip(interaction, id.slice('shop_equip:'.length)));
    } catch (err) {
      notice = '❌ ' + (err instanceof shop.ShopError ? err.message : 'Something went wrong.');
      if (!(err instanceof shop.ShopError)) console.error('[shop] equip failed:', err);
    }
    return interaction.editReply(box(notice));
  }

  if (isButton && id === 'shop_cancel') {
    return interaction.update(box('Purchase cancelled.'));
  }

  if (isButton && id === 'shop_balance') {
    return interaction.reply({ embeds: [shop.balanceEmbed(interaction.user, interaction.member)], flags: EPHEMERAL });
  }

  if (isButton && id === 'shop_inv') {
    return interaction.reply(priv(shop.invPayload(interaction.user, interaction.member)));
  }

  /* ---------- inventory ---------- */
  // Colour buttons on /inv (and the old dropdown on inventories posted before this update).
  const equipValue = isButton && id.startsWith('inv_equip:') ? id.slice('inv_equip:'.length) : isMenu && id === 'inv_equip' ? interaction.values[0] : null;

  if (equipValue) {
    await interaction.deferUpdate();
    let notice;
    try {
      notice = await shop.equip(interaction, equipValue);
    } catch (err) {
      notice = err instanceof shop.ShopError ? err.message : 'Something went wrong.';
      if (!(err instanceof shop.ShopError)) console.error('[inv] equip failed:', err);
    }
    const payload = shop.invPayload(interaction.user, interaction.member, notice);
    try {
      return await interaction.editReply(payload);
    } catch {
      // An old-style inventory cannot be turned into the new layout, so send a fresh one.
      return interaction.followUp(priv(payload));
    }
  }
}

module.exports = {
  name: 'economyInteractions',

  register(client) {
    client.on('interactionCreate', (interaction) => {
      handle(interaction).catch(async (err) => {
        console.error('[economy] interaction error:', err);
        try {
          const text = 'Something went wrong. Try again in a moment.';
          if (interaction.deferred || interaction.replied) await interaction.followUp({ content: text, flags: EPHEMERAL });
          else await interaction.reply({ content: text, flags: EPHEMERAL });
        } catch {
          // nothing else to do
        }
      });
    });
  },
};
