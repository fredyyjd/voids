const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const {
  markApplied,
  clearApplied,
} = require('./applicationManager');

const {
  submitApplication,
} = require('./ticketManager');


const QUESTION_TIMEOUT_MS =
  10 * 60 * 1000;


const activeDmApplications =
  new Set();


const pendingConfirmations =
  new Map();


function keyFor(
  userId,
  appId
) {
  return `${userId}:${appId}`;
}


function isCancel(text) {
  const normalized =
    text
      .trim()
      .toLowerCase();

  return (
    normalized === 'cancel' ||
    normalized === 'cancle'
  );
}


function buildStartCancelRow(
  appId
) {
  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          `dmapp_start_${appId}`
        )
        .setLabel(
          'Start Application'
        )
        .setEmoji(
          '✅'
        )
        .setStyle(
          ButtonStyle.Success
        ),

      new ButtonBuilder()
        .setCustomId(
          `dmapp_cancel_${appId}`
        )
        .setLabel(
          'Cancel Application'
        )
        .setEmoji(
          '❌'
        )
        .setStyle(
          ButtonStyle.Danger
        )
    );
}


/* =========================================================
   START APPLICATION
========================================================= */

async function startDmApplication(
  guild,
  user,
  appId,
  appConfig
) {
  const key =
    keyFor(
      user.id,
      appId
    );


  if (
    activeDmApplications.has(key) ||
    pendingConfirmations.has(key)
  ) {
    return true;
  }


  try {
    const dm =
      await user.createDM();


    if (!dm) {
      return false;
    }


    const questions =
      Array.isArray(
        appConfig.questions
      )
        ? appConfig.questions
        : [];


    if (!questions.length) {
      console.error(
        `[APPLICATION] ${appId} has no questions.`
      );

      return false;
    }


    const embed =
      new EmbedBuilder()
        .setTitle(
          `${appConfig.label}`
        )
        .setDescription(
          'Would you like to start this application?\n\n' +
          `I'll ask you ${questions.length} question(s) one at a time.\n\n` +
          'You can type `cancel` at any time once the application starts.'
        )
        .setColor(
          appConfig.color ||
          '#2b2d31'
        );


    const sent =
      await dm.send({
        embeds: [
          embed,
        ],

        components: [
          buildStartCancelRow(
            appId
          ),
        ],
      });


    if (!sent) {
      return false;
    }


    pendingConfirmations.set(
      key,
      {
        guild,
        appConfig,
      }
    );


    return true;
  }


  catch (err) {
    console.error(
      '[APPLICATION] Failed to start DM application:',
      err
    );

    return false;
  }
}


/* =========================================================
   START BUTTON
========================================================= */

async function handleDmApplicationStart(
  interaction,
  appId
) {
  const key =
    keyFor(
      interaction.user.id,
      appId
    );


  const pending =
    pendingConfirmations.get(
      key
    );


  pendingConfirmations.delete(
    key
  );


  if (!pending) {
    await interaction.update({
      content:
        'This confirmation has expired. Please start the application again from the panel.',

      embeds:
        [],

      components:
        [],
    }).catch(() => {});

    return;
  }


  await interaction.update({
    content:
      `**${pending.appConfig.label}** — let's go!\n\n` +
      'Type `cancel` at any time to cancel your application.',

    embeds:
      [],

    components:
      [],
  });


  const dm =
    await interaction.user
      .createDM()
      .catch(
        () => null
      );


  if (!dm) {
    return;
  }


  activeDmApplications.add(
    key
  );


  runQuestionLoop(
    pending.guild,
    interaction.user,
    dm,
    appId,
    pending.appConfig
  )
    .catch((err) => {
      console.error(
        '[APPLICATION] Question loop error:',
        err
      );
    })
    .finally(() => {
      activeDmApplications.delete(
        key
      );
    });
}


/* =========================================================
   CANCEL BUTTON
========================================================= */

async function handleDmApplicationCancel(
  interaction,
  appId
) {
  const key =
    keyFor(
      interaction.user.id,
      appId
    );


  pendingConfirmations.delete(
    key
  );


  await interaction.update({
    content:
      'Application cancelled.',

    embeds:
      [],

    components:
      [],
  }).catch(() => {});
}


/* =========================================================
   QUESTION LOOP
========================================================= */

async function runQuestionLoop(
  guild,
  user,
  dm,
  appId,
  appConfig
) {
  const answers =
    [];


  const questions =
    Array.isArray(
      appConfig.questions
    )
      ? appConfig.questions
      : [];


  for (
    let i = 0;
    i < questions.length;
    i++
  ) {
    const question =
      questions[i];


    const sent =
      await dm.send(
        `**Question ${i + 1}/${questions.length}:**\n${question}`
      )
      .catch(
        () => null
      );


    if (!sent) {
      console.error(
        '[APPLICATION] Failed to send question DM.'
      );

      return;
    }


    const collected =
      await dm.awaitMessages({
        filter:
          (message) =>
            message.author.id ===
            user.id,

        max:
          1,

        time:
          QUESTION_TIMEOUT_MS,

        errors:
          ['time'],
      })
        .catch(
          () => null
        );


    if (
      !collected ||
      collected.size === 0
    ) {
      await dm.send(
        '⏱️ You took too long to respond — your application has been cancelled.'
      ).catch(() => {});

      return;
    }


    const message =
      collected.first();


    const reply =
      message.content
        .trim();


    if (
      isCancel(
        reply
      )
    ) {
      await dm.send(
        'Application cancelled. You can start again from the panel anytime.'
      ).catch(() => {});

      return;
    }


    answers.push(
      reply ||
      'No answer'
    );
  }


  /*
    Make sure the user is still in the server.
  */

  const member =
    await guild.members
      .fetch(
        user.id
      )
      .catch(
        () => null
      );


  if (!member) {
    await dm.send(
      "Something went wrong submitting your application because I couldn't find you in the server."
    ).catch(() => {});

    return;
  }


  /*
    Mark as pending BEFORE creating.

    If creation fails, clearApplied below removes it again.
  */

  markApplied(
    user.id,
    appId
  );


  console.log(
    '[APPLICATION] Attempting to create application ticket:',
    {
      guildId:
        guild.id,

      userId:
        user.id,

      appId,

      application:
        appConfig.label,
    }
  );


  let posted =
    null;


  try {
    posted =
      await submitApplication(
        guild,
        member,
        appId,
        appConfig,
        answers
      );
  }


  catch (err) {
    console.error(
      '[APPLICATION] submitApplication threw an error:',
      err
    );

    posted =
      null;
  }


  if (!posted) {
    clearApplied(
      user.id,
      appId
    );


    await dm.send(
      "I couldn't submit your application. Please contact staff."
    ).catch(() => {});


    return;
  }


  await dm.send(
    `Application submitted successfully! Staff will review it soon.`
  ).catch(() => {});
}


module.exports = {
  startDmApplication,
  handleDmApplicationStart,
  handleDmApplicationCancel,
};
