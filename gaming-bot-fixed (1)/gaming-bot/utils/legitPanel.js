const fs = require('fs');
const path = require('path');
const { Routes, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { isMod } = require('./permissions');
const { COLOR } = require('./theme');

// "Are we legit?" panel settings
const NO_EMOJI = { name: 'Emojis_32x32_13', id: '1545307137662517248' }; // no
const YES_EMOJI = { name: 'Emojis_32x32_21', id: '1545312105354362940' }; // yes
const TICKET_CHANNEL_ID = '1526923660823232553';

const NO_TEXT = `<:${NO_EMOJI.name}:${NO_EMOJI.id}>`;
const YES_TEXT = `<:${YES_EMOJI.name}:${YES_EMOJI.id}>`;

const PANEL_TEXT =
  `# are we legit?\n` +
  `**if you react with ${NO_TEXT} **\n` +
  `You have 24h to open a ticket with proof other wise you will be banned`;

function buildPanelEmbed() {
  return new EmbedBuilder().setColor(COLOR).setDescription(PANEL_TEXT);
}

const WARNING_TEXT =
  `You voted ${NO_TEXT} on **Are we legit** -- you have **24 hours** to make a **General Help** ticket and explain why, or you will be banned. ` +
  `Voted by mistake? Just remove your ${NO_TEXT} reaction.\n` +
  `make a ticket here -> <#${TICKET_CHANNEL_ID}>`;

const mentionLine = (ids) => ids.map((id) => `<@${id}>`).join(', ');

// The pings sit in the message content (embeds don't ping), the text in the embed.
// userIds: everyone who currently has the no reaction -> "@a, @b"
function buildWarning(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];

  return {
    content: mentionLine(ids),
    embeds: [new EmbedBuilder().setColor(COLOR).setDescription(WARNING_TEXT)],
    allowedMentions: { users: ids },
  };
}

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const FILE = path.join(DATA_DIR, 'legit-panels.json');

// { [messageId]: { channelId, guildId } }
function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[legit] could not save:', err);
  }
}


/* =========================================================
   24 HOUR AUTO BAN

   Vote no -> 24h timer. At 24h the person is banned if they still
   have the no reaction on the panel. Removing the reaction cancels
   it (opening a ticket does not).

   votes file: { [userId]: { messageId, channelId, guildId, votedAt, banAt } }
========================================================= */

const BAN_AFTER_MS = 24 * 60 * 60 * 1000;
const VOTES_FILE = path.join(DATA_DIR, 'legit-votes.json');

function loadVotes() {
  try {
    return JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveVotes(data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(VOTES_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[legit] could not save votes:', err);
  }
}

const timers = new Map();


function cancelTimer(userId) {
  clearTimeout(timers.get(userId));
  timers.delete(userId);
}

// Asks Discord whether this user still has the no reaction on the panel.
async function stillReacted(client, vote, userId) {
  try {
    const users = await client.rest.get(
      Routes.channelMessageReaction(
        vote.channelId,
        vote.messageId,
        encodeURIComponent(`${NO_EMOJI.name}:${NO_EMOJI.id}`)
      ),
      {
        query: new URLSearchParams({
          limit: '1',
          after: (BigInt(userId) - 1n).toString(),
        }),
      }
    );
    return users.length > 0 && users[0].id === userId;
  } catch {
    return false; // panel deleted / no access: don't ban
  }
}

async function logBan(client, text) {
  const id = config.modLogChannelId;
  if (!id || String(id).startsWith('PUT_')) return;

  const channel = await client.channels.fetch(id).catch(() => null);
  if (channel) {
    await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

async function finishVote(client, userId) {
  const votes = loadVotes();
  const vote = votes[userId];
  if (!vote) return;

  delete votes[userId];
  saveVotes(votes);
  timers.delete(userId);

  try {
    if (!(await stillReacted(client, vote, userId))) return;

    const guild = await client.guilds.fetch(vote.guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return; // already left
    if (member.user.bot) return;
    if (member.permissions.has(PermissionFlagsBits.Administrator) || isMod(member)) return;

    await guild.members.ban(userId, {
      reason: 'Voted no on "Are we legit" and still had the reaction after 24 hours',
    });

    await logBan(
      client,
      `🔨 <@${userId}> (${userId}) was banned: still voted no on "Are we legit" after 24h.`
    );
  } catch (err) {
    console.error('[legit] could not ban:', err);
  }
}

function arm(client, userId, vote) {
  cancelTimer(userId);
  timers.set(
    userId,
    setTimeout(() => finishVote(client, userId), Math.max(vote.banAt - Date.now(), 0))
  );
}

// someone reacted no
function addVote(client, { userId, messageId, channelId, guildId }) {
  const votes = loadVotes();
  if (votes[userId]) return; // already counting down

  const now = Date.now();
  votes[userId] = {
    messageId,
    channelId,
    guildId,
    votedAt: now,
    banAt: now + BAN_AFTER_MS,
    warnMessageIds: [],
  };
  saveVotes(votes);
  arm(client, userId, votes[userId]);
}

// everyone with a pending no vote on this panel message
function activeVoters(messageId) {
  return Object.entries(loadVotes())
    .filter(([, v]) => v.messageId === messageId)
    .map(([userId]) => userId);
}

// Sends the warning (pinging everyone with a pending vote on this panel)
// and remembers the message so it can be removed if they unreact.
async function sendWarning(client, channel, panelMessageId, newUserId) {
  const voters = activeVoters(panelMessageId);
  if (!voters.includes(newUserId)) voters.push(newUserId);

  const sent = await channel.send(buildWarning(voters));

  const votes = loadVotes();
  for (const id of voters) {
    if (votes[id]) {
      votes[id].warnMessageIds = [...(votes[id].warnMessageIds || []), sent.id];
    }
  }
  saveVotes(votes);

  return sent;
}

// They took the reaction back: cancel the ban and make their warning go away.
// A warning that also pings other voters just loses this person's mention.
async function cancelVote(client, userId) {
  const votes = loadVotes();
  const vote = votes[userId];
  if (!vote) return;

  delete votes[userId];
  saveVotes(votes);
  cancelTimer(userId);

  const channel = await client.channels.fetch(vote.channelId).catch(() => null);
  if (!channel) return;

  for (const warnId of vote.warnMessageIds || []) {
    const others = Object.entries(votes)
      .filter(([, v]) => (v.warnMessageIds || []).includes(warnId))
      .map(([id]) => id);

    if (!others.length) {
      await channel.messages.delete(warnId).catch(() => {});
    } else {
      const message = await channel.messages.fetch(warnId).catch(() => null);
      if (message) {
        await message
          .edit({ content: mentionLine(others), allowedMentions: { users: others } })
          .catch(() => {});
      }
    }
  }
}

// removed their reaction
function clearVote(userId) {
  cancelTimer(userId);

  const votes = loadVotes();
  if (!votes[userId]) return;
  delete votes[userId];
  saveVotes(votes);
}

// timers don't survive a restart
function rearmVotes(client) {
  for (const [userId, vote] of Object.entries(loadVotes())) arm(client, userId, vote);
}

module.exports = {
  addVote,
  activeVoters,
  clearVote,
  rearmVotes,
  NO_EMOJI,
  YES_EMOJI,
  PANEL_TEXT,
  buildPanelEmbed,
  buildWarning,
  sendWarning,
  cancelVote,
  load,
  save,
};
