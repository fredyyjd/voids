const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { isMod } = require('../utils/permissions');
const { fail, NO_PERMS } = require('../utils/reply');
const { COLOR } = require('../utils/theme');

// Channels that already have an IGN giveaway running.
const running = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

const NO_PINGS = { parse: [] };

function embed() {
  return new EmbedBuilder().setColor(COLOR);
}

// 🔒 Locked / IGN for money!
function lockedEmbed({ prize, unlocksAt }) {
  const lines = ['## IGN for money!', 'Spam your IGN when it unlocks!'];
  if (prize) lines.push(`🎁 ${prize}`);
  lines.push(`🔓 Unlocks <t:${unlocksAt}:R>`);

  return embed().setTitle('🔒 Locked').setDescription(lines.join('\n'));
}

function openEmbed({ prize, locksAt }) {
  const lines = ['## IGN for money!', '# SPAM YOUR IGN!'];
  if (prize) lines.push(`🎁 ${prize}`);
  lines.push(`🔒 Locks <t:${locksAt}:R>`);

  return embed().setTitle('🔓 Unlocked').setDescription(lines.join('\n'));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ign')
    .setDescription('IGN giveaways')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('giveaway')
        .setDescription('Lock this channel, then unlock it so everyone spams their IGN and one is picked')
        .addStringOption((o) =>
          o.setName('prize').setDescription('What the winner gets, e.g. 5m (optional)').setMaxLength(100).setRequired(false)
        )
        .addIntegerOption((o) =>
          o
            .setName('unlock_in')
            .setDescription('Seconds until the channel unlocks (default 15)')
            .setMinValue(3)
            .setMaxValue(600)
            .setRequired(false)
        )
        .addIntegerOption((o) =>
          o
            .setName('open_for')
            .setDescription('Seconds the channel stays unlocked (default 10)')
            .setMinValue(3)
            .setMaxValue(120)
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!isMod(interaction.member) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return fail(interaction, NO_PERMS);
    }

    const channel = interaction.channel;

    if (running.has(channel.id)) {
      return fail(interaction, 'An IGN giveaway is already running in this channel.');
    }

    const me = interaction.guild.members.me;
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
      return fail(interaction, 'I need the **Manage Channels** permission here so I can lock and unlock the channel.');
    }

    const prize = interaction.options.getString('prize')?.trim() || null;
    const unlockIn = interaction.options.getInteger('unlock_in') ?? 15;
    const openFor = interaction.options.getInteger('open_for') ?? 10;
    const everyone = interaction.guild.roles.everyone;
    const hostId = interaction.user.id;

    running.add(channel.id);

    try {
      // 1. lock the channel
      try {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: 'IGN giveaway' });
      } catch (err) {
        console.error('[ign] could not lock channel:', err.message);
        return fail(interaction, "I couldn't lock this channel. Check my permissions.");
      }

      // 2. 🔒 Locked / IGN for money!
      const unlocksAt = now() + unlockIn;
      await interaction.reply({ embeds: [lockedEmbed({ prize, unlocksAt })], allowedMentions: NO_PINGS });
      const msg = await interaction.fetchReply();

      await sleep(unlockIn * 1000);

      // 3. unlock and collect IGNs
      const locksAt = now() + openFor;
      let last = null; // the most recent message wins

      await channel.permissionOverwrites.edit(everyone, { SendMessages: true }, { reason: 'IGN giveaway open' });
      await msg.edit({ embeds: [openEmbed({ prize, locksAt })] }).catch(() => {});

      const collector = channel.createMessageCollector({
        time: openFor * 1000,
        filter: (m) => !m.author.bot && m.content.trim().length > 0,
      });
      collector.on('collect', (m) => {
        last = { id: m.author.id, text: m.content.trim().slice(0, 50) };
      });
      await new Promise((resolve) => collector.on('end', () => resolve()));

      // 4. lock again and send a fresh "Locked" embed
      await channel.permissionOverwrites
        .edit(everyone, { SendMessages: false }, { reason: 'IGN giveaway finished' })
        .catch((err) => console.error('[ign] could not re-lock channel:', err.message));

      await msg.edit({ embeds: [embed().setTitle('🔓 Closed').setDescription('## IGN for money!\nEntries are in.')] }).catch(() => {});

      await channel.send({ embeds: [embed().setTitle('🔒 Locked')], allowedMentions: NO_PINGS });

      if (!last) {
        return channel.send({
          embeds: [embed().setTitle('😴 No winner').setDescription('Nobody sent anything.')],
          allowedMentions: NO_PINGS,
        });
      }

      // 5. "Picked winner." animation:  .  ..  ...  .  ..  ...
      const pickedMsg = await channel.send({
        embeds: [embed().setDescription('# Picked winner.')],
        allowedMentions: NO_PINGS,
      });

      const dots = ['.', '..', '...', '.', '..', '...'];
      for (const d of dots) {
        await sleep(900);
        await pickedMsg.edit({ embeds: [embed().setDescription(`# Picked winner${d}`)] }).catch(() => {});
      }

      // 6. reveal
      const winnerId = last.id;
      const ign = last.text;

      await sleep(900);
      await pickedMsg
        .edit({ embeds: [embed().setDescription(`# <@${winnerId}>`)], allowedMentions: NO_PINGS })
        .catch(() => {});

      await sleep(1800);
      await pickedMsg
        .edit({
          embeds: [
            embed()
              .setTitle('🎉 We have a winner!')
              .setDescription(
                [
                  `## Congrats <@${winnerId}>!`,
                  'The host will pay you shortly.',
                  '',
                  `🎮 **IGN:** \`${ign || 'unknown'}\``,
                  prize ? `🎁 **Prize:** ${prize}` : null,
                  `👤 **Host:** <@${hostId}>`,
                ]
                  .filter((l) => l !== null)
                  .join('\n')
              ),
          ],
          allowedMentions: NO_PINGS,
        })
        .catch(() => {});

      // Edited messages don't notify anyone, so ping the winner once and clean it up.
      channel
        .send({ content: `<@${winnerId}> <@${hostId}>`, allowedMentions: { users: [winnerId, hostId] } })
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 1500))
        .catch(() => {});
    } catch (err) {
      console.error('[ign] giveaway crashed:', err);
      // Never leave the channel stuck locked or unlocked by accident.
      await channel.permissionOverwrites.edit(everyone, { SendMessages: false }).catch(() => {});
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: '❌ The IGN giveaway hit an error.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    } finally {
      running.delete(channel.id);
    }
  },
};
