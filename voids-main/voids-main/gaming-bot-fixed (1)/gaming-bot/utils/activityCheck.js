// Activity checks: /active check posts a "must react" message that pings the
// staff roles. After 5 hours anyone who didn't react gets a warning/strike
// line in the warnings channel. The check message itself is deleted at 6
// hours; the warnings stay. Demotions are NOT handled here (done by hand).

const fs = require('fs');
const path = require('path');
const { Routes } = require('discord.js');

/* =========================================================
   SETTINGS
========================================================= */

const WARN_CHANNEL_ID = '1558783436565782598';

// role to ping -> emoji the bot reacts with (and shows next to the role)
const ROLES = [
  { id: '1526936584253997146', emoji: '\u{1F535}', shown: '\u{1F535}' },        // 🔵
  { id: '1544889213982482472', emoji: '\u{1F7E2}', shown: '\u{1F7E2}' },        // 🟢
  { id: '1547853856640344084', emoji: '\u26AA', shown: '\u26AA\uFE0F' },        // ⚪️
];

// people with any of these roles don't need to react
const EXEMPT_ROLE_IDS = [
  '1546334249114796033',
  '1552922007371391016',
  '1492832584835797002',
  '1540606063911510086',
];

const COLLECT_MS = 5 * 60 * 60 * 1000; // reactions count for 5 hours
const DELETE_MS = 6 * 60 * 60 * 1000;  // check message deleted at 6 hours

/* =========================================================
   STORAGE
========================================================= */

const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const CHECK_FILE = path.join(DATA_DIR, 'activity-checks.json');
const MISSED_FILE = path.join(DATA_DIR, 'activity-missed.json');

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// running checks live in memory too, so reaction events don't hit the disk
let checks = readJson(CHECK_FILE);
const saveChecks = () => writeJson(CHECK_FILE, checks);

/* ---- missed-check counters (these are never wiped automatically) ---- */

function getMissed(userId) {
  return readJson(MISSED_FILE)[userId]?.missed || 0;
}

function addMissed(userId) {
  const data = readJson(MISSED_FILE);
  const entry = data[userId] || { missed: 0 };
  entry.missed += 1;
  entry.lastMissedAt = Date.now();
  data[userId] = entry;
  writeJson(MISSED_FILE, data);
  return entry.missed;
}

function resetMissed(userId) {
  const data = readJson(MISSED_FILE);
  delete data[userId];
  writeJson(MISSED_FILE, data);
}

// 1-3 missed = warnings, 4 = 1 strike, 5 = 2 strikes, 6 = 3 strikes ...
const strikesFor = (missed) => Math.max(0, missed - 3);

/* =========================================================
   STARTING A CHECK
========================================================= */

function runningCheck(guildId) {
  return Object.values(checks).find((c) => c.guildId === guildId && !c.finalized) || null;
}

function buildCheckText() {
  const lines = ROLES.map((r) => `<@&${r.id}> - ${r.shown}`);
  return `# activity check\n${lines.join('\n')}\nMust react!`;
}

async function startCheck(client, channel, startedBy) {
  const msg = await channel.send({
    content: buildCheckText(),
    allowedMentions: { roles: ROLES.map((r) => r.id) },
  });

  for (const r of ROLES) {
    await msg.react(r.emoji).catch(() => {});
  }

  const now = Date.now();
  const rec = {
    guildId: channel.guild.id,
    channelId: channel.id,
    messageId: msg.id,
    startedBy,
    startedAt: now,
    endsAt: now + COLLECT_MS,
    deleteAt: now + DELETE_MS,
    finalized: false,
    reacted: [],
  };

  checks[msg.id] = rec;
  saveChecks();
  arm(client, rec);
  return rec;
}

/* =========================================================
   TRACKING REACTIONS (raw gateway packets, no cache needed)
========================================================= */

function trackReaction(client, packet) {
  if (packet.t !== 'MESSAGE_REACTION_ADD' && packet.t !== 'MESSAGE_REACTION_REMOVE') return;

  const d = packet.d;
  const rec = checks[d.message_id];
  if (!rec || rec.finalized) return;
  if (d.user_id === client.user?.id) return;
  if (Date.now() > rec.endsAt) return; // too late, doesn't count

  const set = new Set(rec.reacted);
  if (packet.t === 'MESSAGE_REACTION_ADD') set.add(d.user_id);
  else set.delete(d.user_id);

  rec.reacted = [...set];
  saveChecks();
}

