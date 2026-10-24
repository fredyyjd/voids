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
   APPLICATION EMBED (shown in the created ticket)
========================================================= */

function buildApplicationEmbed(member, appConfig, answers) {
  const createdTimestamp = Math.floor(member.user.createdTimestamp / 1000);
  const joinedTimestamp = member.joinedTimestamp
    ? Math.floor(member.joinedTimestamp / 1000)
    : null;

  const embed = new EmbedBuilder().setColor(0x2b2d31)
    .setTitle(`New Application: ${appConfig.label}`)
    .setColor(appConfig.color || '#2b2d31')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Applicant', value: `${member} (${member.user.tag})`, inline: false },
      { name: 'User ID', value: `\`${member.id}\``, inline: true },
      {
        name: 'Account Created',
        value: `<t:${createdTimestamp}:F>\n(<t:${createdTimestamp}:R>)`,
        inline: true,
      },
      {
        name: 'Joined Server',
        value: joinedTimestamp
          ? `<t:${joinedTimestamp}:F>\n(<t:${joinedTimestamp}:R>)`
          : 'Unknown',
        inline: true,
      }
    )
    .setFooter({ text: `User ID: ${member.id}` })
    .setTimestamp();

  appConfig.questions.forEach((question, index) => {
    let answer = answers[index] || 'No answer';
    // Discord embed field values cannot exceed 1024 characters.
    if (answer.length > 1024) answer = answer.slice(0, 1021) + '...';

    let questionName = String(question);
    if (questionName.length > 256) questionName = questionName.slice(0, 253) + '...';

    embed.addFields({ name: questionName, value: answer, inline: false });
  });

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
  buildDecisionRow,
};
