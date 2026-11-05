const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config.json');

/* =========================================================
   PERSISTENT APPLICATION STATUS
   ("has this user got a pending application for this id")
========================================================= */

const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const APPLIED_FILE = path.join(DATA_DIR, 'applied.json');

function applicationKey(userId, appId) {
  return `${userId}:${appId}`;
}

function loadApplied() {
  if (!fs.existsSync(APPLIED_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(APPLIED_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read applied.json:', err);
    return {};
  }
}

function saveApplied(data) {
  try {
    fs.writeFileSync(APPLIED_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save applied.json:', err);
  }
}

function hasApplied(userId, appId) {
  const data = loadApplied();
  return Boolean(data[applicationKey(userId, appId)]);
}

function markApplied(userId, appId) {
  const data = loadApplied();
  data[applicationKey(userId, appId)] = { status: 'pending', createdAt: Date.now() };
  saveApplied(data);
}

function clearApplied(userId, appId) {
  const data = loadApplied();
  delete data[applicationKey(userId, appId)];
  saveApplied(data);
}

/*
  Store extra info about where an application's messages live
  (the ticket channel/message and the log channel/message) so
  the accept/deny handler can update BOTH copies later, even
  though it only receives the interaction from one of them.
*/
function updateApplicationRefs(userId, appId, refs) {
  const data = loadApplied();
  const key = applicationKey(userId, appId);
  const existing = data[key] || { status: 'pending', createdAt: Date.now() };
  data[key] = { ...existing, ...refs };
  saveApplied(data);
}

function getApplicationRefs(userId, appId) {
  const data = loadApplied();
  return data[applicationKey(userId, appId)] || null;
}

/* =========================================================
   FIND APPLICATION CONFIG
========================================================= */

function getApplication(appId) {
  return (config.applications || []).find((app) => app.id === appId);
}

/* =========================================================
   APPLICATION EMBED (shown in the review channel + ticket)
========================================================= */

const STATUS_COLORS = {
  pending: 0x3B82F6,
  accepted: 0x57F287,
  denied: 0xED4245,
};

// Discord allows ~6000 characters per message across ALL embeds. With a
// long application that means answers have to be trimmed. Short answers
// keep everything, long answers share what is left.
function allocateAnswerSpace(lengths, budget, cap = 1024) {
  const order = lengths.map((len, i) => [len, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(lengths.length).fill(0);
  let remaining = Math.max(budget, 0);
  let left = order.length;

  for (const [len, i] of order) {
    const share = Math.floor(remaining / Math.max(left, 1));
    const take = Math.min(len, cap, share);
    out[i] = take;
    remaining -= take;
    left -= 1;
  }

  return out;
}

function buildApplicationEmbed(member, appConfig, answers) {
  const createdTimestamp = Math.floor(member.user.createdTimestamp / 1000);
  const joinedTimestamp = member.joinedTimestamp
    ? Math.floor(member.joinedTimestamp / 1000)
    : null;

  const questions = appConfig.questions || [];

  const questionNames = questions.map((q, i) => {
    let name = `${i + 1}. ${String(q)}`;
    if (name.length > 256) name = name.slice(0, 253) + '...';
    return name;
  });

  const answerTexts = questions.map((_, i) => String(answers[i] || 'No answer'));

  // 6000 total - headers/footer/name fields - the question names themselves.
  const namesLength = questionNames.reduce((sum, n) => sum + n.length, 0);
  const budget = 5600 - 900 - namesLength;
  const space = allocateAnswerSpace(answerTexts.map((a) => a.length), budget);

  const embed = new EmbedBuilder()
    .setTitle(`${appConfig.emoji ? appConfig.emoji + ' ' : ''}New Application: ${appConfig.label}`)
    .setColor(STATUS_COLORS.pending)
    .setThumbnail(member.user.displayAvatarURL())
    .setDescription(
      `**Applicant:** ${member} (${member.user.tag})\n` +
      `**User ID:** \`${member.id}\``
    )
    .addFields(
      {
        name: 'Account Created',
        value: `<t:${createdTimestamp}:D>\n(<t:${createdTimestamp}:R>)`,
        inline: true,
      },
      {
        name: 'Joined Server',
        value: joinedTimestamp
          ? `<t:${joinedTimestamp}:D>\n(<t:${joinedTimestamp}:R>)`
          : 'Unknown',
        inline: true,
      },
      {
        name: 'Status',
        value: '🟡 Pending review',
        inline: true,
      }
    )
    .setFooter({ text: `${appConfig.label} • User ID: ${member.id}` })
    .setTimestamp();

  questions.forEach((_, index) => {
    let answer = answerTexts[index];
    if (answer.length > space[index]) {
      answer = answer.slice(0, Math.max(space[index] - 1, 1)) + '…';
    }

    embed.addFields({
      name: questionNames[index],
      value: answer || 'No answer',
      inline: false,
    });
  });

  return embed;
}

// Turns an application embed into its accepted / denied version.
function applyDecisionToEmbed(originalEmbed, { isAccept, userId, userTag, reason }) {
  const embed = EmbedBuilder.from(originalEmbed)
    .setColor(isAccept ? STATUS_COLORS.accepted : STATUS_COLORS.denied)
    .setFooter({
      text: reason
        ? `${isAccept ? 'Accepted' : 'Denied'} by ${userTag} — ${reason}`.slice(0, 2048)
        : `${isAccept ? 'Accepted' : 'Denied'} by ${userTag}`,
    });

  const status = `${isAccept ? '✅ Accepted' : '❌ Denied'} by <@${userId}>`;
  const fields = embed.data.fields || [];
  const index = fields.findIndex((f) => f.name === 'Status');

  if (index >= 0) {
    embed.spliceFields(index, 1, { name: 'Status', value: status, inline: true });
  } else {
    embed.addFields({ name: 'Status', value: status, inline: true });
  }

  if (reason) {
    embed.addFields({
      name: isAccept ? 'Accept Note' : 'Deny Reason',
      value: reason.slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

/* =========================================================
   APPLICATION REVIEW BUTTONS

   Sent on the application post in the review channel:
   Deny / Deny w/ Reason / Accept / Accept w/ Reason /
   Open Ticket (staff opens a ticket channel with the
   applicant to discuss it — see createApplicationTicketChannel
   in ticketManager.js).

   NOTE ON CUSTOM IDS: handlers match these with .startsWith(),
   so "app_accept_reason_" / "app_close_reason_" must be checked
   BEFORE the bare "app_accept_" / "app_close_" prefixes, since
   the reason variants also start with the bare prefix.
========================================================= */

function buildDecisionRow(userId, appId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`app_accept_${userId}_${appId}`)
      .setLabel('Accept')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`app_accept_reason_${userId}_${appId}`)
      .setLabel('Accept w/ Reason')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`app_close_${userId}_${appId}`)
      .setLabel('Deny')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`app_close_reason_${userId}_${appId}`)
      .setLabel('Deny w/ Reason')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`app_open_ticket_${userId}_${appId}`)
      .setLabel('Open Ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

module.exports = {
  hasApplied,
  markApplied,
  clearApplied,
  updateApplicationRefs,
  getApplicationRefs,
  getApplication,
  buildApplicationEmbed,
  applyDecisionToEmbed,
  buildDecisionRow,
};
