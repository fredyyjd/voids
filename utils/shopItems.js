const economy = require('./economy');
const { ITEMS, BOX_PRIZES } = require('./economyConfig');

const OWNED_FIELD = { colour: 'colours', role: 'roles', badge: 'badges' };
const COUNTABLE = ['entry', 'pass', 'box'];

const giveableKeys = () => Object.keys(ITEMS).filter((key) => !ITEMS[key].soon);

const categoryOf = (item) => {
  if (item.type === 'colour') return 'colour';
  if (['entry', 'pass', 'box'].includes(item.type)) return 'perk';
  return 'role';
};

const CATEGORY_NAMES = { colour: 'name colours', perk: 'perks', role: 'roles and badges' };

const targetName = (target) => {
  if (target === 'all') return 'everything in the shop';
  if (target.startsWith('cat:')) return CATEGORY_NAMES[target.slice(4)] || target;
  const item = ITEMS[target.slice(5)];
  return item ? `${item.emoji} ${item.name}` : target;
};

const visibleKeys = () => Object.keys(ITEMS).filter((key) => !economy.isHidden(key));

function priceOf(key) {
  const item = ITEMS[key];
  const base = item.price;
  const category = categoryOf(item);

  const matching = economy
    .activeDiscounts()
    .filter((d) => d.target === 'all' || d.target === `cat:${category}` || d.target === `item:${key}`)
    .sort((a, b) => b.percent - a.percent || Number(Boolean(b.special)) - Number(Boolean(a.special)));

  const best = matching[0];
  if (!best) return { base, price: base, percent: 0, special: false, endsAt: null };

  return {
    base,
    price: Math.max(1, Math.round((base * (100 - best.percent)) / 100)),
    percent: best.percent,
    special: Boolean(best.special),
    endsAt: best.endsAt || null,
  };
}

function priceText(key) {
  const item = ITEMS[key];
  if (item.soon) return 'Coming soon';

  const info = priceOf(key);
  if (!info.percent) return economy.fmt(info.base);

  return `~~${economy.fmt(info.base)}~~ **${economy.fmt(info.price)}** (${info.percent}% off)`;
}

function itemLabel(key) {
  const item = ITEMS[key];
  if (!item) return key;
  if (item.type === 'colour') return `${item.emoji} ${item.name} colour`;
  if (item.type === 'role') return `${item.emoji} ${item.name} role`;
  return `${item.emoji} ${item.name}`;
}

function ownsItem(userId, key) {
  const item = ITEMS[key];
  const field = item && OWNED_FIELD[item.type];
  if (!field) return false;
  return (economy.peek(userId)[field] || []).includes(key);
}

function openBox(userId) {
  const total = BOX_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  let roll = Math.random() * total;
  const prize = BOX_PRIZES.find((entry) => (roll -= entry.weight) < 0) || BOX_PRIZES[0];
  const u = economy.user(userId);

  if (prize.colour) {
    const free = Object.keys(ITEMS).filter((key) => ITEMS[key].type === 'colour' && !u.colours.includes(key));

    if (free.length) {
      const key = free[Math.floor(Math.random() * free.length)];
      u.colours.push(key);
      economy.touch();
      return `the **${itemLabel(key)}**`;
    }

    economy.addVb(userId, 50);
    return `**${economy.fmt(50)}**`;
  }

  if (prize.entries) {
    economy.addExtra(userId, prize.entries);
    return `**${prize.entries}× ${ITEMS.extra_entry.emoji} ${ITEMS.extra_entry.name}**`;
  }

  if (prize.pass) {
    u.pass = (u.pass || 0) + prize.pass;
    economy.touch();
    return `**${prize.pass}× ${ITEMS.count_pass.emoji} ${ITEMS.count_pass.name}**`;
  }

  economy.addVb(userId, prize.vb);
  return prize.jackpot ? `**${economy.fmt(prize.vb)}** (jackpot!)` : `**${economy.fmt(prize.vb)}**`;
}

function grantItem(userId, key, amount = 1) {
  const item = ITEMS[key];
  if (!item || item.soon) return { ok: false };

  const u = economy.user(userId);

  if (item.type === 'entry') {
    economy.addExtra(userId, (item.amount || 1) * amount);
    return { ok: true };
  }

  if (item.type === 'pass') {
    u.pass = (u.pass || 0) + amount;
    economy.touch();
    return { ok: true };
  }

  if (item.type === 'box') {
    const results = [];
    for (let i = 0; i < amount; i += 1) results.push(openBox(userId));
    return { ok: true, note: results.join(', ') };
  }

  const field = OWNED_FIELD[item.type];

  if (field) {
    if (u[field].includes(key)) {
      economy.addVb(userId, item.price);
      return { ok: true, refunded: item.price };
    }

    u[field].push(key);
    economy.touch();
    return { ok: true, addRole: item.type === 'role' ? item.roleId : null };
  }

  return { ok: false };
}

async function applyRole(guild, userId, roleId) {
  if (!guild || !roleId) return false;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;

  try {
    await member.roles.add(roleId, 'Void Bucks shop');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  COUNTABLE,
  giveableKeys,
  visibleKeys,
  categoryOf,
  targetName,
  priceOf,
  priceText,
  itemLabel,
  ownsItem,
  openBox,
  grantItem,
  applyRole,
};
