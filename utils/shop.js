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

const COLOUR_KEYS = Object.keys(ITEMS).filter((k) => ITEMS[k].type === 'colour');

// An error whose message is safe to show to the person.
class ShopError extends Error {}

const label = (item) => `${item.emoji} ${item.name}`;
// Button colour for each shop colour: red = red, blue = blue, green = green, neon = grey.
const styleOf = (item) => ButtonStyle[item?.buttonStyle] ?? ButtonStyle.Secondary;

// Role mention, so the colour shows. Messages that use it send allowedMentions: { parse: [] } so nobody is pinged.
const roleTag = (item) => (item.roleId ? `<@&${item.roleId}>` : `**${item.name}**`);
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

// Returns { ok, payload }.
async function purchase(interaction, key) {
  const item = ITEMS[key];
  const id = interaction.user.id;

  const fail = (text) => ({ ok: false, payload: box(['## ❌  Purchase failed', text, FOOTER_LINE]) });

  if (!item) return fail('That item is not in the shop any more.');
  if (buying.has(id)) return fail('Hold on, your last purchase is still going through.');

  buying.add(id);
  try {
    const u = economy.user(id);

    if (item.type === 'colour' && u.colours.includes(key)) {
      return fail(`You already own **${label(item)}**. Wear it from the shop or \`/inv\`.`);
    }

    // Take the VB first. If anything goes wrong afterwards it is given back.
    if (!economy.spendVb(id, item.price)) {
      return fail(
        `**${label(item)}** costs **${economy.fmt(item.price)}** and you only have **${economy.fmt(u.vb)}**.\n` +
          'Earn more by chatting, counting and unlocking achievements.'
      );
    }

    try {
      if (item.type === 'colour') {
        await wearColour(interaction.member, key);
        u.colours.push(key);
        u.equipped = key;
        economy.touch();
      } else if (item.type === 'entry') {
        economy.addExtra(id, 1);
      }
    } catch (err) {
      economy.addVb(id, item.price);
      if (!(err instanceof ShopError)) console.error('[shop] purchase failed:', err);
      return fail(`${err instanceof ShopError ? err.message : 'Something went wrong.'}\nYou were **not** charged.`);
    }

    const lines =
      item.type === 'colour'
        ? [`You bought the **${label(item)}** name colour. It is on your name now.`, 'Swap or remove it any time in `/inv`.']
        : [`You bought an **${label(item)}**.`, 'Join a giveaway, press **Join** again and choose to use it.'];

    return {
      ok: true,
      payload: box([
        '## ✅  Purchase complete',
        lines.join('\n'),
        `**Paid:** −${economy.fmt(item.price)}\n**New balance:** ${economy.fmt(economy.peek(id).vb)}`,
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
  const colours = COLOUR_KEYS.map((k) => ITEMS[k]);
  const entry = ITEMS.extra_entry;
  const text = (content) => new TextDisplayBuilder().setContent(content);
  const gap = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);

  const container = new ContainerBuilder().setAccentColor(COLOR);

  container
    .addTextDisplayComponents(
      text(
        [
          '# 🛒  Item Shop',
          'Welcome in! Spend your **VB** on perks around the server.',
          'You earn VB by chatting, counting and unlocking achievements.',
        ].join('\n')
      )
    )
    .addSeparatorComponents(gap())
    .addTextDisplayComponents(
      text(
        [
          `### 🎨  Name Colours  ·  ${economy.fmt(colours[0].price)} each`,
          colours.map((c) => `${c.emoji} ${roleTag(c)}`).join('   '),
          '-# Make your name stand out. You can own them all, but only one is worn at a time.',
        ].join('\n')
      )
    );

  // Up to 5 buttons fit in one row.
  for (let i = 0; i < colours.length; i += 5) {
    const row = new ActionRowBuilder().addComponents(
      colours
        .slice(i, i + 5)
        .map((c) =>
          new ButtonBuilder()
            .setCustomId(`shop_item:${Object.keys(ITEMS).find((k) => ITEMS[k] === c)}`)
            .setLabel(c.name)
            .setEmoji(c.emoji)
            .setStyle(styleOf(c))
        )
    );
    container.addActionRowComponents(row);
  }

  container
    .addSeparatorComponents(gap())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            [
              `### ${entry.emoji}  ${entry.name}  ·  ${economy.fmt(entry.price)}`,
              'Already in a giveaway? Press **Join** again to use it and double your chance on that giveaway.',
            ].join('\n')
          )
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId('shop_item:extra_entry')
            .setLabel('Extra Entry')
            .setEmoji(entry.emoji)
            .setStyle(ButtonStyle.Primary)
        )
    )
    .addSeparatorComponents(gap())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('shop_balance').setLabel('My Balance').setEmoji('💰').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('shop_inv').setLabel('My Inventory').setEmoji('🎒').setStyle(ButtonStyle.Secondary)
      )
    )
    .addTextDisplayComponents(text(`-# More items coming soon  ·  ${FOOTER}`));

  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: NO_PINGS };
}

// The "are you sure?" box that opens (only for you) when you press an item.
function confirmPayload(key, userId) {
  const item = ITEMS[key];
  const u = economy.peek(userId);

  if (!item) return box('❌ That item is not in the shop any more.');

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

  const afford = u.vb + 1e-9 >= item.price;

  if (!afford) {
    return box([
      '## ❌  Not enough VB',
      `**${label(item)}**\n${item.desc}`,
      `**Price:** ${economy.fmt(item.price)}\n**Your balance:** ${economy.fmt(u.vb)}\n**You need:** ${economy.fmt(item.price - u.vb)} more`,
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
      `**Price:** ${economy.fmt(item.price)}\n**Your balance:** ${economy.fmt(u.vb)}\n**After buying:** ${economy.fmt(u.vb - item.price)}`,
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
    .addTextDisplayComponents(text(`### 💰  Balance\n## ${economy.fmt(u.vb)}`))
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

  container
    .addSeparatorComponents(gap())
    .addTextDisplayComponents(
      text(
        [
          '### 🎟️  Extra Giveaway Entries',
          u.extra ? `**${u.extra}**\n-# Press **Join** again on a giveaway you are in to use one.` : 'None yet. Grab one in `/item shop`.',
        ].join('\n')
      )
    )
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
