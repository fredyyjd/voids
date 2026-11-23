const { ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const economy = require('./economy');
const { box } = require('./box');
const { FOOTER } = require('./economyConfig');
const { openBox } = require('./shopItems');

const EPHEMERAL = MessageFlags.Ephemeral;
const running = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FRAMES = [
  ['📦', '.'],
  ['🎁', '..'],
  ['✨', '...'],
  ['📦', '.'],
  ['🎁', '..'],
  ['💫', '...'],
  ['🎰', '.'],
  ['🎁', '..'],
  ['🌟', '...'],
];

const boxesOf = (userId) => economy.peek(userId).boxes || 0;
const plural = (n) => `${n} Mystery Box${n === 1 ? '' : 'es'}`;

const openRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mbox_open').setLabel('Open').setEmoji('📦').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('mbox_wait').setLabel('Wait').setEmoji('⏳').setStyle(ButtonStyle.Secondary)
  );

function offerPayload(userId) {
  const n = boxesOf(userId);

  return box(
    [
      '# 📦  Your Mystery Box is here',
      `You have **${plural(n)}**. Open it now, or wait and open it later.`,
      '-# Waiting is fine. It stays in your `/inv` and you can open it there any time.',
      `-# ${FOOTER}`,
    ],
    { rows: [openRow()] }
  );
}

const waitPayload = (userId) =>
  box([
    '# ⏳  Saved for later',
    `Your **${plural(boxesOf(userId))}** ${boxesOf(userId) === 1 ? 'is' : 'are'} safe in your inventory.`,
    'Open it any time from `/inv`, next to Mystery Boxes.',
    `-# ${FOOTER}`,
  ]);

const frame = (emoji, dots) => box([`# ${emoji}  Opening your Mystery Box${dots}`, `-# ${FOOTER}`]);

function revealPayload(prize, left) {
  const rows = left > 0 ? [openRow()] : [];

  return box(
    [
      '# 🎉  Mystery Box opened',
      'You got',
      `## ${prize}`,
      left > 0 ? `You still have **${plural(left)}**. Open another?` : null,
      `-# ${FOOTER}`,
    ],
    { rows }
  );
}

// Sends the "open it now or wait" DM. Returns false when the DM could not be sent.
async function offer(client, userId) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(offerPayload(userId));
    return true;
  } catch {
    return false;
  }
}

// Takes one box, picks the prize, and plays the animation through edit().
async function play(edit, userId) {
  if (running.has(userId)) return { ok: false, reason: 'busy' };
  if (boxesOf(userId) < 1) return { ok: false, reason: 'none' };

  running.add(userId);

  try {
    const u = economy.user(userId);
    u.boxes -= 1;
    economy.touch();

    const prize = openBox(userId);

    for (const [emoji, dots] of FRAMES) {
      await edit(frame(emoji, dots)).catch(() => {});
      await sleep(900);
    }

    await edit(revealPayload(prize, boxesOf(userId))).catch((err) => {
      console.error('[mystery box] could not show the prize:', err.message);
    });

    return { ok: true, prize };
  } finally {
    running.delete(userId);
  }
}

async function handle(interaction) {
  const id = interaction.customId;
  const userId = interaction.user.id;

  // Open pressed on the DM.
  if (id === 'mbox_open') {
    await interaction.deferUpdate();
    const result = await play((payload) => interaction.editReply(payload), userId);

    if (!result.ok) {
      const text = result.reason === 'busy' ? 'Hold on, a box is already opening.' : 'You have no Mystery Boxes left.';
      await interaction.editReply(box([`# 📦  ${text}`, `-# ${FOOTER}`])).catch(() => {});
    }
    return;
  }

  // Wait pressed on the DM.
  if (id === 'mbox_wait') {
    return interaction.update(waitPayload(userId));
  }

  // Open pressed in /inv: the opening happens in a DM.
  if (id === 'mbox_inv') {
    const { invPayload } = require('./shop');
    await interaction.deferUpdate();

    if (boxesOf(userId) < 1) {
      return interaction.editReply(invPayload(interaction.user, interaction.member, 'You have no Mystery Boxes left.'));
    }

    if (running.has(userId)) {
      return interaction.followUp({ content: '📦 A box is already opening. Check your DMs.', flags: EPHEMERAL });
    }

    let dm;
    try {
      dm = await interaction.user.send(frame(...FRAMES[0]));
    } catch {
      return interaction.followUp({
        content: "❌ I couldn't DM you. Turn on DMs from server members, then press Open again. Your box is still safe.",
        flags: EPHEMERAL,
      });
    }

    await interaction.editReply(invPayload(interaction.user, interaction.member, '📬 Check your DMs, your box is opening.')).catch(() => {});

    await play((payload) => dm.edit(payload), userId);

    await interaction.editReply(invPayload(interaction.user, interaction.member)).catch(() => {});
  }
}

module.exports = { offer, handle };
