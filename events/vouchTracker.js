const tracker = require('../utils/vouchTracker');

module.exports = {
  register(client) {
    // vouch @user comment
    client.on('messageCreate', async (message) => {
      try {
        if (!message.guild || message.author?.bot) return;
        if (!tracker.VOUCH_CHANNEL_IDS.includes(message.channelId)) return;

        const { record, reason } = tracker.recordFromMessage(message);

        // ignored vouch (self / too fast): tell them with a reaction
        if (reason === 'self' || reason === 'cooldown') {
          await message.react(reason === 'self' ? '🚫' : '⏳').catch(() => {});
          return;
        }

        if (!record) return;

        const target = await client.users.fetch(record.targetId).catch(() => null);
        if (!target || target.bot) {
          tracker.removeVouches([message.id]);
          return;
        }

        await tracker.sendAlert(client, record);
      } catch (err) {
        console.error('[vouch] message failed:', err);
      }
    });

    // deleted vouch message -> the vouch is removed
    client.on('raw', (packet) => {
      try {
        if (packet.t === 'MESSAGE_DELETE') tracker.removeVouches([packet.d.id]);
        if (packet.t === 'MESSAGE_DELETE_BULK') tracker.removeVouches(packet.d.ids || []);
      } catch (err) {
        console.error('[vouch] delete failed:', err);
      }
    });

    // "Mute Alerts" button in the DM
    client.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.isButton() || interaction.customId !== tracker.MUTE_BUTTON_ID) return;

        tracker.muteAlerts(interaction.user.id);
        await interaction.update({ components: [tracker.muteRow(true)] });
      } catch (err) {
        console.error('[vouch] mute failed:', err);
      }
    });

    client.once('ready', () => {
      tracker.scanAll(client).catch((err) => console.error('[vouch] scan failed:', err));
    });
  },
};
