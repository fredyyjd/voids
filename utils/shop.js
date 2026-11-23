const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MessageFlags,
  Routes,
} = require('discord.js');
const economy = require('./economy');
const { box } = require('./box');
const { COLOR } = require('./theme');
const { ITEMS, MEMBER_ROLE_ID, FOOTER } = require('./economyConfig');
const { ownsItem, grantItem, priceOf, priceText, visibleKeys, categoryOf, targetName } = require('./shopItems');

const COLOUR_KEYS = Object.keys(ITEMS).filter((k) => ITEMS[k].type === 'colour');

// An error whose message is safe to show to the person.
class ShopError extends Error {}

const label = (item) => `${item.emoji} ${item.name}`;
// Button colour for each shop colour: red = red, blue = blue, green = green, neon = grey.
const styleOf = (item) => ButtonStyle[item?.buttonStyle] ?? ButtonStyle.Secondary;

// Role mention, so the colour shows. Messages that use it send allowedMentions: { parse: [] } so nobody is pinged.
const roleTag = (item) => {
  const roleId = item.roleId || economy.shopRoles()[Object.keys(ITEMS).find((k) => ITEMS[k] === item)];
  return roleId ? `<@&${roleId}>` : `**${item.name}**`;
};
const NO_PINGS = { parse: [] };

const FOOTER_LINE = `-# ${FOOTER}`;

/* =========================================================
   COLOUR ROLES
   Created by the bot the first time they are needed, placed just
   above the Member role so the colour shows on the name.
========================================================= */

// The colour roles are set by id in economyConfig.js (roleId on each colour).
// Roles the bot made itself in the past are still known, so they get swapped out too.
const roleIdFor = (key) => ITEMS[key]?.roleId || economy.shopRoles()[key] || null;

const creating = new Map(); // item key -> promise, so two buyers never make two roles

async function createColourRole(guild, key) {
  const item = ITEMS[key];

  const memberRole =
    guild.roles.cache.get(MEMBER_ROLE_ID) || (await guild.roles.fetch(MEMBER_ROLE_ID).catch(() => null));
  if (!memberRole) throw new ShopError('The Member role could not be found, so the colour role cannot be made.');

  let role;
  try {
    role = await guild.roles.create({
      name: `Colour - ${item.name}`,
      color: item.color,
      hoist: false,
      mentionable: false,
      permissions: [],
      reason: 'Void Bucks shop colour',
    });
  } catch {
    throw new ShopError('I could not create the colour role. I need the Manage Roles permission.');
  }

  await role.setPosition(memberRole.position + 1, { reason: 'Void Bucks shop colour' }).catch(() => {});

  const placed = await guild.roles.fetch(role.id, { force: true }).catch(() => role);
  if (!placed || placed.position <= memberRole.position) {
    await role.delete('Could not place above the Member role').catch(() => {});
    throw new ShopError('My role must sit above the Member role so I can place colours there. Move my role up and try again.');
  }

  // Servers that support gradient roles get the blend. Everyone else keeps the solid colour.
  if (item.gradient) {
    const [primary, secondary, tertiary] = item.gradient;
    await guild.client.rest
      .patch(Routes.guildRole(guild.id, role.id), {
        body: {
          colors: { primary_color: primary, secondary_color: secondary, tertiary_color: tertiary },
        },
        reason: 'Void Bucks shop colour',
      })
      .catch(() => {});
  }

  economy.setShopRole(key, role.id);
  return role;
}

async function ensureColourRole(guild, key) {
  const fixedId = ITEMS[key]?.roleId;
  if (fixedId) {
    const fixed = guild.roles.cache.get(fixedId) || (await guild.roles.fetch(fixedId).catch(() => null));
    if (!fixed) throw new ShopError(`The ${ITEMS[key].name} colour role could not be found. Tell an admin.`);
    return fixed;
  }

  const savedId = economy.shopRoles()[key];
  if (savedId) {
    const existing = guild.roles.cache.get(savedId) || (await guild.roles.fetch(savedId).catch(() => null));
    if (existing) return existing;
  }

  if (!creating.has(key)) {
    const job = createColourRole(guild, key).finally(() => creating.delete(key));
    creating.set(key, job);
  }
  return creating.get(key);
}

