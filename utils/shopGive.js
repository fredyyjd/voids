const economy = require('./economy');
const { ITEMS } = require('./economyConfig');
const { COUNTABLE, itemLabel, ownsItem, grantItem, applyRole } = require('./shopItems');

const MAX_VB = 100;
const MAX_ITEMS = 10;

const TIPS = {
  colour: 'They can wear it from `/inv`.',
  role: 'The role was added to them.',
  badge: 'It shows next to their name in `/achievements`.',
  pass: 'It is used for them when they count while on cooldown.',
  entry: 'They use it by pressing **Join** again on a giveaway they are in.',
};

const needsAmount = (key) => key === 'vb' || COUNTABLE.includes(ITEMS[key]?.type);

const maxAmount = (key) => (key === 'vb' ? MAX_VB : MAX_ITEMS);

async function giveItem({ guild, targetId, key, amount = 1 }) {
  if (key === 'vb') {
    if (amount < 1 || amount > MAX_VB) return { ok: false, error: `You can give ${MAX_VB} VB at most at once.` };

    economy.addVb(targetId, amount);

    return {
      ok: true,
      given: economy.fmt(amount),
      tip: `New balance: ${economy.fmt(economy.peek(targetId).vb)}`,
    };
  }

  const item = ITEMS[key];
  if (!item || item.soon) return { ok: false, error: 'That item is not in the shop any more.' };

  if (ownsItem(targetId, key)) return { ok: false, error: `They already own ${itemLabel(key)}.` };

  const countable = COUNTABLE.includes(item.type);
  if (countable && (amount < 1 || amount > MAX_ITEMS)) {
    return { ok: false, error: `You can give ${MAX_ITEMS} of an item at most at once.` };
  }

  const count = countable ? amount : 1;
  const result = grantItem(targetId, key, count);
  if (!result.ok) return { ok: false, error: "That item can't be given yet." };

  let roleAdded = true;
  if (result.addRole) roleAdded = await applyRole(guild, targetId, result.addRole);

  let tip = TIPS[item.type] || '';
  if (item.type === 'box') tip = `The box was opened and they got ${result.note}.`;
  else if (item.type === 'role' && !roleAdded) tip = 'The role could not be added. Check my role is above it.';

  return {
    ok: true,
    given: count > 1 ? `${count}× ${itemLabel(key)}` : itemLabel(key),
    tip,
  };
}

module.exports = { MAX_VB, MAX_ITEMS, needsAmount, maxAmount, giveItem };
