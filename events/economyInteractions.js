const { MessageFlags } = require('discord.js');
const shop = require('../utils/shop');
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
  if (isMenu && id === 'shop_select') {
    return interaction.reply({ ...shop.confirmPayload(interaction.values[0], interaction.user.id), flags: EPHEMERAL });
  }

  if (isButton && id.startsWith('shop_buy:')) {
    await interaction.deferUpdate();
    const result = await shop.purchase(interaction, id.slice('shop_buy:'.length));
    return interaction.editReply({ embeds: [result.embed], components: [] });
  }

  if (isButton && id === 'shop_cancel') {
    return interaction.update({ content: 'Purchase cancelled.', embeds: [], components: [] });
  }

  if (isButton && id === 'shop_balance') {
    return interaction.reply({ embeds: [shop.balanceEmbed(interaction.user, interaction.member)], flags: EPHEMERAL });
  }

  if (isButton && id === 'shop_inv') {
    return interaction.reply({ ...shop.invPayload(interaction.user, interaction.member), flags: EPHEMERAL });
  }

  /* ---------- inventory ---------- */
  if (isMenu && id === 'inv_equip') {
    await interaction.deferUpdate();
    let notice;
    try {
      notice = await shop.equip(interaction, interaction.values[0]);
    } catch (err) {
      notice = err instanceof shop.ShopError ? err.message : 'Something went wrong.';
      if (!(err instanceof shop.ShopError)) console.error('[inv] equip failed:', err);
    }
    return interaction.editReply(shop.invPayload(interaction.user, interaction.member, notice));
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
