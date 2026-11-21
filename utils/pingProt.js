const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  AutoModerationActionType,
} = require('discord.js');
const createStore = require('./jsonStore');
const extra = require('../extraConfig');
const { COLOR } = require('./theme');
const { BYPASS_ROLE_IDS } = require('./staffBypass');

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

const RULE_NAME = 'Ping Protection';
const MAX_RULES = 3;
const PATTERNS_PER_RULE = 10;
const PATTERN_MAX = 250;

const settings = () => ({
  timeoutMinutes: 60,
  ...((extra.autoMod || {}).pingProt || {}),
});

function packPatterns(prefix, ids) {
  const patterns = [];
  let current = [];
  const head = `<@${prefix}(?:`;
  const tail = ')>';
  for (const id of ids) {
    const next = [...current, id];
    if (head.length + next.join('|').length + tail.length > PATTERN_MAX && current.length) {
      patterns.push(head + current.join('|') + tail);
      current = [id];
    } else {
      current = next;
    }
  }
  if (current.length) patterns.push(head + current.join('|') + tail);
  return patterns;
}

async function collectTargets(guild) {
  const { roles, users } = getAll();
  const userIds = new Set(users);
  if (roles.length) {
    const members = await guild.members.fetch().catch(() => null);
    if (members) {
      for (const member of members.values()) {
        if (roles.some((id) => member.roles.cache.has(id))) userIds.add(member.id);
      }
    }
  }
  return { roleIds: [...roles], userIds: [...userIds] };
}

let syncing = null;
let syncAgain = false;

async function runSync(guild) {
  const { roleIds, userIds } = await collectTargets(guild);
  const patterns = [...packPatterns('!?', userIds), ...packPatterns('&', roleIds)];

  const fetched = await guild.autoModerationRules.fetch();
  const existing = [...fetched.values()]
    .filter((rule) => rule.creatorId === guild.client.user.id && rule.name.startsWith(RULE_NAME))
    .sort((a, b) => a.name.localeCompare(b.name));

  const chunks = [];
  for (let i = 0; i < patterns.length; i += PATTERNS_PER_RULE) {
    chunks.push(patterns.slice(i, i + PATTERNS_PER_RULE));
  }
  const usable = chunks.slice(0, MAX_RULES);
  const overflow = chunks.length > MAX_RULES;

  const cfg = settings();
  const seconds = Math.min(Math.max(Math.round((cfg.timeoutMinutes || 0) * 60), 0), 28 * 24 * 3600);
  const actions = [
    {
      type: AutoModerationActionType.BlockMessage,
      metadata: { customMessage: "You can't ping that person or role. Contact a higher up if you need them." },
    },
  ];
  if (seconds > 0) {
    actions.push({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: seconds } });
  }

  const botRole = guild.members.me?.roles?.botRole?.id;
  const exemptRoles = [
    ...new Set([botRole, ...BYPASS_ROLE_IDS, ...getAll().roles].filter((id) => /^\d{15,25}$/.test(String(id || '')))),
  ].slice(0, 20);
  const exemptChannels = ((extra.autoMod || {}).exemptChannelIds || [])
    .filter((id) => /^\d{15,25}$/.test(String(id || '')))
    .slice(0, 50);

  for (let i = 0; i < usable.length; i++) {
    const body = {
      name: `${RULE_NAME} ${i + 1}`,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: usable[i] },
      actions,
      enabled: true,
      exemptRoles,
      exemptChannels,
      reason: 'Ping protection sync',
    };
    if (existing[i]) {
      await existing[i].edit(body);
    } else {
      await guild.autoModerationRules.create(body);
    }
  }

  for (let i = usable.length; i < existing.length; i++) {
    await existing[i].delete('Ping protection sync').catch(() => {});
  }

  return { ok: true, targets: userIds.length + roleIds.length, overflow };
}

async function syncAutoMod(guild) {
  if (syncing) {
    syncAgain = true;
    await syncing.catch(() => {});
    if (!syncAgain) return syncing;
  }
  syncAgain = false;
  syncing = runSync(guild)
    .catch((err) => {
      console.error('[ping prot] auto mod sync failed:', err.message);
      const missing = /permission|access/i.test(err.message || '');
      return {
        ok: false,
        error: missing
          ? 'I need Manage Server and Moderate Members to set up auto mod.'
          : `Auto mod sync failed: ${String(err.message).slice(0, 120)}`,
      };
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

/* ---------- the panel ---------- */

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

function listBlock(title, mentions) {
  if (!mentions.length) return null;
  const lines = [];
  let used = title.length + 4;
  for (const mention of mentions) {
    if (used + mention.length + 1 > 1700) {
      lines.push(`and ${mentions.length - lines.length} more`);
      break;
    }
    lines.push(mention);
    used += mention.length + 1;
  }
  return `**${title} (${mentions.length})**\n${lines.join('\n')}`;
}

async function buildPanel(guild, status = null) {
  const { roles, users } = getAll();
  const entries = [
    ...roles.map((id) => ({ kind: 'role', id })),
    ...users.map((id) => ({ kind: 'user', id })),
  ];

  const embed = new EmbedBuilder().setColor(COLOR).setTitle('Ping Protection');

  const parts = [];
  if (!entries.length) {
    parts.push('Nobody is protected yet. Pick people or roles from the menus below.');
  } else {
    const roleBlock = listBlock('Roles', roles.map((id) => `<@&${id}>`));
    const userBlock = listBlock('People', users.map((id) => `<@${id}>`));
    if (roleBlock) parts.push(roleBlock);
    if (userBlock) parts.push(userBlock);
  }
  parts.push(
    '-# Auto mod stops the message from sending at all and times the sender out when they ping a protected person, a protected role, or anyone with a protected role. Pick up to 25 at a time.'
  );
  if (status) {
    parts.push(
      status.ok
        ? `-# Auto mod is active for ${status.targets} ping${status.targets === 1 ? '' : 's'}.${status.overflow ? ' Too many to cover, the bot still deletes the rest.' : ''}`
        : `-# ⚠️ ${status.error}`
    );
  }
  embed.setDescription(parts.join('\n\n').slice(0, 4000));

  const rows = [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('pprot_add_u')
        .setPlaceholder('Add people to protect')
        .setMinValues(1)
        .setMaxValues(25)
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('pprot_add_r')
        .setPlaceholder('Add roles to protect')
        .setMinValues(1)
        .setMaxValues(25)
    ),
  ];

  if (entries.length) {
    const shown = entries.slice(0, 25);
    const options = [];
    for (const entry of shown) {
      const name = await nameOf(guild, entry.kind, entry.id);
      options.push({
        label: name.slice(0, 90),
        description: entry.kind === 'role' ? 'Role' : 'Person',
        value: `${entry.kind === 'role' ? 'r' : 'u'}:${entry.id}`,
      });
    }
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('pprot_rm')
          .setPlaceholder(entries.length > 25 ? 'Remove protection (first 25)' : 'Remove protection')
          .setMinValues(1)
          .setMaxValues(options.length)
          .addOptions(options)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pprot_clear').setLabel('Clear all').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
      )
    );
  }

  return { embeds: [embed], components: rows };
}

module.exports = { getAll, add, remove, findHits, buildPanel, syncAutoMod };
