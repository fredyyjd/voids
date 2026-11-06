const crypto = require('crypto');
const { AttachmentBuilder, MessageFlags } = require('discord.js');
const extra = require('../extraConfig');
const schem = require('../utils/schematics');
const staffPoints = require('../utils/staffPoints');
const { hasMaxPerms, isSupport, isMod } = require('../utils/permissions');

const cfg = extra.schematics;

const MAX_FILES_PER_POST = 10; // Discord's limit per message
const inFlight = new Set(); // fingerprints being posted right now (stops two forwards racing)

function isImage(attachment) {
  const ext = String(attachment.name || '').split('.').pop().toLowerCase();
  return (
    (attachment.contentType && attachment.contentType.startsWith('image/')) ||
    (cfg.imageExtensions || []).includes(ext)
  );
}

// Staff = admin / support / mod roles, Administrator, or any role in posterRoleIds.
function canPost(member) {
  if (!member) return false;
  if (hasMaxPerms(member) || isSupport(member) || isMod(member)) return true;
  return (cfg.posterRoleIds || []).some(
    (id) => id && !String(id).startsWith('PUT_') && member.roles.cache.has(id)
  );
}

// Files and images from the message itself AND from anything it forwards
// (a forwarded message keeps its attachments in "message snapshots").
function collectAttachments(message) {
  const found = new Map();
  const add = (a) => {
    if (a && !found.has(a.url)) found.set(a.url, a);
  };
  for (const a of message.attachments.values()) add(a);
  if (message.messageSnapshots) {
    for (const snapshot of message.messageSnapshots.values()) {
      if (!snapshot.attachments) continue;
      for (const a of snapshot.attachments.values()) add(a);
    }
  }
  return [...found.values()];
}

// Text of the message and of anything it forwards (only the first line matters for the title).
function collectText(message) {
  const parts = [message.content || ''];
  if (message.messageSnapshots) {
    for (const snapshot of message.messageSnapshots.values()) parts.push(snapshot.content || '');
  }
  return parts.filter(Boolean).join('\n');
}

async function download(attachment) {
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`download failed (${response.status}) for ${attachment.name}`);
  return Buffer.from(await response.arrayBuffer());
}

function tempReply(message, text) {
  message
    .reply({ content: text, allowedMentions: { repliedUser: false } })
    .then((reply) => setTimeout(() => reply.delete().catch(() => {}), 10 * 1000))
    .catch(() => {});
}

// ---------------------------------------------------------------------
// Posting cooldown + spam warning
// ---------------------------------------------------------------------
const COOLDOWN_MS = (cfg.postCooldownSeconds === undefined ? 10 : cfg.postCooldownSeconds) * 1000;
const spamCfg = cfg.spamWarn || {};
const SPAM_ATTEMPTS = spamCfg.attempts || 10;
const SPAM_WINDOW_MS = (spamCfg.windowSeconds || 60) * 1000;
const SPAM_DM_COOLDOWN_MS = (spamCfg.dmCooldownMinutes || 30) * 60 * 1000;
const SPAM_DM =
  spamCfg.dm ||
  "Hey, we see you're locked in on posting schems, but don't post so much. It looks like you're trying to abuse the points system. If it happens again you may be warned.";

const lastAccepted = new Map(); // userId -> when their last post was accepted
const blockedTries = new Map(); // userId -> times they tried during the cooldown
const lastNotice = new Map(); // userId -> last time we replied "wait" (so we don't flood)
const lastSpamDm = new Map(); // userId -> last time we DMed them

function prune(map, maxAgeMs) {
  if (map.size < 500) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, value] of map) {
    const at = Array.isArray(value) ? value[value.length - 1] || 0 : value;
    if (at < cutoff) map.delete(key);
  }
}

