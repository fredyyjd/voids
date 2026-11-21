const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'sticky.json');

// Marks the bot's sticky messages so they can be found (and never trigger themselves).
const STICKY_FOOTER = '📌 Sticky Message';

function loadSticky() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSticky(data) {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function setSticky(channelId, content) {
  const data = loadSticky();
  data[channelId] = { content, lastMessageId: null };
  saveSticky(data);
}

function removeSticky(channelId) {
  const data = loadSticky();
  const existing = data[channelId];
  delete data[channelId];
  saveSticky(data);
  return existing;
}

function getSticky(channelId) {
  const data = loadSticky();
  return data[channelId] || null;
}

function updateLastMessageId(channelId, messageId) {
  const data = loadSticky();
  if (data[channelId]) {
    data[channelId].lastMessageId = messageId;
    saveSticky(data);
  }
}

function buildStickyEmbed(content) {
  return new EmbedBuilder()
    .setColor(0x3b82f6)
    .setDescription(content)
    .setFooter({ text: STICKY_FOOTER });
}

// True for any sticky message the bot posted (also the older "📌 Sticky" footer).
function isStickyMessage(message, botId) {
  if (!message || message.author?.id !== botId) return false;
  const footer = message.embeds?.[0]?.footer?.text;
  return typeof footer === 'string' && footer.startsWith('📌 Sticky');
}

module.exports = {
  STICKY_FOOTER,
  setSticky,
  removeSticky,
  getSticky,
  updateLastMessageId,
  buildStickyEmbed,
  isStickyMessage,
};
