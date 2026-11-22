const { MessageFlags } = require('discord.js');
const calc = require('../utils/calc');
const { box, priv } = require('../utils/box');

async function handle(interaction) {
  const id = interaction.customId || '';

  // Normal Calc: ask for the sum, answer in the channel.
  if (interaction.isButton?.() && id === 'calc_normal') {
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

  // Cool Calc: swap the picker for the keypad.
  if (interaction.isButton?.() && id === 'calc_cool') {
    const state = calc.getState(interaction.message.id, interaction.user.id);
    return interaction.update(calc.keypadPayload(state));
  }

  // Keypad buttons.
  if (interaction.isButton?.() && id.startsWith('calc:')) {
    const state = calc.getState(interaction.message.id, interaction.user.id);

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
