const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const extra = require('../extraConfig');
const { hasMaxPerms, isSupport, isMod } = require('../utils/permissions');
const { fail, done, NO_PERMS } = require('../utils/reply');
const { isSet, safeText, pingFor, requestMemberPing } = require('../utils/partnerPing');

const cfg = extra.partner;

function canUse(member) {
  if (!member) return false;
  if (hasMaxPerms(member) || isSupport(member) || isMod(member)) return true;
  return (cfg.managerRoleIds || []).some((id) => isSet(id) && member.roles.cache.has(id));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('partner')
    .setDescription('Partnership tools')
    .addSubcommand((sub) =>
      sub
        .setName('ping')
        .setDescription('Ping for a partnership')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Who to ping')
            .setRequired(true)
            .addChoices(
              { name: 'Partnership ping', value: 'partnership' },
              { name: '@here', value: 'here' },
              { name: '@Member (needs approval)', value: 'member' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('message')
            .setDescription('Message to send with the ping')
            .setRequired(false)
            .setMaxLength(1500)
        )
    ),

  async execute(interaction) {
    if (!canUse(interaction.member)) return fail(interaction, NO_PERMS);

    const type = interaction.options.getString('type', true);
    const message = safeText(interaction.options.getString('message'));

    // @Member goes to the approval channel first.
    if (type === 'member') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const ok = await requestMemberPing(interaction, message);
      if (!ok) {
        return interaction.editReply({
          content: "Couldn't send the approval request. Check the approval channel id and my permissions.",
        });
      }
      return interaction.editReply({
        content: 'Sent for approval. The ping goes out if it gets accepted.',
      });
    }

    // Partnership + @here go straight through.
    const ping = pingFor(type);
    const sent = await interaction.channel
      .send({
        content: `${ping.text}${message ? `\n${message}` : ''}`,
        allowedMentions: ping.allowedMentions,
      })
      .catch((err) => {
        console.error('[partner] could not send the ping:', err);
        return null;
      });

    if (!sent) return fail(interaction, "Couldn't send the ping here. Check I can send messages and mention roles.");
    return done(interaction, 'Ping sent.');
  },
};
