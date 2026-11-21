const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const createStore = require('./jsonStore');
const { COLOR } = require('./theme');

/* =========================================================
   PING PROTECTION  (/ping prot)
   Protected = a role, or a person. Pinging a protected role, a protected
   person, or anyone who has a protected role gets the message deleted and
   the sender timed out (auto mod does that, see utils/autoMod.js).
========================================================= */

// data/ping_prot.json: { roles: [id], users: [id] }
const store = createStore('ping_prot.json', { roles: [], users: [] });

const list = (key) => {
  const value = store.get(key);
  return Array.isArray(value) ? value : [];
};

const getAll = () => ({ roles: list('roles'), users: list('users') });

function add(kind, id) {
  const key = kind === 'role' ? 'roles' : 'users';
  const current = list(key);
  if (current.includes(id)) return false;
  store.set(key, [...current, id]);
  return true;
}

function remove(kind, id) {
  const key = kind === 'role' ? 'roles' : 'users';
  const current = list(key);
  if (!current.includes(id)) return false;
  store.set(key, current.filter((x) => x !== id));
  return true;
}

// What a message pinged that is protected, or null. Protected people can ping each other.
function findHits(message, { includeReplies = false, skipRoleId = null } = {}) {
  const { roles, users } = getAll();
  if (!roles.length && !users.length) return null;

  const authorId = message.author.id;
  const authorRoles = message.member?.roles?.cache;
  if (users.includes(authorId)) return null;
  if (authorRoles && roles.some((id) => authorRoles.has(id))) return null;

  const hitRoles = new Set();
  const hitUsers = new Set();

  for (const id of message.mentions.roles?.keys?.() || []) {
    if (roles.includes(id) && id !== skipRoleId) hitRoles.add(id);
  }

  const repliedId = includeReplies ? null : message.mentions.repliedUser?.id;

  for (const user of message.mentions.users.values()) {
    if (user.id === authorId) continue;

    // A reply with the reply-ping on is not a real ping unless they typed the mention too.
    if (repliedId && user.id === repliedId && !new RegExp(`<@!?${user.id}>`).test(message.content || '')) continue;

    if (users.includes(user.id)) {
      hitUsers.add(user.id);
      continue;
    }

    const member = message.mentions.members?.get(user.id);
    if (member && roles.some((id) => member.roles.cache.has(id))) hitUsers.add(user.id);
  }

  if (!hitRoles.size && !hitUsers.size) return null;
  return { roles: [...hitRoles], users: [...hitUsers] };
}

/* ---------- the panel (embed + a remove button for each) ---------- */

async function nameOf(guild, kind, id) {
  if (kind === 'role') {
    const role = guild.roles.cache.get(id) || (await guild.roles.fetch(id).catch(() => null));
    return role ? `@${role.name}` : `role ${id}`;
  }
  const member = guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
  if (member) return member.displayName;
  const user = await guild.client.users.fetch(id).catch(() => null);
  return user ? user.username : `user ${id}`;
}

async function buildPanel(guild) {
  const { roles, users } = getAll();
  const entries = [
    ...roles.map((id) => ({ kind: 'role', id })),
    ...users.map((id) => ({ kind: 'user', id })),
  ];
  const shown = entries.slice(0, 25);

  const embed = new EmbedBuilder().setColor(COLOR).setTitle('Ping Protection');

  if (!entries.length) {
    embed.setDescription('Nobody is protected yet.\nRun `/ping prot` with a role or a user to add them.');
    return { embeds: [embed], components: [] };
  }

  const parts = [];
  if (roles.length) parts.push(`**Roles**\n${roles.map((id) => `<@&${id}>`).join('\n')}`);
  if (users.length) parts.push(`**People**\n${users.map((id) => `<@${id}>`).join('\n')}`);
  parts.push(
    '-# Pinging them, the role, or anyone with the role deletes the message and times the sender out. Press a button to remove their protection.'
  );
  if (entries.length > shown.length) {
    parts.push(`-# Showing buttons for the first ${shown.length}. Remove some to see the rest.`);
  }
  embed.setDescription(parts.join('\n\n').slice(0, 4000));

  const buttons = [];
  for (const entry of shown) {
    const name = await nameOf(guild, entry.kind, entry.id);
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`pprot_rm:${entry.kind === 'role' ? 'r' : 'u'}:${entry.id}`)
        .setLabel(name.slice(0, 70))
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return { embeds: [embed], components: rows };
}

module.exports = { getAll, add, remove, findHits, buildPanel };