// Seconds the person still has to wait (0 = free to post).
function cooldownLeft(userId, now = Date.now()) {
  const left = COOLDOWN_MS - (now - (lastAccepted.get(userId) || 0));
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// Counts a blocked try. Returns true when it is time to DM them.
function countBlockedTry(userId, now = Date.now()) {
  const times = (blockedTries.get(userId) || []).filter((t) => now - t < SPAM_WINDOW_MS);
  times.push(now);
  blockedTries.set(userId, times);

  if (times.length >= SPAM_ATTEMPTS && now - (lastSpamDm.get(userId) || 0) > SPAM_DM_COOLDOWN_MS) {
    blockedTries.set(userId, []);
    lastSpamDm.set(userId, now);
    return true;
  }
  return false;
}

function handleTooFast(message, secondsLeft) {
  const userId = message.author.id;
  const now = Date.now();

  if (countBlockedTry(userId, now)) {
    message.author.send(SPAM_DM).catch(() => {}); // DMs closed? nothing to do
  }

  // One "wait" reply every few seconds is enough.
  if (now - (lastNotice.get(userId) || 0) < 3000) return;
  lastNotice.set(userId, now);

  tempReply(
    message,
    `Whoa there! Wait for the ${Math.round(COOLDOWN_MS / 1000)}s cooldown to finish (${secondsLeft}s left).`
  );

  prune(lastAccepted, 60 * 60 * 1000);
  prune(blockedTries, 60 * 60 * 1000);
  prune(lastNotice, 60 * 60 * 1000);
}

// Posts are handled ONE AT A TIME. When someone forwards several schematics at
// once, downloading all of them together is what makes the bot's memory jump.
let postQueue = Promise.resolve();
function handleSchematicMessage(message) {
  // Cooldown is checked right away (before the queue) so fast posts can't slip through.
  if (message.guild && !message.author?.bot) {
    const category = schem.categoryBySource(message.channelId);
    const hasFile = category && collectAttachments(message).some((a) => !isImage(a));

    if (hasFile && canPost(message.member)) {
      const left = cooldownLeft(message.author.id);
      if (left > 0) {
        handleTooFast(message, left);
        return Promise.resolve();
      }
      lastAccepted.set(message.author.id, Date.now());
    }
  }

  postQueue = postQueue
    .then(() => processSchematicMessage(message))
    .catch((err) => console.error('[schematics] queued post failed:', err));
  return postQueue;
}

async function processSchematicMessage(message) {
  if (!cfg.enabled) return;
  if (!message.guild || message.author?.bot) return;

  const category = schem.categoryBySource(message.channelId);
  if (!category) return;

  const attachments = collectAttachments(message);
  const files = attachments.filter((a) => !isImage(a));
  if (!files.length) return; // nothing to post unless there is a schematic file

  if (!canPost(message.member)) {
    tempReply(message, 'Only staff can post schematics.');
    return;
  }

  const destination = await message.client.channels.fetch(category.posting).catch(() => null);
  if (!destination || !destination.isTextBased()) {
    console.error(`[schematics] Posting channel ${category.posting} not found or not a text channel.`);
    tempReply(message, "I can't find the posting channel for this category.");
    lastAccepted.delete(message.author.id);
    return;
  }

  const toSend = attachments.slice(0, MAX_FILES_PER_POST);

  let buffers;
  try {
    buffers = await Promise.all(toSend.map(download));
  } catch (err) {
    console.error('[schematics] Could not download the files:', err.message);
    tempReply(message, "Couldn't read those files, try forwarding it again.");
    lastAccepted.delete(message.author.id);
    return;
  }

  // Fingerprints of the schematic files: the file's content and its name.
  const keys = [];
  toSend.forEach((attachment, i) => {
    if (isImage(attachment)) return;
    keys.push(schem.hashKey(crypto.createHash('sha256').update(buffers[i]).digest('hex')));
    keys.push(schem.nameKey(attachment.name));
  });

  if (keys.some((key) => inFlight.has(key)) || schem.findDuplicate(keys)) {
    tempReply(message, 'That schematic has already been posted, so it was not sent again.');
    lastAccepted.delete(message.author.id);
    return;
  }
  keys.forEach((key) => inFlight.add(key));

  try {
    const fileNames = toSend.filter((a) => !isImage(a)).map((a) => a.name);
    const text = collectText(message);
    const title = schem.readPostTitle(text) || schem.makeTitle(fileNames[0]);
    const credits = schem.readCredits(text);
    const id = schem.nextId();

    // Same images + file + name + credits, in our format.
    const sent = await destination.send({
      content: schem.buildPostText(title, id, credits),
      files: toSend.map((a, i) => new AttachmentBuilder(buffers[i], { name: a.name })),
      allowedMentions: { parse: [] },
    });

    // Posted - now it counts.
    schem.rememberAll(keys, { id, name: fileNames[0], by: message.author.id, at: Date.now() });
    schem.recordPost({
      id,
      category: category.key,
      title,
      guildId: message.guild.id,
      channelId: destination.id,
      messageId: sent.id,
      by: message.author.id,
      at: Date.now(),
    });
    schem.scheduleUpdate(message.client);

    // 0.25 points for staff who post a schematic (amount lives in extraConfig -> staffPoints)
    staffPoints.record(message.member, 'post');

    message.react('✅').catch(() => {});
    console.log(`[schematics] posted SI ${id} "${title}" -> ${category.key}`);
  } catch (err) {
    console.error('[schematics] Could not post the schematic:', err);
    tempReply(message, "Couldn't post that schematic (the file may be too big for this server).");
    lastAccepted.delete(message.author.id);
  } finally {
    keys.forEach((key) => inFlight.delete(key));
    // The downloaded files are big. Let go of them and, when the bot runs with
    // --expose-gc, clean up a few seconds later so the memory is given back.
    buffers = null;
    if (typeof global.gc === 'function') {
      const timer = setTimeout(() => global.gc(), 3000);
      if (timer.unref) timer.unref();
    }
  }
}

// Dropdown + page buttons on the count panel.
async function handleSchematicInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'schem_search') {
    await interaction.reply({
      ...schem.buildSearchPage(interaction.values[0], 0),
      flags: MessageFlags.Ephemeral,
    });
    // Put the dropdown back to "pick a category" and refresh the counts.
    interaction.message.edit(schem.buildPanelMessage()).catch(() => {});
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('schem_page:')) {
    const [, key, page] = interaction.customId.split(':');
    await interaction.update(schem.buildSearchPage(key, parseInt(page, 10) || 0));
  }
}

module.exports = {
  name: 'schematicPoster',
  _test: { cooldownLeft, countBlockedTry, lastAccepted },

  register(client) {
    client.on('messageCreate', (message) => {
      handleSchematicMessage(message).catch((err) => console.error('[schematics] Error:', err));
    });

    client.on('interactionCreate', (interaction) => {
      handleSchematicInteraction(interaction).catch((err) => console.error('[schematics] interaction error:', err));
    });
  },
};
