const config = require('../config.json');
const createStore = require('./jsonStore');

const store = createStore('games_channel.json', {});

function gamesChannelId() {
  const id = config.gamesChannelId;
  return id && !String(id).startsWith('PUT_') ? String(id) : null;
}

function isGamesChannel(channelId) {
  const id = gamesChannelId();
  return Boolean(id && String(channelId) === id);
}

async function allowBot(channel) {
  const me = channel.guild?.members?.me || (await channel.guild?.members?.fetchMe?.().catch(() => null));
  if (!me) return;
  await channel.permissionOverwrites
    .edit(me.id, { ViewChannel: true, SendMessages: true, EmbedLinks: true }, { reason: 'games channel bot access' })
    .catch(() => {});
}

async function applyState(channel, open, reason) {
  if (!channel?.permissionOverwrites) return false;
  const everyone = channel.guild.roles.everyone;

  if (!open) await allowBot(channel);

  return channel.permissionOverwrites
    .edit(everyone, { SendMessages: open }, { reason })
    .then(() => true)
    .catch((err) => {
      console.error(`[games] could not ${open ? 'unlock' : 'lock'} channel:`, err.message);
      return false;
    });
}

async function openForGame(channel, gameName) {
  if (!isGamesChannel(channel?.id)) return false;
  const ok = await applyState(channel, true, `message entry game started: ${gameName}`);
  if (ok) store.set('state', { open: true, game: gameName, at: Date.now() });
  return ok;
}

async function lockAfterGame(channel, reason = 'message entry game finished') {
  if (!isGamesChannel(channel?.id)) return false;
  const ok = await applyState(channel, false, reason);
  if (ok) store.set('state', { open: false, game: null, at: Date.now() });
  return ok;
}

async function restoreOnStartup(client) {
  const id = gamesChannelId();
  if (!id) return;

  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || !channel.guild) return;

  const saved = store.get('state');
  await lockAfterGame(channel, 'bot restarted, no message entry game is active');

  if (saved?.open) {
    console.log(`[games] restart detected while "${saved.game}" was open, channel locked again.`);
  } else {
    console.log('[games] games channel locked (no message entry game active).');
  }
}

module.exports = { gamesChannelId, isGamesChannel, openForGame, lockAfterGame, restoreOnStartup };
