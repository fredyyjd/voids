const cfg = require('./staffConfig');

const BYPASS_ROLE_IDS = Object.freeze([...cfg.bypassRoleIds]);

function hasBypassRole(member) {
  const roles = member?.roles?.cache;
  if (!roles || typeof roles.has !== 'function') return false;
  return BYPASS_ROLE_IDS.some((id) => roles.has(id));
}

// Resolves the member when the message / event only carried a partial one.
async function isBypassUser(guild, userId, member = null) {
  if (!guild || !userId) return false;
  if (hasBypassRole(member)) return true;
  if (member?.roles?.cache?.size) return false;

  const fetched = await guild.members.fetch(userId).catch(() => null);
  return hasBypassRole(fetched);
}

module.exports = { BYPASS_ROLE_IDS, hasBypassRole, isBypassUser };
