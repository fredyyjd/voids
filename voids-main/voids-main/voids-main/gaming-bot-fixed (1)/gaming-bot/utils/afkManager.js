const fs = require('fs');
const path = require('path');
const { box } = require('./box');

const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'afk.json');

const PREFIX = 'AFK | ';

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

let data = load();

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[afk] failed to save:', err.message);
  }
}

const key = (guildId, userId) => `${guildId}:${userId}`;

// Called by /afk. Renames the member to "AFK | name" and remembers the old nickname.
async function setAfk(member, reason) {
  const k = key(member.guild.id, member.id);
  const existing = data[k];

  if (existing) {
    existing.reason = reason;
    save();
    return existing;
  }

  const entry = {
    reason,
    since: Date.now(),
    originalNick: member.nickname ?? null,
    renamed: false,
  };

  if (!member.displayName.startsWith(PREFIX)) {
    entry.renamed = await member
      .setNickname(`${PREFIX}${member.displayName}`.slice(0, 32), 'went afk')
      .then(() => true)
      .catch(() => false); // owner / higher role / missing perms
  }

  data[k] = entry;
  save();
  return entry;
}

async function clearAfk(message) {
  const k = key(message.guild.id, message.author.id);
  const entry = data[k];
  if (!entry) return null;

  delete data[k];
  save();

  if (entry.renamed) {
    const member =
      message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));

    // only undo it if they didn't change their name in the meantime
    if (member?.nickname?.startsWith(PREFIX)) {
      await member.setNickname(entry.originalNick ?? null, 'afk removed').catch(() => {});
    }
  }

  return entry;
}

// messageCreate hook: removes afk when the person types, answers pings to afk people.
async function handleAfk(message) {
  if (!message.guild || message.author.bot) return;

  // 1. the author came back
  if (data[key(message.guild.id, message.author.id)]) {
    await clearAfk(message);

    const notice = await message.channel
      .send({
        ...box(`welcome back <@${message.author.id}>, i removed your afk`),
        allowedMentions: { parse: [] },
      })
      .catch(() => null);

    if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000);
    return; // they can't be pinging themselves into a notice right now
  }

  // 2. somebody pinged an afk person
  if (!message.mentions.users.size) return;

  const parts = [];

  for (const user of message.mentions.users.values()) {
    if (user.bot || user.id === message.author.id) continue;

    const entry = data[key(message.guild.id, user.id)];
    if (!entry) continue;

    const ts = Math.floor(entry.since / 1000);
    parts.push(
      [
        `hey <@${message.author.id}>, **<@${user.id}>** is afk`,
        `Reason: ${entry.reason}`,
        `-# last seen <t:${ts}:R>`,
      ].join('\n')
    );

    if (parts.length >= 3) break;
  }

  if (!parts.length) return;

  await message
    .reply({
      ...box(parts),
      allowedMentions: { parse: [], repliedUser: false },
    })
    .catch(() => {});
}

module.exports = { setAfk, handleAfk };
