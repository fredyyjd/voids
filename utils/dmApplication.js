const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} = require('discord.js');

const { markApplied, clearApplied } = require('./applicationManager');
const { submitApplication } = require('./ticketManager');

const QUESTION_TIMEOUT_MS = 10 * 60 * 1000;
const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;

const activeDmApplications = new Set();
const pendingConfirmations = new Map();

function keyFor(userId, appId) {
  return `${userId}:${appId}`;
}

function isCancel(text) {
  const normalized = text.trim().toLowerCase();
  return normalized === 'cancel' || normalized === 'cancle';
}

function colorOf(appConfig) {
  return appConfig.color || '#3B82F6';
}

function progressBar(done, total, size = 10) {
  const filled = Math.round((done / total) * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

function buildStartCancelRow(appId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dmapp_start_${appId}`)
      .setLabel('Start Application')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dmapp_cancel_${appId}`)
      .setLabel('Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );
}

function questionEmbed(appConfig, index, total, question) {
  return new EmbedBuilder()
    .setColor(colorOf(appConfig))
    .setAuthor({ name: appConfig.label })
    .setTitle(`Question ${index + 1} of ${total}`)
    .setDescription(`**${question}**`)
    .setFooter({ text: `${progressBar(index, total)}  ${index}/${total} answered • type cancel to stop` });
}

/* =========================================================
   START APPLICATION
========================================================= */

async function startDmApplication(guild, user, appId, appConfig) {
  const key = keyFor(user.id, appId);

  if (activeDmApplications.has(key) || pendingConfirmations.has(key)) {
    return true;
  }

  try {
    const dm = await user.createDM();
    if (!dm) return false;

    const questions = Array.isArray(appConfig.questions) ? appConfig.questions : [];

    if (!questions.length) {
      console.error(`[APPLICATION] ${appId} has no questions.`);
      return false;
    }

    const minutes = Math.max(2, Math.round(questions.length * 0.75));

    const embed = new EmbedBuilder()
      .setColor(colorOf(appConfig))
      .setTitle(`${appConfig.emoji ? appConfig.emoji + ' ' : ''}${appConfig.label}`)
      .setDescription(
        `${appConfig.description ? `*${appConfig.description}*\n\n` : ''}` +
        `I'll ask you **${questions.length} questions**, one at a time (about ${minutes} minutes).\n\n` +
        '• Take your time and write real answers, short ones get denied\n' +
        '• You get 10 minutes per question\n' +
        '• Type `cancel` at any point to stop\n\n' +
        '**Ready to start?**'
      )
      .setFooter({ text: guild.name });

    const sent = await dm.send({
      embeds: [embed],
      components: [buildStartCancelRow(appId)],
    });

    if (!sent) return false;

    pendingConfirmations.set(key, { guild, appConfig });

    return true;
  } catch (err) {
    console.error('[APPLICATION] Failed to start DM application:', err);
    return false;
  }
}

/* =========================================================
   START BUTTON
========================================================= */

async function handleDmApplicationStart(interaction, appId) {
  const key = keyFor(interaction.user.id, appId);

  const pending = pendingConfirmations.get(key);
  pendingConfirmations.delete(key);

  if (!pending) {
    await interaction
      .update({
        content: 'This confirmation has expired. Please start the application again from the panel.',
        embeds: [],
        components: [],
      })
      .catch(() => {});
    return;
  }

  await interaction.update({
    content: `**${pending.appConfig.label}** - let's go!`,
    embeds: [],
    components: [],
  });

  const dm = await interaction.user.createDM().catch(() => null);
  if (!dm) return;

  activeDmApplications.add(key);

  runQuestionLoop(pending.guild, interaction.user, dm, appId, pending.appConfig)
    .catch((err) => {
      console.error('[APPLICATION] Question loop error:', err);
    })
    .finally(() => {
      activeDmApplications.delete(key);
    });
}

/* =========================================================
   CANCEL BUTTON
========================================================= */

async function handleDmApplicationCancel(interaction, appId) {
  const key = keyFor(interaction.user.id, appId);
  pendingConfirmations.delete(key);

  await interaction
    .update({
      content: 'Application cancelled.',
      embeds: [],
      components: [],
    })
    .catch(() => {});
}

/* =========================================================
   REVIEW STEP (submit / cancel before it goes to staff)
========================================================= */

async function askToSubmit(dm, user, appConfig, answers) {
  const embed = new EmbedBuilder()
    .setColor(colorOf(appConfig))
    .setTitle('All done - submit your application?')
    .setDescription(
      `You answered all **${answers.length}** questions for **${appConfig.label}**.\n\n` +
      'Press **Submit** to send it to staff, or **Cancel** to throw it away.'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dmapp_review_submit')
      .setLabel('Submit')
      .setEmoji('📨')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('dmapp_review_cancel')
      .setLabel('Cancel')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
  );

  const prompt = await dm.send({ embeds: [embed], components: [row] }).catch(() => null);
  if (!prompt) return 'error';

  const press = await prompt
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === user.id,
      time: REVIEW_TIMEOUT_MS,
    })
    .catch(() => null);

  if (!press) {
    await prompt.edit({ components: [] }).catch(() => {});
    return 'timeout';
  }

  const submit = press.customId === 'dmapp_review_submit';

  await press
    .update({
      embeds: [
        new EmbedBuilder()
          .setColor(colorOf(appConfig))
          .setDescription(submit ? '📨 Sending your application...' : '🗑️ Application discarded.'),
      ],
      components: [],
    })
    .catch(() => {});

  return submit ? 'submit' : 'cancel';
}

