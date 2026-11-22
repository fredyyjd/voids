const { EmbedBuilder } = require('discord.js');
const economy = require('./economy');
const { ACHIEVEMENT_REWARD, FOOTER } = require('./economyConfig');

// stat: which counter unlocks it (msgs = chat messages, counts = numbers counted)
const MESSAGE_STEPS = [
  [100, 'Chatter'],
  [200, 'Regular'],
  [300, 'Talkative'],
  [400, 'Social Butterfly'],
  [500, 'Server Voice'],
  [600, 'Voice of the Void'],
];
const COUNT_STEPS = [
  [10, 'Counting Rookie'],
  [25, 'Number Cruncher'],
  [50, 'Counting Pro'],
  [100, 'Century Counter'],
  [250, 'Math Wizard'],
  [500, 'Counting Master'],
  [1000, 'Counting Legend'],
];

const ACHIEVEMENTS = [
  { key: 'first_message', stat: 'msgs', need: 1, group: 'Chat', icon: '💬', name: 'First Words', desc: 'Send your first message in the server' },
  ...MESSAGE_STEPS.map(([n, name]) => ({
    key: `msgs_${n}`, stat: 'msgs', need: n, group: 'Chat', icon: '✉️', name, desc: `Send ${n} messages in the server`,
  })),
  { key: 'first_count', stat: 'counts', need: 1, group: 'Counting', icon: '🔢', name: 'First Count', desc: 'Count your first number in the counting channel' },
  ...COUNT_STEPS.map(([n, name]) => ({
    key: `counts_${n}`, stat: 'counts', need: n, group: 'Counting', icon: '🔢', name, desc: `Count ${n} numbers in the counting channel`,
  })),
];

// Call after raising a counter. Pays out and returns the achievements just unlocked.
function unlock(userId, stat) {
  const u = economy.user(userId);
  const earned = [];

  for (const def of ACHIEVEMENTS) {
    if (def.stat !== stat || u.ach[def.key] || (u[stat] || 0) < def.need) continue;
    u.ach[def.key] = Date.now();
    earned.push(def);
  }

  if (earned.length) economy.addVb(userId, earned.length * ACHIEVEMENT_REWARD);
  return earned;
}

function unlockedEmbed(user, def) {
  return new EmbedBuilder()
    .setColor(0xfacc15)
    .setAuthor({ name: 'Achievement Unlocked' })
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(
      [
        `## ${def.icon} ${def.name}`,
        `<@${user.id}> ${def.desc.charAt(0).toLowerCase()}${def.desc.slice(1)}.`,
        '',
        `> **Reward:** +${economy.fmt(ACHIEVEMENT_REWARD)}`,
      ].join('\n')
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

// Posts one embed per achievement, pinging the person.
async function announce(channel, user, defs) {
  for (const def of defs) {
    await channel
      .send({
        content: `<@${user.id}>`,
        embeds: [unlockedEmbed(user, def)],
        allowedMentions: { users: [user.id] },
      })
      .catch((err) => console.error('[achievements] could not announce:', err.message));
  }
}

module.exports = { ACHIEVEMENTS, unlock, announce, unlockedEmbed };
