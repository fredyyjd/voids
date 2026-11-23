const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const economy = require('./economy');
const { COLOR } = require('./theme');
const { ITEMS, FOOTER } = require('./economyConfig');
const { ownsItem, grantItem, priceOf, visibleKeys, categoryOf, targetName, applyRole } = require('./shopItems');
const shop = require('./shop');
const mysteryBox = require('./mysteryBox');

const BANNER = path.join(__dirname, '..', 'assets', 'voidscove-banner.png');
const BANNER_NAME = 'voidscove-banner.png';
const MAX_QTY = 10;
const PAGE_SIZE = 4;

const carts = new Map();
const busy = new Set();

const text = (content) => new TextDisplayBuilder().setContent(String(content).slice(0, 3800));
const gap = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);
const countable = (key) => ['entry', 'pass', 'box'].includes(ITEMS[key]?.type);
const forSale = (key) => Boolean(ITEMS[key]) && !ITEMS[key].soon && !economy.isHidden(key);
const buyable = (userId, key) => forSale(key) && (countable(key) || !ownsItem(userId, key));

function cartOf(userId) {
  if (!carts.has(userId)) carts.set(userId, new Map());
  const cart = carts.get(userId);
  for (const key of [...cart.keys()]) if (!buyable(userId, key)) cart.delete(key);
  return cart;
}

const cartCount = (userId) => [...cartOf(userId).values()].reduce((sum, qty) => sum + qty, 0);

function cartTotal(userId) {
  let total = 0;
  for (const [key, qty] of cartOf(userId)) total += priceOf(key).price * qty;
  return total;
}

function viewOf(key) {
  const item = ITEMS[key];
  if (item?.type === 'colour') return 'colours';
  const category = categoryOf(item || {});
  if (category === 'perk') return 'perks';
  return category === 'feature' ? 'features' : 'roles';
}

const ends = (d) => (d.endsAt ? ` · ends <t:${Math.floor(d.endsAt / 1000)}:R>` : '');

/* ---------- pieces ---------- */

function accessoryButton(userId, key, page) {
  const q = cartOf(userId).get(key) || 0;
  const owned = !countable(key) && ownsItem(userId, key);
  const button = new ButtonBuilder().setCustomId(`cart_add:${key}:${page}`);

  if (owned) return button.setLabel('Owned').setStyle(ButtonStyle.Secondary).setDisabled(true);
  if (q && countable(key)) return button.setLabel(`In cart ×${q}`).setStyle(ButtonStyle.Success);
  if (q) return button.setLabel('In cart ✔️').setStyle(ButtonStyle.Success);
  return button.setLabel('Add To 🛒').setStyle(ButtonStyle.Primary);
}

function productText(key) {
  const item = ITEMS[key];
  const info = priceOf(key);
  const name = item.type === 'colour' ? shop.roleTag(item) : `**${item.name}**`;

  let price = `**${economy.fmt(info.base)}**`;
  if (item.soon) price = 'Coming soon';
  else if (info.percent) price = `~~${economy.fmt(info.base)}~~ **${economy.fmt(info.price)}**   🏷️ **${info.percent}% off!**`;

  return `${item.emoji}  ${name}  ·  ${price}\n-# ${item.desc}`;
}

