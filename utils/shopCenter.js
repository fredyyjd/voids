const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const economy = require('./economy');
const { box } = require('./box');
const { COLOR } = require('./theme');
const { ITEMS, FOOTER, MAX_SHOP_PRICE, MAX_CUSTOM_ITEMS } = require('./economyConfig');
const { giveableKeys, visibleKeys, itemLabel, targetName, priceOf } = require('./shopItems');
const { needsAmount, maxAmount, giveItem } = require('./shopGive');
const { hasMaxPerms } = require('./permissions');

const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_DISCOUNTS = 20;

const picks = new Map();

const SALE_TARGETS = [
  { label: 'Everything in the shop', value: 'all', emoji: '🛒' },
  { label: 'All name colours', value: 'cat:colour', emoji: '🎨' },
  { label: 'All perks', value: 'cat:perk', emoji: '🎁' },
  { label: 'All features', value: 'cat:feature', emoji: '✨' },
  { label: 'All roles and badges', value: 'cat:role', emoji: '👑' },
];

const DANGEROUS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
];

const row = (...components) => new ActionRowBuilder().addComponents(...components);

const button = (id, label, emoji, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);

const ends = (d) => (d.endsAt ? `ends <t:${Math.floor(d.endsAt / 1000)}:R>` : 'no end time');

const optionName = (key) => {
  const item = ITEMS[key];
  if (item.type === 'colour') return `${item.name} colour`;
  if (item.type === 'role') return `${item.name} role`;
  return item.name;
};

const itemOption = (key, description) => ({
  label: optionName(key).slice(0, 100),
  value: key,
  description: String(description).slice(0, 100),
  emoji: ITEMS[key].emoji,
});

const text = (content) => new TextDisplayBuilder().setContent(String(content).slice(0, 3800));
const gap = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);

