require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Partials, Options } = require('discord.js');

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],

  // Small caches keep memory low. Nothing here reads voice, presences, reactions,
  // invites, bans or stages, so those are not cached at all.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 25,
    GuildMemberManager: {
      maxSize: 100,
      keepOverLimit: (member) => member.id === member.client.user.id,
    },
    UserManager: {
      maxSize: 100,
      keepOverLimit: (user) => user.id === user.client.user.id,
    },
    VoiceStateManager: 0,
    PresenceManager: 0,
    ReactionManager: 0,
    GuildInviteManager: 0,
    GuildBanManager: 0,
    StageInstanceManager: 0,
    ThreadMemberManager: 0,
  }),

  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 300, lifetime: 1800 },
  },

  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
});

function jsFiles(dir) {
  const full = path.join(__dirname, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith('.js')).map((f) => path.join(full, f));
}

// Commands
client.commands = new Collection();

for (const file of jsFiles('commands')) {
  try {
    const command = require(file);
    if (command?.data?.name && typeof command.execute === 'function') {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`[commands] skipped ${path.basename(file)}: missing data or execute`);
    }
  } catch (err) {
    console.error(`[commands] failed to load ${path.basename(file)}:`, err);
  }
}

// Events. A file either exports register(client) or { name, once?, execute }.
for (const file of jsFiles('events')) {
  const name = path.basename(file);

  try {
    const event = require(file);

    if (typeof event.register === 'function') {
      event.register(client);
    } else if (event.name && typeof event.execute === 'function') {
      const bind = event.once ? 'once' : 'on';
      client[bind](event.name, (...args) => event.execute(...args, client));
    } else {
      console.warn(`[events] skipped ${name}: missing name or execute`);
    }
  } catch (err) {
    console.error(`[events] failed to load ${name}:`, err);
  }
}

console.log(`loaded ${client.commands.size} commands`);

// A stray rejected promise should be logged, not crash and restart the bot.
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

client.login(process.env.DISCORD_TOKEN);