function tabsRow(view, count) {
  const tab = (id, label, emoji, style = ButtonStyle.Secondary) =>
    new ButtonBuilder()
      .setCustomId(`cart_tab:${id}:0`)
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(view === id ? ButtonStyle.Primary : style);

  return new ActionRowBuilder().addComponents(
    tab('colours', 'Colours', '🎨'),
    tab('perks', 'Perks', '🎁'),
    tab('features', 'Features', '✨'),
    tab('roles', 'Roles', '👑'),
    tab('cart', count ? `Cart (${count})` : 'Cart', '🛒', count ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
}

function frame(userId, view, notice, build) {
  const container = new ContainerBuilder().setAccentColor(COLOR);
  const files = [];

  if (fs.existsSync(BANNER)) {
    files.push(new AttachmentBuilder(BANNER, { name: BANNER_NAME }));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${BANNER_NAME}`))
    );
  }

  const count = cartCount(userId);
  const discounts = economy.activeDiscounts();
  const sales = discounts.filter((d) => !d.special);
  const specials = discounts.filter((d) => d.special && ITEMS[d.target.slice(5)] && !economy.isHidden(d.target.slice(5)));
  const note = economy.announcement();

  const header = [
    '# 🛒  VoidsCove Shop',
    `💰  **${economy.fmt(economy.peek(userId).vb)}**   ·   🛒  **${count}** item${count === 1 ? '' : 's'} in your cart`,
  ];

  if (note) header.push(`-# 📢 ${note.text} · announced by <@${note.by}>`);
  for (const d of sales) header.push(`-# 🏷️ ${d.percent}% off ${targetName(d.target)}${ends(d)}`);
  for (const d of specials) header.push(`-# ⭐ ${ITEMS[d.target.slice(5)].name} ${d.percent}% off${ends(d)}`);

  if (notice) header.push('', `> ${notice}`);

  container
    .addTextDisplayComponents(text(header.join('\n')))
    .addSeparatorComponents(gap())
    .addActionRowComponents(tabsRow(view, count))
    .addSeparatorComponents(gap());

  build(container);

  container.addSeparatorComponents(gap()).addTextDisplayComponents(text(`-# ${FOOTER}`));

  return { flags: MessageFlags.IsComponentsV2, components: [container], files, allowedMentions: shop.NO_PINGS };
}

/* ---------- views ---------- */

function shelf(container, userId, view, title, sub, keys, page) {
  const pages = Math.max(1, Math.ceil(keys.length / PAGE_SIZE));
  const at = Math.min(Math.max(0, page), pages - 1);

  container.addTextDisplayComponents(text(sub ? `${title}\n-# ${sub}` : title));

  if (!keys.length) return container.addTextDisplayComponents(text('*Nothing here right now.*'));

  const shown = keys.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE);

  for (const [index, key] of shown.entries()) {
    if (index) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    if (ITEMS[key].soon) {
      container.addTextDisplayComponents(text(productText(key)));
      continue;
    }

    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(text(productText(key))).setButtonAccessory(accessoryButton(userId, key, at))
    );
  }

  if (pages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cart_pg:${view}:${at - 1}`).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(at === 0),
        new ButtonBuilder().setCustomId('cart_page').setLabel(`${at + 1} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`cart_pg:${view}:${at + 1}`).setLabel('Next ➡️').setStyle(ButtonStyle.Secondary).setDisabled(at >= pages - 1)
      )
    );
  }
}

function cartBody(container, userId) {
  const cart = cartOf(userId);
  const balance = economy.peek(userId).vb;

  if (!cart.size) {
    container.addTextDisplayComponents(
      text(['### 🛒  Your cart', '*Nothing in here yet.* Press **Add to cart** on anything you like in the other tabs.'].join('\n'))
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cart_go:colours:0').setLabel('Start shopping').setEmoji('🛍️').setStyle(ButtonStyle.Primary)
      )
    );
    return;
  }

  const total = cartTotal(userId);
  const afford = balance + 1e-9 >= total;

  const lines = [...cart].map(([key, qty]) => {
    const item = ITEMS[key];
    return `${item.emoji}  **${item.name}**${qty > 1 ? `  ×${qty}` : ''}  ·  ${economy.fmt(priceOf(key).price * qty)}`;
  });

  container.addTextDisplayComponents(
    text(
      [
        '### 🛒  Your cart',
        lines.join('\n'),
        '',
        `**Total:** ${economy.fmt(total)}`,
        `**Your balance:** ${economy.fmt(balance)}`,
        afford ? `**After checkout:** ${economy.fmt(balance - total)}` : `❌ **You need ${economy.fmt(total - balance)} more.** Remove something or earn more VB.`,
      ].join('\n')
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cart_remove')
        .setPlaceholder('Take something out of your cart')
        .addOptions(
          [...cart.keys()].slice(0, 25).map((key) => ({
            label: ITEMS[key].name.slice(0, 100),
            value: key,
            description: 'Remove from cart',
            emoji: ITEMS[key].emoji,
          }))
        )
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cart_checkout').setLabel(`Checkout  ·  ${economy.fmt(total)}`).setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(!afford),
      new ButtonBuilder().setCustomId('cart_go:colours:0').setLabel('Keep shopping').setEmoji('🛍️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cart_clear').setLabel('Clear').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
    )
  );
}