/* =========================================================
   QUESTION LOOP
========================================================= */

async function runQuestionLoop(guild, user, dm, appId, appConfig) {
  const answers = [];
  const questions = Array.isArray(appConfig.questions) ? appConfig.questions : [];

  for (let i = 0; i < questions.length; i++) {
    const sent = await dm
      .send({ embeds: [questionEmbed(appConfig, i, questions.length, questions[i])] })
      .catch(() => null);

    if (!sent) {
      console.error('[APPLICATION] Failed to send question DM.');
      return;
    }

    const collected = await dm
      .awaitMessages({
        filter: (message) => message.author.id === user.id,
        max: 1,
        time: QUESTION_TIMEOUT_MS,
        errors: ['time'],
      })
      .catch(() => null);

    if (!collected || collected.size === 0) {
      await dm
        .send('⏱️ You took too long to respond, so your application was cancelled. You can start again from the panel.')
        .catch(() => {});
      return;
    }

    const reply = collected.first().content.trim();

    if (isCancel(reply)) {
      await dm.send('Application cancelled. You can start again from the panel anytime.').catch(() => {});
      return;
    }

    answers.push(reply || 'No answer');
  }

  // Let them look it over before it goes to staff.
  const decision = await askToSubmit(dm, user, appConfig, answers);

  if (decision === 'cancel') return;

  if (decision === 'timeout') {
    await dm.send('⏱️ No answer, so your application was not submitted. You can start again from the panel.').catch(() => {});
    return;
  }

  if (decision === 'error') return;

  // Make sure the user is still in the server.
  const member = await guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    await dm
      .send("Something went wrong submitting your application because I couldn't find you in the server.")
      .catch(() => {});
    return;
  }

  // Mark as pending BEFORE creating. If creation fails, clearApplied removes it again.
  markApplied(user.id, appId);

  console.log('[APPLICATION] Attempting to create application:', {
    guildId: guild.id,
    userId: user.id,
    appId,
    application: appConfig.label,
  });

  let posted = null;

  try {
    posted = await submitApplication(guild, member, appId, appConfig, answers);
  } catch (err) {
    console.error('[APPLICATION] submitApplication threw an error:', err);
    posted = null;
  }

  if (!posted) {
    clearApplied(user.id, appId);
    await dm.send("I couldn't submit your application. Please contact staff.").catch(() => {});
    return;
  }

  await dm
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('Application submitted ✅')
          .setDescription(
            `Your **${appConfig.label}** application is in. Staff will review it soon and you'll get a DM with the result.\n\n` +
            "Please don't ask about it, that lowers your chances."
          ),
      ],
    })
    .catch(() => {});
}

module.exports = {
  startDmApplication,
  handleDmApplicationStart,
  handleDmApplicationCancel,
};
