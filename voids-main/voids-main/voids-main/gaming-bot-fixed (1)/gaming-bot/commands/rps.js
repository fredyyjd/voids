const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { box, priv } = require('../utils/box');
const { rpsMatch, nm, uid, edit } = require('../utils/gameKit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Challenge someone to rock paper scissors')
    .setDMPermission(false)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Who to challenge').setRequired(true)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const me = interaction.user;

    if (target.bot) return interaction.reply(priv(box("❌ Bots don't play.")));
    if (target.id === me.id) return interaction.reply(priv(box("❌ You can't challenge yourself.")));

    const id = uid();
    const row = (off = false) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`g:rpsa:${id}`).setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(off),
        new ButtonBuilder().setCustomId(`g:rpsd:${id}`).setLabel('Decline').setStyle(ButtonStyle.Danger).setDisabled(off)
      );

    await interaction.reply({
      ...box([`${nm(me.id)} challenged ${nm(target.id)} to rock paper scissors`, '-# 60s to accept'], {
        rows: [row()],
      }),
      allowedMentions: { parse: [], users: [target.id] },
    });
    const msg = await interaction.fetchReply();

    let outcome = null;

    await new Promise((resolve) => {
      const col = msg.createMessageComponentCollector({ time: 60 * 1000 });

      col.on('collect', async (i) => {
        if (i.user.id !== target.id) {
          return i.reply(priv(box(`Only ${nm(target.id)} can answer this.`))).catch(() => {});
        }
        outcome = i.customId === `g:rpsa:${id}` ? 'accepted' : 'declined';
        await i.deferUpdate().catch(() => {});
        col.stop(outcome);
      });

      col.on('end', () => resolve());
    });

    if (outcome === 'accepted') {
      await edit(msg, [`${nm(me.id)} vs ${nm(target.id)}`, 'accepted']);
      return rpsMatch(interaction.channel, me, target);
    }

    await edit(msg, [
      `${nm(me.id)} challenged ${nm(target.id)}`,
      outcome === 'declined' ? 'declined' : 'no response',
    ]);
  },
};
