const { PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');

// "Max perms": anyone with the Administrator permission (the server owner
// always has it). They pass every staff check below EXCEPT /ban, which uses
// isAdminRole (the configured Admin role only).
function hasMaxPerms(member) {
  return !!member?.permissions?.has(PermissionFlagsBits.Administrator);
}

function isAdminRole(member) {
  if (!member) return false;

  return (config.adminRoleIds || []).some(
    (roleId) =>
      roleId &&
      !roleId.startsWith('PUT_') &&
      member.roles.cache.has(roleId)
  );
}

function isAdmin(member) {
  return hasMaxPerms(member) || isAdminRole(member);
}

function isSupport(member) {
  if (!member) return false;
  if (hasMaxPerms(member)) return true;

  return (config.supportRoleIds || []).some(
    (roleId) =>
      roleId &&
      !roleId.startsWith('PUT_') &&
      member.roles.cache.has(roleId)
  );
}

// Extra roles that count as mods (can use the mod commands).
const EXTRA_MOD_ROLE_IDS = ['1526936584253997146'];

function isMod(member) {
  if (!member) return false;

  if (EXTRA_MOD_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId))) return true;

  if ((config.modUserIds || []).includes(member.id)) return true;
  if (hasMaxPerms(member)) return true;

  return (config.modRoleIds || []).some(
    (roleId) =>
      roleId &&
      !roleId.startsWith('PUT_') &&
      member.roles.cache.has(roleId)
  );
}

/**
 * Checks whether a moderator is allowed to moderate a target.
 *
 * A moderator:
 * - cannot moderate themselves
 * - cannot moderate the server owner
 * - cannot moderate someone with an equal or higher highest role
 */
function canModerate(moderator, target) {
  if (!moderator || !target) return false;

  // Cannot moderate yourself
  if (moderator.id === target.id) return false;

  // Cannot moderate the server owner
  if (target.guild.ownerId === target.id) return false;

  // Target must be BELOW the moderator's highest role
  return moderator.roles.highest.position > target.roles.highest.position;
}

module.exports = {
  isAdmin,
  isAdminRole,
  hasMaxPerms,
  isSupport,
  isMod,
  canModerate,
};