// Asks Discord directly who used the 3 check emojis. Used when finishing a
// check so reactions made while the bot was offline still count.
async function fetchReactorIds(client, rec) {
  const ids = new Set();

  for (const r of ROLES) {
    let after;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ limit: '100' });
      if (after) query.set('after', after);

      let users;
      try {
        users = await client.rest.get(
          Routes.channelMessageReaction(rec.channelId, rec.messageId, encodeURIComponent(r.emoji)),
          { query }
        );
      } catch {
        break; // message deleted or no access: fall back to what we tracked
      }

      for (const u of users) ids.add(u.id);
      if (users.length < 100) break;
      after = users[users.length - 1].id;
    }
  }

  return ids;
}

/* =========================================================
   FINISHING A CHECK (5h) + CLEANUP (6h)
========================================================= */

function buildWarningLine(userId, missed) {
  if (missed <= 3) {
    return `<@${userId}> - \u26A0\uFE0F **Warning ${missed}/3** (missed ${missed} activity check${missed === 1 ? '' : 's'})`;
  }

  const strikes = strikesFor(missed);
  return `<@${userId}> - \u{1F6A8} **+1 strike** (missed ${missed} activity checks, now at ${strikes} strike${strikes === 1 ? '' : 's'})`;
}

async function sendChunked(channel, header, lines, userIds) {
  const chunks = [];
  let current = header;

  for (const line of lines) {
    if ((current + '\n' + line).length > 1900) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);

  for (const content of chunks) {
    await channel.send({ content, allowedMentions: { users: userIds } }).catch((err) => {
      console.error('[activity] failed to send warnings:', err.message);
    });
  }
}

async function finalizeCheck(client, messageId) {
  const rec = checks[messageId];
  if (!rec || rec.finalized) return;

  // Mark it done first so a crash can never warn the same people twice.
  rec.finalized = true;
  saveChecks();

  try {
    const guild = await client.guilds.fetch(rec.guildId);
    const members = await guild.members.fetch({ time: 60000 });

    const roleIds = ROLES.map((r) => r.id);
    const expected = members.filter(
      (m) =>
        !m.user.bot &&
        roleIds.some((id) => m.roles.cache.has(id)) &&
        !EXEMPT_ROLE_IDS.some((id) => m.roles.cache.has(id))
    );

    const reacted = new Set(rec.reacted);
    for (const id of await fetchReactorIds(client, rec)) reacted.add(id);

    const missing = expected.filter((m) => !reacted.has(m.id));
    const channel = await client.channels.fetch(WARN_CHANNEL_ID).catch(() => null);
    if (!channel) {
      console.error('[activity] warnings channel not found');
      return;
    }

    if (!missing.size) {
      await channel.send('# activity check results\n\u2705 Everyone reacted, no warnings this time.').catch(() => {});
      return;
    }

    const lines = [];
    for (const member of missing.values()) {
      lines.push(buildWarningLine(member.id, addMissed(member.id)));
    }

    const header =
      `# activity check results\n` +
      `-# Check started <t:${Math.floor(rec.startedAt / 1000)}:R>. These people didn't react in time:`;

    await sendChunked(channel, header, lines, [...missing.keys()]);
  } catch (err) {
    console.error('[activity] failed to finish check:', err);
  }
}

async function deleteCheckMessage(client, messageId) {
  const rec = checks[messageId];
  if (!rec) return;

  try {
    const channel = await client.channels.fetch(rec.channelId).catch(() => null);
    if (channel) await channel.messages.delete(rec.messageId).catch(() => {});
  } finally {
    delete checks[messageId];
    saveChecks();
  }
}

/* =========================================================
   SCHEDULING
========================================================= */

// Finish at 5h, then delete the message at 6h. Done in order so the check
// message is never deleted before its reactions were read.
function arm(client, rec) {
  const deleteStep = () => {
    setTimeout(() => deleteCheckMessage(client, rec.messageId), Math.max(rec.deleteAt - Date.now(), 0));
  };

  if (rec.finalized) return deleteStep();

  setTimeout(async () => {
    await finalizeCheck(client, rec.messageId);
    deleteStep();
  }, Math.max(rec.endsAt - Date.now(), 0));
}

// Timers don't survive a restart, so call this on ready.
function rearmChecks(client) {
  for (const rec of Object.values(checks)) arm(client, rec);
}

module.exports = {
  WARN_CHANNEL_ID,
  startCheck,
  runningCheck,
  trackReaction,
  rearmChecks,
  getMissed,
  resetMissed,
  strikesFor,
};
