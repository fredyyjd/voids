const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'sticky.json');

function loadSticky() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSticky(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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

module.exports = { setSticky, removeSticky, getSticky, updateLastMessageId };
