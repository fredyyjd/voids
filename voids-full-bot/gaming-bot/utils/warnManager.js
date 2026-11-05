const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'warnings.json');
function loadWarnings() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveWarnings(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function addWarning(userId, reason, moderatorId) {
  const data = loadWarnings();
  if (!data[userId]) data[userId] = [];
  data[userId].push({ reason, moderatorId, timestamp: Date.now() });
  saveWarnings(data);
  return data[userId].length;
}

function getWarnings(userId) {
  const data = loadWarnings();
  return data[userId] || [];
}

module.exports = { addWarning, getWarnings };
