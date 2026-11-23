const { MessageFlags } = require('discord.js');
const calc = require('../utils/calc');
const { box, priv } = require('../utils/box');

// Who ran /calc. The calculator message keeps that, even after it turns into the keypad.
function ownerOf(interaction) {
  const m = interaction.message;
  return m?.interactionMetadata?.user?.id ?? m?.interaction?.user?.id ?? null;
}

// Only the person who ran /calc can use its buttons.
async function isOwner(interaction) {
  const owner = ownerOf(interaction);
  if (!owner || owner === interaction.user.id) return true;

  await interaction.reply(priv(box("❌ That's not your calculator. Run `/calc` for your own.")));
  return false;
}

async function handle(interaction) {
  const id = interaction.customId || '';

  // Normal Calc: ask for the sum, answer in the channel.
  if (interaction.isButton?.() && id === 'calc_normal') {
    if (!(await isOwner(interaction))) return;
    return interaction.showModal(calc.modal());
  }

  if (interaction.isModalSubmit?.() && id === 'calc_modal') {
    const expr = interaction.fields.getTextInputValue('expr');
    try {
      return await interaction.reply(calc.resultPayload(expr, calc.evaluate(expr)));
    } catch (err) {
      const text = err instanceof calc.CalcError ? err.message : "Couldn't work that out.";
      return interaction.reply(priv(box(`❌ ${text}`)));
    }
  }

  // Cool Calc: swap the picker for the keypad (everyone can see it).
  if (interaction.isButton?.() && id === 'calc_cool') {
    if (!(await isOwner(interaction))) return;
    const state = calc.getState(interaction.message.id, interaction.user.id);
    return interaction.update(calc.keypadPayload(state));
  }

  // Keypad buttons.
  if (interaction.isButton?.() && id.startsWith('calc:')) {
    if (!(await isOwner(interaction))) return;

    const state = calc.getState(interaction.message.id, ownerOf(interaction) || interaction.user.id);

    if (state.userId !== interaction.user.id) {
      return interaction.reply(priv(box("❌ That's not your calculator. Run `/calc` for your own.")));
    }

    const notice = calc.press(state, id.slice('calc:'.length));
    return interaction.update(calc.keypadPayload(state, notice));
  }
}

module.exports = {
  name: 'calcInteractions',

  register(client) {
    client.on('interactionCreate', (interaction) => {
      handle(interaction).catch(async (err) => {
        console.error('[calc] interaction error:', err);
        try {
          const text = 'Something went wrong. Try again in a moment.';
          if (interaction.deferred || interaction.replied) await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral });
          else await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
        } catch {}
      });
    });
  },
};