// Puts the chosen colour on the member and takes every other shop colour off. key = null removes all.
async function wearColour(member, key) {
  const target = key ? await ensureColourRole(member.guild, key) : null;

  // Every colour role the shop has ever used (current ids + old bot-made ones).
  const allColourRoleIds = new Set(
    [...COLOUR_KEYS.map((k) => ITEMS[k].roleId), ...Object.values(economy.shopRoles())].filter(Boolean)
  );

  const remove = [...allColourRoleIds].filter((id) => id !== target?.id && member.roles.cache.has(id));

  try {
    if (remove.length) await member.roles.remove(remove, 'Void Bucks colour swap');
    if (target && !member.roles.cache.has(target.id)) await member.roles.add(target, 'Void Bucks colour');
  } catch {
    throw new ShopError('I could not change your roles. Make sure my role is above the colour roles.');
  }
}

/* =========================================================
   PURCHASING
========================================================= */

const buying = new Set();

async function purchase(interaction, key) {
  const item = ITEMS[key];
  const id = interaction.user.id;

  const fail = (text) => ({ ok: false, payload: box(['## ❌  Purchase failed', text, FOOTER_LINE]) });

  if (!item) return fail('That item is not in the shop any more.');
  if (item.soon) return fail('This item is coming soon.');
  if (economy.isHidden(key)) return fail('This item is not for sale right now.');
  if (buying.has(id)) return fail('Hold on, your last purchase is still going through.');

  buying.add(id);
  try {
    const u = economy.user(id);
    const cost = priceOf(key).price;

    if (ownsItem(id, key)) {
      return fail(
        item.type === 'colour'
          ? `You already own **${label(item)}**. Wear it from the shop or \`/inv\`.`
          : `You already own **${label(item)}**.`
      );
    }

    if (!economy.spendVb(id, cost)) {
      return fail(
        `**${label(item)}** costs **${economy.fmt(cost)}** and you only have **${economy.fmt(u.vb)}**.\n` +
          'Earn more by chatting, counting and unlocking achievements.'
      );
    }

    let note = null;

    try {
      if (item.type === 'colour') {
        await wearColour(interaction.member, key);
        u.colours.push(key);
        u.equipped = key;
        economy.touch();
      } else if (item.type === 'role') {
        const guild = interaction.guild;
        const role = guild.roles.cache.get(item.roleId) || (await guild.roles.fetch(item.roleId).catch(() => null));
        if (!role) throw new ShopError(`The ${item.name} role could not be found. Tell an admin.`);

        try {
          await interaction.member.roles.add(role, 'Void Bucks shop');
        } catch {
          throw new ShopError('I could not give you the role. Make sure my role is above it.');
        }

        u.roles.push(key);
        economy.touch();
      } else {
        const result = grantItem(id, key, 1);
        if (!result.ok) throw new ShopError("That item can't be bought yet.");
        note = result.note || null;
      }
    } catch (err) {
      economy.addVb(id, cost);
      if (!(err instanceof ShopError)) console.error('[shop] purchase failed:', err);
      return fail(`${err instanceof ShopError ? err.message : 'Something went wrong.'}\nYou were **not** charged.`);
    }

    const lines = {
      colour: [`You bought the **${label(item)}** name colour. It is on your name now.`, 'Swap or remove it any time in `/inv`.'],
      role: [`You are now a **${item.name}**. The role is on your name.`],
      badge: [`You bought the **${label(item)}**.`, 'It shows next to your name in `/achievements`.'],
      pass: [`You bought a **${label(item)}**.`, 'It is used automatically the next time you count while on cooldown.'],
      box: ['You opened a **Mystery Box** and got', `## ${note}`],
      entry: [
        item.amount > 1 ? `You bought an **${label(item)}** (${item.amount} entries).` : `You bought an **${label(item)}**.`,
        'Join a giveaway, press **Join** again and choose to use it.',
      ],
    }[item.type] || [`You bought **${label(item)}**.`];

    return {
      ok: true,
      payload: box([
        '## ✅  Purchase complete',
        lines.join('\n'),
        `**Paid:** −${economy.fmt(cost)}\n**New balance:** ${economy.fmt(economy.peek(id).vb)}`,
        FOOTER_LINE,
      ]),
    };
  } finally {
    buying.delete(id);
  }
}

