const extra = require('../extraConfig');

const MAX_NICK = 32;

function settings() {
  const cfg = extra.staffNicknames || {};
  return {
    enabled: cfg.enabled !== false,
    separator: cfg.separator || ' | ',
    roles: (cfg.roles || []).filter((r) => /^\d{15,25}$/.test(String(r.roleId)) && r.prefix),
  };
}

function capitalize(text) {
  return text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function stripPrefix(nick, cfg) {
  const lower = nick.toLowerCase();
  for (const { prefix } of cfg.roles) {
    const start = `${prefix}${cfg.separator}`.toLowerCase();
    if (lower.startsWith(start)) return nick.slice(start.length);
  }
  return nick;
}

function desiredNickname(member, cfg = settings()) {
  const current = member.nickname || member.user.globalName || member.user.username;
  const base = capitalize(stripPrefix(current, cfg).trim()) || member.user.username;
  const match = cfg.roles.find((r) => member.roles.cache.has(r.roleId));

  if (!match) {
    if (!member.nickname) return null;
    const plain = stripPrefix(member.nickname, cfg);
    return plain === member.nickname ? member.nickname : plain === member.user.username ? null : plain;
  }

  const head = `${match.prefix}${cfg.separator}`;
  return `${head}${base.slice(0, Math.max(1, MAX_NICK - head.length))}`;
}

async function sync(member) {
  const cfg = settings();
  if (!cfg.enabled || member.user.bot || !member.manageable) return;

  const wanted = desiredNickname(member, cfg);
  if ((wanted || null) === (member.nickname || null)) return;

  await member.setNickname(wanted, 'Staff nickname').catch((err) => {
    console.error(`[nicknames] could not rename ${member.user.tag}:`, err.message);
  });
}

module.exports = {
  name: 'staffNicknames',
  desiredNickname,

  register(client) {
    client.on('guildMemberUpdate', (oldMember, newMember) => {
      if (!oldMember.partial) {
        const before = [...oldMember.roles.cache.keys()].sort().join(',');
        const after = [...newMember.roles.cache.keys()].sort().join(',');
        if (before === after) return;
      }
      sync(newMember).catch((err) => console.error('[nicknames] failed:', err));
    });
    console.log('[nicknames] Staff nicknames follow staff roles.');
  },
};
