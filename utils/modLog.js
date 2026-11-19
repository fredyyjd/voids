// Mod-action channel logging disabled.
// Kept as a no-op so ban/kick/mute/warn/lockdown and messageCreate still load.
async function logModAction() {}

module.exports = { logModAction };