/* =========================================================
   LOOKS
========================================================= */

function shopPayload() {
  const keys = visibleKeys();
  const keysOf = (test) => keys.filter((k) => test(ITEMS[k]));
  const solid = keysOf((i) => i.type === 'colour' && !i.gradient);
  const gradient = keysOf((i) => i.type === 'colour' && i.gradient);
  const perks = keysOf((i) => categoryOf(i) === 'perk');
  const more = keysOf((i) => categoryOf(i) === 'role');
  const buyable = [...perks, ...more].filter((k) => !ITEMS[k].soon);

  const text = (content) => new TextDisplayBuilder().setContent(content);
  const gap = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);
  const tags = (list) => list.map((k) => `${ITEMS[k].emoji} ${roleTag(ITEMS[k])}`).join('   ');
  const line = (k) => `${ITEMS[k].emoji}  **${ITEMS[k].name}**  ·  ${priceText(k)}\n-# ${ITEMS[k].desc}`;
  const ends = (d) => (d.endsAt ? `  ·  ends <t:${Math.floor(d.endsAt / 1000)}:R>` : '');

  const discounts = economy.activeDiscounts();
  const sales = discounts.filter((d) => !d.special);
  const specials = discounts.filter((d) => d.special && ITEMS[d.target.slice(5)] && !economy.isHidden(d.target.slice(5)));

  const button = (k) =>
    new ButtonBuilder()
      .setCustomId(`shop_item:${k}`)
      .setLabel(ITEMS[k].name)
      .setEmoji(ITEMS[k].emoji)
      .setStyle(styleOf(ITEMS[k]));

  const container = new ContainerBuilder().setAccentColor(COLOR);

  const header = [
    '# 🛒  Item Shop',
    'Spend your **VB** on perks around the server.',
    '-# Earn VB by chatting, counting and unlocking achievements.',
  ];

  if (sales.length) {
    header.push('', ...sales.map((d) => `🏷️  **${d.percent}% off ${targetName(d.target)}**${ends(d)}`));
  }

  container.addTextDisplayComponents(text(header.join('\n'))).addSeparatorComponents(gap());

  if (specials.length) {
    const lines = specials.map((d) => {
      const item = ITEMS[d.target.slice(5)];
      const now = Math.max(1, Math.round((item.price * (100 - d.percent)) / 100));
      return `${item.emoji}  **${item.name}**  ·  ~~${economy.fmt(item.price)}~~ **${economy.fmt(now)}**  (${d.percent}% off)${ends(d)}`;
    });

    container.addTextDisplayComponents(text(['### ⭐  Specials', ...lines].join('\n'))).addSeparatorComponents(gap());
  }

  const colourKeys = [...solid, ...gradient];

  if (colourKeys.length) {
    const colourLines = ['### 🎨  Name Colours'];
    if (solid.length) colourLines.push(`**Solid**  ·  ${priceText(solid[0])} each`, tags(solid));
    if (gradient.length) colourLines.push(`**Gradient**  ·  ${priceText(gradient[0])} each`, tags(gradient));
    colourLines.push('-# Own as many as you like. Only one is worn at a time.');

    container.addTextDisplayComponents(text(colourLines.join('\n')));

    for (let i = 0; i < colourKeys.length; i += 5) {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(colourKeys.slice(i, i + 5).map(button)));
    }

    container.addSeparatorComponents(gap());
  }

  if (perks.length) container.addTextDisplayComponents(text(['### 🎁  Perks', perks.map(line).join('\n')].join('\n')));
  if (more.length) container.addTextDisplayComponents(text(['### 👑  Roles & Badges', more.map(line).join('\n')].join('\n')));

  if (buyable.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('shop_select')
          .setPlaceholder('Pick a perk, role or badge to buy')
          .addOptions(
            buyable.slice(0, 25).map((k) => {
              const info = priceOf(k);
              const cost = `${economy.fmt(info.price)}${info.percent ? ` (${info.percent}% off)` : ''}`;
              return {
                label: ITEMS[k].name.slice(0, 100),
                value: k,
                description: `${cost}  ·  ${ITEMS[k].desc}`.slice(0, 100),
                emoji: ITEMS[k].emoji,
              };
            })
          )
      )
    );
  }

  container
    .addSeparatorComponents(gap())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('shop_balance').setLabel('My Balance').setEmoji('💰').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('shop_inv').setLabel('My Inventory').setEmoji('🎒').setStyle(ButtonStyle.Secondary)
      )
    )
    .addTextDisplayComponents(text(`-# ${FOOTER}`));

  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: NO_PINGS };
}

