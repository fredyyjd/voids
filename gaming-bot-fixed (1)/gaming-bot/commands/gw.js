const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isMod, hasMaxPerms } = require('../utils/permissions');
const { fail, done, NO_PERMS } = require('../utils/reply');
const { setupTotalChannel } = require('../utils/giveawayTotal');

const ROLES = {
  giveaway: '1526927249604083904', // Giveaway Ping
  drop: '1526927287486779566', // Quick Drop Ping
};

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const FILE = path.join(DATA_DIR, 'gw-cooldowns.json');

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
    fs.writeFileSync(FILE, JSON.stringify(data));
  } catch (err) {
    console.error('[gw] could not save cooldowns:', err);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gw')
    .setDescription('Giveaway tools')
    .addSubcommand((s) =>
      s
        .setName('ping')
        .setDescription('Ping the giveaway or drop role')
        .addStringOption((o) =>
          o
            .setName('role')
            .setDescription('Which role to ping')
            .setRequired(true)
            .addChoices(
              { name: 'Giveaway', value: 'giveaway' },
              { name: 'Quick drop', value: 'drop' }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName('total')
        .setDescription('Make the total given channel')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    /* ---------- total ---------- */
    if (sub === 'total') {
      // Manage Server or max perms (Administrator) only.
      const canSetup =
        hasMaxPerms(interaction.member) ||
        interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

      if (!canSetup) return fail(interaction, NO_PERMS);

      try {
        const { channel, created } = await setupTotalChannel(interaction.guild);

        return done(
          interaction,
          created
            ? `Created ${channel}.`
            : `Already exists: ${channel}.`
        );
      } catch (err) {
        console.error('[gw] could not create total channel:', err);
        return fail(interaction, 'I couldn\'t create the channel. Make sure I have **Manage Channels**.');
      }
    }

    /* ---------- ping ---------- */
    const member = interaction.member;
    const noCooldown = member.permissions.has(PermissionFlagsBits.ManageGuild);

    if (!isMod(member) && !noCooldown) return fail(interaction, NO_PERMS);

    // 1 hour cooldown. Manage Server / Admin skip it.
    const cooldowns = load();
    if (!noCooldown) {
      const next = (cooldowns[member.id] || 0) + COOLDOWN_MS;
      if (Date.now() < next) {
        return fail(interaction, `Try again <t:${Math.floor(next / 1000)}:R>.`);
      }
    }

    const roleId = ROLES[interaction.options.getString('role')];

    await interaction.channel.send({
      content: `<@&${roleId}>`,
      allowedMentions: { roles: [roleId] },
    });

    if (!noCooldown) {
      cooldowns[member.id] = Date.now();
      save(cooldowns);
    }

    return done(interaction, 'Pinged.');
  },
};
