const { SlashCommandBuilder } = require('discord.js');
const { hasMaxPerms } = require('../utils/permissions');
const { fail, done, NO_PERMS } = require('../utils/reply');
const economy = require('../utils/economy');
const boost = require('../utils/vbBoost');
const { BOOST_CHANNEL_ID } = require('../utils/economyConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('2x')
    .setDescription('Double reward events')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('vb')
        .setDescription('Turn 2x VB on or off')
        .addStringOption((o) =>
          o
            .setName('state')
            .setDescription('Turn it on or off')
            .setRequired(true)
            .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })
        )
        .addIntegerOption((o) =>
          o
            .setName('hours')
            .setDescription('How long it lasts in hours (leave empty to keep it on until you turn it off)')
            .setMinValue(1)
            .setMaxValue(168)
        )
    ),

  async execute(interaction) {
    if (!hasMaxPerms(interaction.member)) return fail(interaction, NO_PERMS);

    const state = interaction.options.getString('state');

    if (state === 'off') {
      if (!economy.boostActive()) return fail(interaction, '2x VB is not on right now.');

      await interaction.deferReply({ flags: 64 });
      await boost.stop(interaction.client);
      return interaction.editReply('✅ 2x VB is off. The end message was sent.');
    }

    if (economy.boostActive()) return fail(interaction, '2x VB is already on. Turn it off first to start it again.');

    await interaction.deferReply({ flags: 64 });
    const posted = await boost.start(interaction.client, interaction.options.getInteger('hours'));

    return interaction.editReply(
      posted
        ? `✅ 2x VB is on and the announcement was sent in <#${BOOST_CHANNEL_ID}>.`
        : `⚠️ 2x VB is on, but I could not post in <#${BOOST_CHANNEL_ID}>. Check I can send messages there.`
    );
  },
};