// The "are you sure?" box that opens (only for you) when you press an item.
function confirmPayload(key, userId) {
  const item = ITEMS[key];
  const u = economy.peek(userId);

  if (!item) return box('❌ That item is not in the shop any more.');

  if (economy.isHidden(key)) return box('❌ This item is not for sale right now.');

  if (item.soon) {
    return box(['## 🕒  Coming soon', `**${label(item)}**\n${item.desc}`, 'You cannot buy this yet.', FOOTER_LINE]);
  }

  if (item.type !== 'colour' && ownsItem(userId, key)) {
    return box([`## ${label(item)}`, 'You already own this.', FOOTER_LINE]);
  }

  // Already owned: offer to wear it instead of buying it again.
  if (item.type === 'colour' && u.colours.includes(key)) {
    const wearing = u.equipped === key;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`shop_equip:${key}`)
        .setLabel(wearing ? 'Wearing' : 'Wear it')
        .setEmoji(item.emoji)
        .setStyle(wearing ? ButtonStyle.Secondary : styleOf(item))
        .setDisabled(wearing)
    );
    return box(
      [`## ${label(item)}`, `You already own this colour.${wearing ? ' You are wearing it now.' : ' Only one colour can be worn at a time.'}`, FOOTER_LINE],
      { rows: [row] }
    );
  }

  const info = priceOf(key);
  const cost = info.price;
  const priceLine = info.percent
    ? `~~${economy.fmt(info.base)}~~ **${economy.fmt(cost)}** (${info.percent}% off)`
    : economy.fmt(cost);
  const afford = u.vb + 1e-9 >= cost;

  if (!afford) {
    return box([
      '## ❌  Not enough VB',
      `**${label(item)}**\n${item.desc}`,
      `**Price:** ${priceLine}\n**Your balance:** ${economy.fmt(u.vb)}\n**You need:** ${economy.fmt(cost - u.vb)} more`,
      FOOTER_LINE,
    ]);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop_buy:${key}`).setLabel('Confirm').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('shop_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  return box(
    [
      '## 🛍️  Confirm purchase',
      `**${label(item)}**\n${item.desc}`,
      `**Price:** ${priceLine}\n**Your balance:** ${economy.fmt(u.vb)}\n**After buying:** ${economy.fmt(u.vb - cost)}`,
      FOOTER_LINE,
    ],
    { rows: [row] }
  );
}

function balanceEmbed(user, member) {
  const u = economy.peek(user.id);
  return new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: member?.displayName || user.username, iconURL: user.displayAvatarURL() })
    .setTitle('💰  Balance')
    .setDescription(`## ${economy.fmt(u.vb)}`)
    .setFooter({ text: FOOTER });
}

