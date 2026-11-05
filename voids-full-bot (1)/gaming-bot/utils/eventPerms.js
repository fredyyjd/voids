const { PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');

// Who can run /event: the event manager role(s) in config.json, or anyone with
// Administrator or Manage Server. Checked again on every button, menu and modal,
// so nobody can use a forwarded or stale component to bypass it.
const DEFAULT_EVENT_ROLE_IDS = ['1563757487327543316'];

function eventRoleIds() {
  return [...new Set([...DEFAULT_EVENT_ROLE_IDS, ...(config.eventManagerRoleIds || [])])].filter(
    (id) => id && !String(id).startsWith('PUT_')
  );
}

function isEventManager(member) {
  if (!member) return false;

  const perms = member.permissions;
  if (perms?.has(PermissionFlagsBits.Administrator)) return true;
  if (perms?.has(PermissionFlagsBits.ManageGuild)) return true;

  const roles = member.roles?.cache;
  if (!roles) return false;
  return eventRoleIds().some((id) => roles.has(id));
}

module.exports = { isEventManager, eventRoleIds };
