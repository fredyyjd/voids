const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

/* =========================================================
   GIVEAWAY TOTAL

   /gw total creates a voice channel called "Total Given: 0m".
   Every giveaway that gets made adds its prize to the running
   total and the channel name is updated, e.g. 40m -> 900m and
   then +100m -> 1b.

   data file: { [guildId]: { channelId, total } }
   total is stored as a plain number (40m = 40000000).
========================================================= */

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const FILE = path.join(DATA_DIR, 'giveaway-total.json');

const MULTIPLIERS = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

// Biggest first so the first match is the right unit.
const UNITS = [
  [1e12, 't'],
  [1e9, 'b'],
  [1e6, 'm'],
  [1e3, 'k'],
];

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[giveaway-total] could not save:', err);
  }
}


/* =========================================================
   AMOUNT HELPERS
========================================================= */

// "40m", "$1.5b", "1,500k", "3m Donut SMP" -> { value, rest }.
// The prize has to START with an amount and a k/m/b/t letter, so
// prizes like "5 spawners" don't get counted as money.
function parseAmount(text) {
  const match = String(text || '')
    .trim()
    .match(/^\$?\s*(\d[\d,]*(?:\.\d+)?)\s*([kmbt])(?![a-z])/i);

  if (!match) return null;

  const number = parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;

  return {
    value: Math.round(number * MULTIPLIERS[match[2].toLowerCase()]),
    rest: String(text).trim().slice(match[0].length).trim(),
  };
}

// 0 -> "0m", 40000000 -> "40m", 1000000000 -> "1b", 1500000000 -> "1.5b"
function formatAmount(value) {
  if (!value || value <= 0) return '0m';

  for (const [size, letter] of UNITS) {
    const rounded = Math.round((value / size) * 100) / 100;
    if (rounded >= 1) return `${rounded}${letter}`;
  }

  return String(Math.round(value));
}

// "40m" -> "20m", "3m Donut SMP" -> "1.5m Donut SMP"
function halfOfPrize(prize) {
  const parsed = parseAmount(prize);
  if (!parsed) return `${prize} (half)`;
  return `${formatAmount(parsed.value / 2)}${parsed.rest ? ` ${parsed.rest}` : ''}`;
}

function channelName(total) {
  return `Total Given: ${formatAmount(total)}`;
}


/* =========================================================
   CHANNEL UPDATING
   Discord only lets a channel be renamed twice every 10
   minutes, so rapid giveaways are batched into one rename.
========================================================= */

const pending = new Map();

async function applyName(client, guildId) {
  const entry = load()[guildId];
  if (!entry) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(entry.channelId).catch(() => null);
  if (!channel) return;

  const name = channelName(entry.total);
  if (channel.name === name) return;

  await channel.setName(name, 'Giveaway total updated').catch((err) => {
    console.error('[giveaway-total] could not rename channel:', err.message);
  });
}

function scheduleRename(client, guildId) {
  clearTimeout(pending.get(guildId));

  pending.set(
    guildId,
    setTimeout(() => {
      pending.delete(guildId);
      applyName(client, guildId).catch(() => {});
    }, 2000)
  );
}


/* =========================================================
   PUBLIC API
========================================================= */

// Called whenever a giveaway is made. Does nothing if /gw total
// hasn't been set up in that server, or if the prize isn't an amount.
function addGiveawayPrize(client, guildId, prize) {
  if (!guildId) return null;

  const parsed = parseAmount(prize);
  if (!parsed) return null;

  const data = load();
  const entry = data[guildId];
  if (!entry) return null;

  entry.total = (entry.total || 0) + parsed.value;
  save(data);
  scheduleRename(client, guildId);

  return entry.total;
}

// /gw total. Creates the voice channel (or fixes it up if it already exists).
async function setupTotalChannel(guild) {
  const data = load();
  const existing = data[guild.id];

  if (existing) {
    const channel = await guild.channels.fetch(existing.channelId).catch(() => null);
    if (channel) {
      await applyName(guild.client, guild.id);
      return { channel, created: false };
    }
  }

  // Keep the running total if the channel was deleted and is being remade.
  const total = existing?.total || 0;

  const channel = await guild.channels.create({
    name: channelName(total),
    type: ChannelType.GuildVoice,
    reason: 'Giveaway total tracker',
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.Connect],
      },
    ],
  });

  data[guild.id] = { channelId: channel.id, total };
  save(data);

  return { channel, created: true };
}

module.exports = {
  parseAmount,
  formatAmount,
  halfOfPrize,
  addGiveawayPrize,
  setupTotalChannel,
};
