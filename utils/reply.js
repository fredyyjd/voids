const { box, priv } = require('./box');

// Short, consistent answers: a flat grey box, no side line.
const fail = (interaction, text) => interaction.reply(priv(box(`❌ ${text}`)));
const done = (interaction, text) => interaction.reply(priv(box(`✅ ${text}`)));
const say = (interaction, text) => interaction.reply(box(text));

const NO_PERMS = "You can't use this command.";

module.exports = { fail, done, say, NO_PERMS };