function invPayload(user, member, notice = null) {
  const u = economy.peek(user.id);
  const owned = COLOUR_KEYS.filter((k) => u.colours.includes(k));
  const name = member?.displayName || user.username;
  const text = (content) => new TextDisplayBuilder().setContent(content);
  const gap = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);

  const container = new ContainerBuilder().setAccentColor(COLOR);

  // Header with the avatar on the right.
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        text([`# 🎒  ${name}'s Inventory`, notice ? `> ${notice}` : '-# Everything you own, in one place.'].join('\n'))
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL({ size: 128 })))
  );

  container
    .addSeparatorComponents(gap())
    .addTextDisplayComponents(
      text(
        `### 💰  Balance\n## ${economy.fmt(u.vb)}` +
          ((u.abuse?.rate ?? 1) < 1 ? `\n-# Your earn rate is at ${Math.round(u.abuse.rate * 100)}% after a VB abuse warning.` : '')
      )
    )
    .addSeparatorComponents(gap());

  // Name colours: one button per colour you own. The one you are wearing is grey.
  if (owned.length) {
    container.addTextDisplayComponents(
      text(
        [
          '### 🎨  Name Colours',
          owned.map((k) => `${ITEMS[k].emoji} ${roleTag(ITEMS[k])}${u.equipped === k ? '  ·  *wearing*' : ''}`).join('\n'),
          '-# Press a colour to wear it. Only one can be worn at a time.',
        ].join('\n')
      )
    );

    const buttons = owned.map((k) => {
      const wearing = u.equipped === k;
      return new ButtonBuilder()
        .setCustomId(`inv_equip:${k}`)
        .setLabel(wearing ? `${ITEMS[k].name}  ·  Wearing` : ITEMS[k].name)
        .setEmoji(ITEMS[k].emoji)
        .setStyle(wearing ? ButtonStyle.Secondary : styleOf(ITEMS[k]))
        .setDisabled(wearing);
    });

    if (u.equipped && ITEMS[u.equipped]) {
      buttons.push(new ButtonBuilder().setCustomId('inv_equip:none').setLabel('Remove').setEmoji('🚫').setStyle(ButtonStyle.Danger));
    }

    for (let i = 0; i < buttons.length; i += 5) {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
  } else {
    container.addTextDisplayComponents(text('### 🎨  Name Colours\nNothing yet. Grab one in `/item shop`.'));
  }

  const perkLines = [
    '### 🎁  Items',
    `🎟️  **Extra Entries:** ${u.extra || 0}`,
    `⏩  **Count Passes:** ${u.pass || 0}`,
  ];

  if ((u.roles || []).length) perkLines.push(`👑  **Roles:** ${u.roles.map((k) => ITEMS[k]?.name).filter(Boolean).join(', ')}`);
  if ((u.badges || []).length) perkLines.push(`⭐  **Badges:** ${u.badges.filter((k) => ITEMS[k]).map((k) => label(ITEMS[k])).join('  ')}`);

  perkLines.push('-# Press **Join** again on a giveaway to use an extra entry. Count passes are used for you when you count on cooldown.');

  container
    .addSeparatorComponents(gap())
    .addTextDisplayComponents(text(perkLines.join('\n')))
    .addTextDisplayComponents(text(`-# ${FOOTER}`));

  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: NO_PINGS };
}

// Wear (or remove) a colour from /inv.
async function equip(interaction, value) {
  const id = interaction.user.id;
  const u = economy.user(id);

  if (value === 'none') {
    await wearColour(interaction.member, null);
    u.equipped = null;
    economy.touch();
    return 'Colour removed.';
  }

  if (!u.colours.includes(value) || !ITEMS[value]) throw new ShopError('You do not own that colour.');
  await wearColour(interaction.member, value);
  u.equipped = value;
  economy.touch();
  return `You are now wearing **${label(ITEMS[value])}**.`;
}

module.exports = {
  ShopError,
  purchase,
  equip,
  shopPayload,
  confirmPayload,
  invPayload,
  balanceEmbed,
};
