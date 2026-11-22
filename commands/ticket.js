const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { parseTopic, getStaffRoleIds, closeTicket } = require('../utils/ticketManager');
const { incrementStat } = require('../utils/staffTracker');
const staffPoints = require('../utils/staffPoints');
const { fail } = require('../utils/reply');
const { box } = require('../utils/box');

const P = PermissionsBitField.Flags;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage this ticket')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add someone to this ticket')
        .addUserOption((o) => o.setName('user').setDescription('Who to add').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('close')
        .setDescription('Ask to close this ticket')
        .addStringOption((o) => o.setName('reason').setDescription('Why it is closing').setMaxLength(500))
    )
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('Rename this ticket')
        .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(90))
    ),

  async execute(interaction) {
    const meta = parseTopic(interaction.channel.topic);
    if (!meta) return fail(interaction, 'This isn\'t a ticket channel.');

    // Closing has its own permission check (and asks the ticket owner first).
    if (interaction.options.getSubcommand() === 'close') {
      return closeTicket(interaction, interaction.options.getString('reason'));
    }

    const member = interaction.member;
    const isStaff = getStaffRoleIds(meta).some((id) => member.roles.cache.has(id));
    const isClaimer = interaction.channel.permissionOverwrites.cache.get(member.id)?.allow.has(P.ManageMessages) || false;

    if (!isStaff && !isClaimer && !member.permissions.has(P.ManageChannels)) {
      return fail(interaction, 'Only ticket staff can do that.');
    }

    const sub = interaction.options.getSubcommand();

    /* ---------- add ---------- */
    if (sub === 'add') {
      const target = interaction.options.getUser('user');

      if (target.bot) return fail(interaction, 'You can\'t add a bot.');
      if (target.id === meta.userId) return fail(interaction, 'They opened this ticket.');

      const existing = interaction.channel.permissionOverwrites.cache.get(target.id);
      if (existing?.allow.has(P.ViewChannel)) return fail(interaction, `${target} is already here.`);

      try {
        await interaction.channel.permissionOverwrites.edit(target.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true,
        });
      } catch (err) {
        console.error('[ticket] add failed:', err);
        return fail(interaction, 'Couldn\'t add them. Check my permissions here.');
      }

      return interaction.reply(box(`${target} was added by ${interaction.user}.`));
    }

    /* ---------- rename ---------- */
    if (sub === 'rename') {
      const name = interaction.options
        .getString('name')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 90);

      if (!name) return fail(interaction, 'That name isn\'t valid.');

      await interaction.deferReply({ flags: 64 });

      try {
        await interaction.channel.setName(name);
      } catch (err) {
        console.error('[ticket] rename failed:', err);
        return interaction.editReply(box("❌ Couldn't rename. Discord limits renames, try again shortly."));
      }

      await interaction.editReply(box(`✅ Renamed to **${name}**.`));

      staffPoints.record(interaction.member, 'rename', { channelId: interaction.channelId });
      incrementStat(interaction.guild, interaction.user.id, 'ticketsRenamed').catch(() => {});
    }
  },
};