function shopPayload(userId, view = 'colours', notice = null, page = 0) {
  const keys = (test) => visibleKeys().filter((k) => test(ITEMS[k]));

  return frame(userId, view, notice, (container) => {
    if (view === 'cart') return cartBody(container, userId);

    if (view === 'perks') return shelf(container, userId, view, '### 🎁  Perks', '', keys((i) => categoryOf(i) === 'perk'), page);

    if (view === 'features') {
      return shelf(container, userId, view, '### ✨  Features', 'Buying one gives you a role that unlocks it.', keys((i) => categoryOf(i) === 'feature'), page);
    }

    if (view === 'roles') return shelf(container, userId, view, '### 👑  Roles & Badges', '', keys((i) => categoryOf(i) === 'role'), page);

    return shelf(container, userId, 'colours', '### 🎨  Name Colours', 'Only one colour is worn at a time.', keys((i) => i.type === 'colour'), page);
  });
}

/* ---------- cart actions ---------- */

function toggle(userId, key) {
  const item = ITEMS[key];
  if (!forSale(key)) return '❌ That item is not for sale right now.';
  if (!countable(key) && ownsItem(userId, key)) return `❌ You already own **${shop.label(item)}**.`;

  const cart = cartOf(userId);
  const q = cart.get(key) || 0;

  if (countable(key)) {
    if (q >= MAX_QTY) return `❌ You can order ${MAX_QTY} of **${item.name}** at most.`;
    cart.set(key, q + 1);
    return `✅ Added **${shop.label(item)}** to your cart.`;
  }

  if (q) {
    cart.delete(key);
    return `🗑️ Took **${shop.label(item)}** out of your cart.`;
  }

  cart.set(key, 1);
  return `✅ Added **${shop.label(item)}** to your cart.`;
}

