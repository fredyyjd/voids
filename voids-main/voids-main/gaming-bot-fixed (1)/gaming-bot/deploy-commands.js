require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Deploying ${commands.length} slash command(s)…`);

    if (GUILD_ID) {
      // Guild commands update instantly - best for development
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log(`✅ Deployed commands to guild ${GUILD_ID}`);
    } else {
      // Global commands can take up to an hour to propagate
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('✅ Deployed global commands (may take up to 1 hour to appear)');
    }
  } catch (err) {
    console.error('Failed to deploy commands:', err);
  }
})();