function frame(view, notice, build) {
  const tab = (id, label, emoji, key) => button(`sc_${id}`, label, emoji, view === key ? ButtonStyle.Primary : ButtonStyle.Secondary);

  const container = new ContainerBuilder()
    .setAccentColor(COLOR)
    .addTextDisplayComponents(text('# 🛠️  Shop Center\n-# Run the shop from one place. Only people with max perms can see this.'))
    .addSeparatorComponents(gap())
    .addActionRowComponents(
      row(tab('home', 'Overview', '📊', 'home'), tab('give', 'Give', '🎁', 'give'), tab('sales', 'Sales', '🏷️', 'sales'), tab('specials', 'Specials', '⭐', 'specials'), tab('items', 'Items', '🧩', 'items')),
      row(tab('ann', 'Announce', '📢', 'ann'), button('sc_refresh', 'Refresh', '🔄'), button('sc_close', 'Close', '✖️'))
    )
    .addSeparatorComponents(gap());

  if (notice) container.addTextDisplayComponents(text(`> ${notice}`));

  build(container);

  container.addSeparatorComponents(gap()).addTextDisplayComponents(text(`-# ${FOOTER}`));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

const discountLines = (list) =>
  list.length ? list.map((d) => `**${d.percent}% off** ${targetName(d.target)}  ·  ${ends(d)}`).join('\n') : '*None running*';

/* ---------- home ---------- */

function homePayload(notice = null) {
  const discounts = economy.activeDiscounts();
  const sales = discounts.filter((d) => !d.special);
  const specials = discounts.filter((d) => d.special);
  const hidden = economy.shopSettings().hidden.filter((k) => ITEMS[k]);
  const customCount = Object.keys(economy.shopSettings().custom).length;
  const boost = economy.boostState();
  const live = visibleKeys().filter((k) => !ITEMS[k].soon).length;
  const note = economy.announcement();

  return frame('home', notice, (container) => {
    container
      .addTextDisplayComponents(
        text(
          [
            `**${live}** items for sale   ·   **${sales.length}** sales   ·   **${specials.length}** specials   ·   2x VB **${economy.boostActive() ? 'on' : 'off'}**`,
            economy.boostActive() && boost.endsAt ? `-# 2x VB ends <t:${Math.floor(boost.endsAt / 1000)}:R>` : '-# Turn 2x VB on or off with `/2x vb`',
          ].join('\n')
        )
      )
      .addSeparatorComponents(gap())
      .addTextDisplayComponents(text(`### 🏷️  Sales\n${discountLines(sales)}`))
      .addTextDisplayComponents(text(`### ⭐  Specials\n${discountLines(specials)}`))
      .addTextDisplayComponents(text(`### 📢  Announcement\n${note ? `${note.text}\n-# by <@${note.by}>` : '*None right now. Press Announce to post one.*'}`))
      .addTextDisplayComponents(
        text(
          [
            '### 🛒  Shop',
            hidden.length ? `**${hidden.length}** hidden: ${hidden.map((k) => ITEMS[k].name).join(', ')}` : 'Nothing hidden',
            `**${customCount}** of ${MAX_CUSTOM_ITEMS} custom items`,
          ].join('\n')
        )
      );
  });
}

/* ---------- give ---------- */

function givePayload(adminId, notice = null) {
  const pick = picks.get(adminId) || {};
  const itemText = !pick.item ? '*pick an item*' : pick.item === 'vb' ? '💰 VB (Void Bucks)' : itemLabel(pick.item);

  const userMenu = new UserSelectMenuBuilder().setCustomId('sc_give_user').setPlaceholder('Who gets it?');
  if (pick.user) userMenu.setDefaultUsers(pick.user);

  const options = [
    { label: 'VB (Void Bucks)', value: 'vb', description: 'Up to 100 VB at once', emoji: '💰', default: pick.item === 'vb' },
    ...giveableKeys().map((key) => ({ ...itemOption(key, ITEMS[key].desc), default: pick.item === key })),
  ].slice(0, 25);

  return frame('give', notice, (container) => {
    container
      .addTextDisplayComponents(
        text(
          [
            '### 🎁  Give an item',
            `**To:** ${pick.user ? `<@${pick.user}>` : '*pick a member*'}`,
            `**Item:** ${itemText}`,
            '-# VB and stackable items ask how many. The person is told in this channel.',
          ].join('\n')
        )
      )
      .addActionRowComponents(
        row(userMenu),
        row(new StringSelectMenuBuilder().setCustomId('sc_give_item').setPlaceholder('What do they get?').addOptions(options)),
        row(button('sc_give_go', 'Give', '✅', ButtonStyle.Success).setDisabled(!(pick.user && pick.item)))
      );
  });
}

function amountModal(key) {
  return new ModalBuilder()
    .setCustomId('sc_give_amount')
    .setTitle('How many?')
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel(key === 'vb' ? 'VB to give' : 'How many to give')
          .setPlaceholder(`1 to ${maxAmount(key)}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

async function runGive(interaction, amount) {
  const adminId = interaction.user.id;
  const pick = picks.get(adminId) || {};
  const result = await giveItem({ guild: interaction.guild, targetId: pick.user, key: pick.item, amount });

  if (!result.ok) return givePayload(adminId, `❌ ${result.error}`);

  await interaction.channel
    .send({
      ...box(['## 🎁  Gift sent', `${interaction.user} gave <@${pick.user}> **${result.given}**.`, `${result.tip}\n-# ${FOOTER}`]),
      allowedMentions: { users: [pick.user] },
    })
    .catch(() => {});

  return givePayload(adminId, `✅ Gave <@${pick.user}> **${result.given}**.`);
}


/* ---------- sales and specials ---------- */

function discountsPayload(special, notice = null) {
  const list = economy.activeDiscounts().filter((d) => Boolean(d.special) === special);

  const description = special
    ? 'A special puts one item at the top of the shop with its old price crossed out. Starting a new special for the same item replaces the old one.'
    : 'A sale takes a percentage off everything in the shop or a whole group. Starting a new sale for the same group replaces the old one.';

  const targets = special
    ? visibleKeys()
        .filter((k) => !ITEMS[k].soon)
        .slice(0, 25)
        .map((k) => itemOption(k, `${economy.fmt(ITEMS[k].price)}  ·  ${ITEMS[k].desc}`))
        .map((o) => ({ ...o, value: `item:${o.value}` }))
    : SALE_TARGETS;

  return frame(special ? 'specials' : 'sales', notice, (container) => {
    container.addTextDisplayComponents(text([`### ${special ? '⭐  Specials' : '🏷️  Sales'}`, `-# ${description}`, '', discountLines(list)].join('\n')));

    const rows = [
      row(
        new StringSelectMenuBuilder()
          .setCustomId(special ? 'sc_special_target' : 'sc_sale_target')
          .setPlaceholder(special ? 'Make an item a special' : 'Start a sale on…')
          .addOptions(targets)
      ),
    ];

    if (list.length) {
      rows.push(
        row(
          new StringSelectMenuBuilder()
            .setCustomId(special ? 'sc_special_remove' : 'sc_sale_remove')
            .setPlaceholder('End one early')
            .addOptions(
              list.slice(0, 25).map((d) => ({
                label: `${d.percent}% off ${targetName(d.target)}`.replace(/[*_`]/g, '').slice(0, 100),
                value: d.id,
                description: ends(d),
              }))
            )
        )
      );
    }

    container.addActionRowComponents(...rows);
  });
}

function discountModal(special, target) {
  const name = targetName(target).replace(/[*_`]/g, '');

  return new ModalBuilder()
    .setCustomId(`${special ? 'sc_special_modal' : 'sc_sale_modal'}:${target}`)
    .setTitle(`${special ? 'Special' : 'Sale'}: ${name}`.slice(0, 45))
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('percent')
          .setLabel('Percent off')
          .setPlaceholder('1 to 90, for example 2 or 25')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      row(
        new TextInputBuilder()
          .setCustomId('hours')
          .setLabel('How many hours (optional)')
          .setPlaceholder('Leave empty to keep it going until you end it')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    );
}

function createDiscount(interaction, special, target) {
  const percent = Number(interaction.fields.getTextInputValue('percent').trim());
  const hoursRaw = interaction.fields.getTextInputValue('hours').trim();
  const hours = hoursRaw ? Number(hoursRaw) : null;

  if (!Number.isInteger(percent) || percent < 1 || percent > 90) return 'The percent must be a whole number from 1 to 90.';
  if (hours !== null && (!(hours > 0) || hours > 24 * 60)) return 'Hours must be a number above 0 (60 days at most), or empty.';

  const current = economy.activeDiscounts();
  const replaced = current.filter((d) => d.target === target && Boolean(d.special) === special);

  if (current.length - replaced.length >= MAX_DISCOUNTS) return `You can only have ${MAX_DISCOUNTS} sales and specials running at once.`;

  for (const d of replaced) economy.removeDiscount(d.id);

  economy.addDiscount({
    target,
    percent,
    special,
    endsAt: hours ? Date.now() + Math.round(hours * 3600000) : null,
  });

  return null;
}


/* ---------- items ---------- */

function itemsPayload(notice = null) {
  const keys = Object.keys(ITEMS).filter((k) => !ITEMS[k].soon);
  const hiddenKeys = keys.filter((k) => economy.isHidden(k));
  const shownKeys = keys.filter((k) => !economy.isHidden(k));
  const customKeys = Object.keys(economy.shopSettings().custom);

  return frame('items', notice, (container) => {
    container
      .addTextDisplayComponents(
        text(
          [
            '### 🧩  Items',
            '-# Pick an item in the first menu to take it out of the shop or put it back. People who already own it keep it. Add a custom role item to sell any normal role for VB.',
          ].join('\n')
        )
      )
      .addTextDisplayComponents(
        text(`**🟢  In the shop (${shownKeys.length})**\n${shownKeys.map((k) => `${ITEMS[k].emoji} ${ITEMS[k].name}  ·  ${economy.fmt(priceOf(k).price)}`).join('\n').slice(0, 1500) || 'Nothing'}`)
      )
      .addTextDisplayComponents(
        text(`**🔴  Hidden (${hiddenKeys.length})**\n${hiddenKeys.map((k) => `${ITEMS[k].emoji} ${ITEMS[k].name}`).join('\n').slice(0, 1000) || 'Nothing hidden'}`)
      )
      .addTextDisplayComponents(
        text(
          `**✨  Custom items (${customKeys.length}/${MAX_CUSTOM_ITEMS})**\n${customKeys.map((k) => `${ITEMS[k].emoji} ${ITEMS[k].name}  ·  ${economy.fmt(ITEMS[k].price)}  ·  <@&${ITEMS[k].roleId}>`).join('\n').slice(0, 1000) || 'None yet'}`
        )
      );

    const rows = [
      row(
        new StringSelectMenuBuilder()
          .setCustomId('sc_item_toggle')
          .setPlaceholder('Take out of the shop or put back')
          .addOptions(keys.slice(0, 25).map((k) => itemOption(k, economy.isHidden(k) ? '🔴 Hidden. Pick to put it back' : '🟢 In the shop. Pick to hide it')))
      ),
    ];

    if (customKeys.length) {
      rows.push(
        row(
          new StringSelectMenuBuilder()
            .setCustomId('sc_item_delete')
            .setPlaceholder('Delete a custom item')
            .addOptions(customKeys.map((k) => itemOption(k, `${economy.fmt(ITEMS[k].price)}  ·  deletes it for good`)))
        )
      );
    }

    rows.push(row(button('sc_item_add', 'Add custom role item', '➕', ButtonStyle.Success).setDisabled(customKeys.length >= MAX_CUSTOM_ITEMS)));

    container.addActionRowComponents(...rows);
  });
}

/* ---------- announcement ---------- */

function annPayload(notice = null) {
  const note = economy.announcement();

  return frame('ann', notice, (container) => {
    container
      .addTextDisplayComponents(
        text(
          [
            '### 📢  Announcement',
            '-# Shows in small text at the top of /item shop with your name on it. Active sales and specials show there on their own.',
            '',
            note ? `**Right now**\n-# 📢 ${note.text} · announced by <@${note.by}>` : '*Nothing posted right now.*',
          ].join('\n')
        )
      )
      .addActionRowComponents(
        row(
          button('sc_ann_edit', note ? 'Change announcement' : 'Post announcement', '✏️', ButtonStyle.Success),
          button('sc_ann_clear', 'Remove', '🗑️', ButtonStyle.Danger).setDisabled(!note)
        )
      );
  });
}

function annModal() {
  const current = economy.announcement();
  const input = new TextInputBuilder()
    .setCustomId('text')
    .setLabel('Announcement')
    .setPlaceholder('e.g. New perks added, check the Features tab')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(150);

  if (current) input.setValue(current.text);

  return new ModalBuilder().setCustomId('sc_ann_modal').setTitle('Shop announcement').addComponents(row(input));
}

function itemModal() {
  const input = (id, label, placeholder, required, style = TextInputStyle.Short, max = 100) =>
    row(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(style).setRequired(required).setMaxLength(max));

  return new ModalBuilder()
    .setCustomId('sc_item_modal')
    .setTitle('Add a custom role item')
    .addComponents(
      input('name', 'Name', 'e.g. Supporter', true, TextInputStyle.Short, 30),
      input('emoji', 'Emoji (optional)', 'e.g. 💎', false, TextInputStyle.Short, 60),
      input('price', 'Price in VB', `1 to ${MAX_SHOP_PRICE}`, true, TextInputStyle.Short, 6),
      input('role', 'Role ID', 'Right click the role, Copy Role ID', true, TextInputStyle.Short, 25),
      input('desc', 'Description (optional)', 'One short line', false, TextInputStyle.Short, 80)
    );
}

async function createItem(interaction) {
  const name = interaction.fields.getTextInputValue('name').trim();
  const emojiRaw = interaction.fields.getTextInputValue('emoji').trim();
  const price = Number(interaction.fields.getTextInputValue('price').trim());
  const roleId = interaction.fields.getTextInputValue('role').trim();
  const desc = interaction.fields.getTextInputValue('desc').trim() || 'A special role';

  if (Object.keys(economy.shopSettings().custom).length >= MAX_CUSTOM_ITEMS) return `You can only have ${MAX_CUSTOM_ITEMS} custom items.`;
  if (!name) return 'Give the item a name.';
  if (!Number.isInteger(price) || price < 1 || price > MAX_SHOP_PRICE) return `The price must be a whole number from 1 to ${MAX_SHOP_PRICE}.`;
  if (!/^\d{15,25}$/.test(roleId)) return 'That is not a role ID. Right click the role and press Copy Role ID.';

  const guild = interaction.guild;
  const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));

  if (!role) return 'That role does not exist in this server.';
  if (role.id === guild.id || role.managed) return 'That role cannot be given out by the shop.';
  if (DANGEROUS.some((flag) => role.permissions.has(flag))) {
    return 'That role has staff permissions. The shop only sells roles without staff permissions.';
  }

  const me = guild.members.me;
  if (me && role.position >= me.roles.highest.position) return 'That role is above my highest role, so I could not give it out.';

  const emoji = /^(<a?:\w+:\d+>|\p{Extended_Pictographic}\uFE0F?)$/u.test(emojiRaw) ? emojiRaw : '✨';

  economy.addCustomItem(`custom_${Date.now().toString(36)}`, {
    type: 'role',
    name,
    emoji,
    price,
    roleId,
    buttonStyle: 'Secondary',
    desc,
  });

  return null;
}


/* ---------- router ---------- */

const refresh = (interaction, payload) =>
  interaction.isFromMessage?.() ? interaction.update(payload) : interaction.reply({ ...payload, flags: payload.flags | EPHEMERAL });

const warn = (interaction, text) => interaction.reply({ content: `❌ ${text}`, flags: EPHEMERAL });

async function handle(interaction) {
  if (!hasMaxPerms(interaction.member)) {
    return interaction.reply({ content: "You can't use this.", flags: EPHEMERAL });
  }

  const id = interaction.customId;
  const adminId = interaction.user.id;

  if (interaction.isButton()) {
    if (id === 'sc_home' || id === 'sc_refresh') return interaction.update(homePayload());
    if (id === 'sc_close') return interaction.update(box(['Shop Center closed.']));
    if (id === 'sc_give') return interaction.update(givePayload(adminId));
    if (id === 'sc_sales') return interaction.update(discountsPayload(false));
    if (id === 'sc_specials') return interaction.update(discountsPayload(true));
    if (id === 'sc_items') return interaction.update(itemsPayload());
    if (id === 'sc_item_add') return interaction.showModal(itemModal());
    if (id === 'sc_ann') return interaction.update(annPayload());
    if (id === 'sc_ann_edit') return interaction.showModal(annModal());

    if (id === 'sc_ann_clear') {
      economy.clearAnnouncement();
      return interaction.update(annPayload('🗑️ Announcement removed.'));
    }

    if (id === 'sc_give_go') {
      const pick = picks.get(adminId) || {};
      if (!pick.user || !pick.item) return warn(interaction, 'Pick a member and an item first.');
      if (needsAmount(pick.item)) return interaction.showModal(amountModal(pick.item));

      await interaction.deferUpdate();
      return interaction.editReply(await runGive(interaction, 1));
    }
    return null;
  }

  if (interaction.isUserSelectMenu?.() && id === 'sc_give_user') {
    const pick = picks.get(adminId) || {};
    pick.user = interaction.values[0];
    picks.set(adminId, pick);
    return interaction.update(givePayload(adminId));
  }

  if (interaction.isStringSelectMenu()) {
    const value = interaction.values[0];

    if (id === 'sc_give_item') {
      const pick = picks.get(adminId) || {};
      pick.item = value;
      picks.set(adminId, pick);
      return interaction.update(givePayload(adminId));
    }

    if (id === 'sc_sale_target') return interaction.showModal(discountModal(false, value));
    if (id === 'sc_special_target') return interaction.showModal(discountModal(true, value));

    if (id === 'sc_sale_remove' || id === 'sc_special_remove') {
      economy.removeDiscount(value);
      return interaction.update(discountsPayload(id === 'sc_special_remove', 'Ended early.'));
    }

    if (id === 'sc_item_toggle') {
      if (!ITEMS[value]) return interaction.update(itemsPayload('❌ That item no longer exists.'));
      const hide = !economy.isHidden(value);
      economy.setHidden(value, hide);
      return interaction.update(itemsPayload(`${hide ? '🔴 Hid' : '🟢 Put back'} **${ITEMS[value].name}**.`));
    }

    if (id === 'sc_item_delete') {
      const name = ITEMS[value]?.name || 'that item';
      economy.removeCustomItem(value);
      return interaction.update(itemsPayload(`🗑️ Deleted **${name}**.`));
    }
    return null;
  }

  if (interaction.isModalSubmit()) {
    if (id === 'sc_give_amount') {
      const pick = picks.get(adminId) || {};
      const amount = Number(interaction.fields.getTextInputValue('amount').trim());

      if (!pick.user || !pick.item) return warn(interaction, 'Pick a member and an item first.');
      if (!Number.isInteger(amount) || amount < 1 || amount > maxAmount(pick.item)) {
        return warn(interaction, `The amount must be a whole number from 1 to ${maxAmount(pick.item)}.`);
      }

      await interaction.deferUpdate();
      return interaction.editReply(await runGive(interaction, amount));
    }

    if (id === 'sc_ann_modal') {
      const message = interaction.fields.getTextInputValue('text').replace(/\s+/g, ' ').trim();
      if (!message) return warn(interaction, 'Write the announcement first.');

      economy.setAnnouncement(message, adminId);
      return refresh(interaction, annPayload('✅ Posted. It shows at the top of /item shop.'));
    }

    if (id.startsWith('sc_sale_modal:') || id.startsWith('sc_special_modal:')) {
      const special = id.startsWith('sc_special_modal:');
      const target = id.slice(id.indexOf(':') + 1);
      const error = createDiscount(interaction, special, target);

      if (error) return warn(interaction, error);
      return refresh(interaction, discountsPayload(special, `✅ ${special ? 'Special' : 'Sale'} started.`));
    }

    if (id === 'sc_item_modal') {
      const error = await createItem(interaction);
      if (error) return warn(interaction, error);
      return refresh(interaction, itemsPayload('✅ Custom item added. It is in the shop now.'));
    }
  }

  return null;
}

module.exports = { homePayload, handle };