async function checkout(interaction) {
  const userId = interaction.user.id;
  const cart = cartOf(userId);

  if (!cart.size) return shopPayload(userId, 'cart', 'Your cart is empty.');
  if (busy.has(userId)) return shopPayload(userId, 'cart', 'Hold on, your last order is still going through.');

  busy.add(userId);

  try {
    const entries = [...cart];
    const costOf = (key, qty) => priceOf(key).price * qty;
    const total = entries.reduce((sum, [key, qty]) => sum + costOf(key, qty), 0);

    if (!economy.spendVb(userId, total)) {
      return shopPayload(userId, 'cart', `❌ You need ${economy.fmt(total - economy.peek(userId).vb)} more VB.`);
    }

    const u = economy.user(userId);
    const good = [];
    const bad = [];
    let refunded = 0;
    let boxesBought = 0;

    const refund = (key, qty, reason) => {
      const cost = costOf(key, qty);
      economy.addVb(userId, cost);
      refunded += cost;
      bad.push(`❌  **${shop.label(ITEMS[key])}**  ·  ${reason}`);
    };

    const colours = entries.filter(([key]) => ITEMS[key].type === 'colour');

    if (colours.length) {
      const last = colours[colours.length - 1][0];

      try {
        await shop.wearColour(interaction.member, last);
        for (const [key] of colours) {
          u.colours.push(key);
          good.push(`${ITEMS[key].emoji}  **${ITEMS[key].name}** colour`);
        }
        u.equipped = last;
        economy.touch();
      } catch (err) {
        if (!(err instanceof shop.ShopError)) console.error('[shop] colour checkout failed:', err);
        for (const [key, qty] of colours) refund(key, qty, err instanceof shop.ShopError ? err.message : 'Something went wrong.');
      }
    }

    for (const [key, qty] of entries) {
      const item = ITEMS[key];
      if (item.type === 'colour') continue;

      try {
        if (item.type === 'role' || item.type === 'feature') {
          if (!item.roleId) throw new shop.ShopError('That role is not set up yet. Tell an admin.');
          const ok = await applyRole(interaction.guild, userId, item.roleId);
          if (!ok) throw new shop.ShopError('I could not give the role. My role must be above it.');
          u[item.type === 'role' ? 'roles' : 'features'].push(key);
          economy.touch();
          good.push(item.type === 'role' ? `${item.emoji}  **${item.name}** role` : `${item.emoji}  **${item.name}** unlocked`);
          continue;
        }

        const result = grantItem(userId, key, qty);
        if (!result.ok) throw new shop.ShopError("That item can't be bought yet.");

        const name = qty > 1 ? `${qty}× ${item.emoji}  **${item.name}**` : `${item.emoji}  **${item.name}**`;
        if (result.boxes) boxesBought += result.boxes;
        good.push(name);
      } catch (err) {
        if (!(err instanceof shop.ShopError)) console.error('[shop] checkout failed:', err);
        refund(key, qty, err instanceof shop.ShopError ? err.message : 'Something went wrong.');
      }
    }

    cart.clear();

    const boxSent = boxesBought ? await mysteryBox.offer(interaction.client, userId) : null;

    const paid = total - refunded;
    const out = [`## ${good.length ? '✅  Order complete' : '❌  Order failed'}`];
    if (good.length) out.push(good.join('\n'));
    if (bad.length) out.push(bad.join('\n') + '\n-# Those were refunded.');
    out.push(`**Paid:** −${economy.fmt(paid)}\n**New balance:** ${economy.fmt(economy.peek(userId).vb)}`);
    if (colours.length && good.some((l) => l.includes('colour'))) out.push('-# Swap colours any time in `/inv`.');
    if (boxesBought) {
      out.push(boxSent ? '📬  **Check your DMs** to open your Mystery Box now, or wait and open it later in `/inv`.' : "⚠️  I couldn't DM you. Open your Mystery Box from `/inv` instead.");
    }

    const payload = frame(userId, 'receipt', null, (container) => {
      container.addTextDisplayComponents(text(out.join('\n\n')));
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cart_go:colours:0').setLabel('Back to the shop').setEmoji('🛍️').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('shop_inv').setLabel('My Inventory').setEmoji('🎒').setStyle(ButtonStyle.Secondary)
        )
      );
    });

    return payload;
  } finally {
    busy.delete(userId);
  }
}

/* ---------- router ---------- */

async function handle(interaction) {
  const id = interaction.customId;
  const userId = interaction.user.id;

  if (interaction.isButton()) {
    if (id.startsWith('cart_tab:') || id.startsWith('cart_go:') || id.startsWith('cart_pg:')) {
      const [, view, page] = id.split(':');
      return interaction.update(shopPayload(userId, view, null, Number(page) || 0));
    }

    if (id.startsWith('cart_add:')) {
      const [, key, page] = id.split(':');
      const notice = toggle(userId, key);
      return interaction.update(shopPayload(userId, ITEMS[key] ? viewOf(key) : 'colours', notice, Number(page) || 0));
    }

    if (id === 'cart_clear') {
      cartOf(userId).clear();
      return interaction.update(shopPayload(userId, 'cart', '🗑️ Cart cleared.'));
    }

    if (id === 'cart_checkout') {
      await interaction.deferUpdate();
      return interaction.editReply(await checkout(interaction));
    }
  }

  if (interaction.isStringSelectMenu() && id === 'cart_remove') {
    const key = interaction.values[0];
    cartOf(userId).delete(key);
    return interaction.update(shopPayload(userId, 'cart', `🗑️ Took **${ITEMS[key]?.name || 'that item'}** out of your cart.`));
  }

  return null;
}

module.exports = { shopPayload, handle };
