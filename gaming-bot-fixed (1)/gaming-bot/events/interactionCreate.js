const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const path = require('path');

const {
  createTicket,
  createApplicationTicketChannel,
  claimTicket,
  unclaimTicket,
  closeTicket,
  buildTicketControlRow,
  getTicketLimitMessage,
} = require('../utils/ticketManager');
const { COLOR } = require('../utils/theme');
const { box } = require('../utils/box');

const {
  hasApplied,
  clearApplied,
  buildDecisionRow,
  getApplication,
  getApplicationRefs,
} = require('../utils/applicationManager');

const {
  startDmApplication,
  handleDmApplicationStart,
  handleDmApplicationQuestion,
  handleDmApplicationCancel,
} = require('../utils/dmApplication');

const config = require('../config.json');

const {
  loadGiveaways,
  saveGiveaways,
  buildGiveawayEmbed,
  buildJoinRow,
  buildLeaveRow,
} = require('../utils/giveawayManager');

const { handleGiveawayInteraction } = require('../utils/giveawayFlow');

const {
  OPTION_LABELS,
  buildStarsRow,
} = require('../utils/vouchManager');

const {
  ensureStaffEmbed,
} = require('../utils/staffTracker');


/* =========================================================
   SUPPORT CHECK
========================================================= */

function hexToInt(hex) {
  if (!hex) return 0x5865f2;
  return parseInt(hex.replace('#', ''), 16);
}

function isSupport(member) {
  if (member?.permissions?.has('Administrator')) return true;

  const roleIds = config.supportRoleIds || [];

  return roleIds.some(
    (id) =>
      id &&
      !id.startsWith('PUT_') &&
      member.roles.cache.has(id)
  );
}


/* =========================================================
   FINALIZE APPLICATION ACCEPT / DENY

   Applications can now be shown in TWO places: the ticket
   channel and the applications log channel. Whichever one
   staff clicked from is updated via interaction.update(),
   and the OTHER copy (found via the stored refs) is edited
   separately so both stay in sync.
========================================================= */

async function finalizeApplicationDecision({
  interaction,
  applicantId,
  appId,
  isAccept,
  reason,
}) {
  const appConfig = getApplication(appId);
  const label = appConfig ? appConfig.label : 'Application';

  const originalEmbed = interaction.message?.embeds?.[0];

  if (!originalEmbed) {
    await interaction.reply({
      content: 'Could not find the application embed.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    return;
  }

  const actionWord = isAccept ? 'Accepted' : 'Denied';

  const footerText = reason
    ? `${actionWord} by ${interaction.user.tag} — ${reason}`
    : `${actionWord} by ${interaction.user.tag}`;

  const updatedEmbed = EmbedBuilder.from(originalEmbed)
    .setColor(0x2b2d31)
    .setFooter({ text: footerText });

  if (reason) {
    updatedEmbed.addFields({
      name: isAccept ? 'Accept Note' : 'Deny Reason',
      value: reason.slice(0, 1024),
      inline: false,
    });
  }

  const disabledRow = buildDecisionRow(applicantId, appId, true);

  await interaction.update({
    embeds: [updatedEmbed],
    components: [disabledRow],
  }).catch(() => {});

  /*
    Update whichever copy of the message this interaction
    did NOT come from (ticket <-> log channel).
  */

  const refs = getApplicationRefs(applicantId, appId);

  if (refs) {
    const isFromTicket = interaction.channelId === refs.ticketChannelId;

    const otherChannelId = isFromTicket
      ? refs.logChannelId
      : refs.ticketChannelId;

    const otherMessageId = isFromTicket
      ? refs.logMessageId
      : refs.ticketMessageId;

    if (otherChannelId && otherMessageId) {
      const otherChannel = await interaction.client.channels
        .fetch(otherChannelId)
        .catch(() => null);

      const otherMessage = otherChannel
        ? await otherChannel.messages.fetch(otherMessageId).catch(() => null)
        : null;

      if (otherMessage) {
        await otherMessage.edit({
          embeds: [updatedEmbed],
          components: [disabledRow],
        }).catch(() => {});
      }
    }
  }

  clearApplied(applicantId, appId);

  const applicant = await interaction.client.users
    .fetch(applicantId)
    .catch(() => null);

  if (applicant) {
    const dmContent = isAccept
      ? reason
        ? `Your **${label}** application in **${interaction.guild.name}** was accepted!\n**Note:** ${reason}`
        : `Your **${label}** application in **${interaction.guild.name}** was accepted!`
      : reason
        ? `Your **${label}** application in **${interaction.guild.name}** was denied.\n**Reason:** ${reason}`
        : `Your **${label}** application in **${interaction.guild.name}** was denied.`;

    await applicant.send(dmContent).catch((err) => {
      console.error(
        `Could not DM applicant ${applicantId}:`,
        err.message
      );
    });
  }
}


/* =========================================================
   RESET NORMAL TICKET DROPDOWN
========================================================= */

async function resetTicketDropdown(message) {
  if (!message) return;

  const categories = config.categories || [];

  if (!categories.length) return;

  const panel = config.panel || {};
  const container = new ContainerBuilder();

  if (panel.title) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${panel.title}`)
    );
  }

  const hasLogo = config.logoUrl && !config.logoUrl.startsWith('PUT_');

  if (hasLogo) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(panel.description)
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(config.logoUrl)
        )
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(panel.description)
    );
  }

  const files = [];
  if (panel.image) {
    let imageUrl = panel.image;

    if (imageUrl.startsWith('attachment://')) {
      const fileName = imageUrl.replace('attachment://', '');
      const filePath = path.join(__dirname, '..', 'assets', fileName);
      files.push(new AttachmentBuilder(filePath, { name: fileName }));
      imageUrl = `attachment://${fileName}`;
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    );
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl)
      )
    );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_category_select')
    .setPlaceholder('Select a ticket category…')
    .addOptions(
      categories
        .slice(0, 25)
        .map((cat) => ({
          label: String(cat.label || cat.id).slice(0, 100),

          description: String(
            cat.description || 'Open a ticket'
          ).slice(0, 100),

          value: String(cat.id),

          emoji: cat.emoji || undefined,
        }))
    );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(menu)
  );

  if (panel.footer) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${panel.footer}`)
    );
  }

  await message
    .edit({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      files,
    })
    .catch((err) => {
      console.error(
        'Failed to reset ticket dropdown:',
        err
      );
    });
}


/* =========================================================
   RESET SERVICE TICKET DROPDOWN
========================================================= */

async function resetServiceTicketDropdown(message) {
  if (!message) return;

  const categories = config.serviceCategories || [];

  if (!categories.length) return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId('service_ticket_category_select')
    .setPlaceholder('Select a service…')
    .addOptions(
      categories
        .slice(0, 25)
        .map((cat) => ({
          label: String(cat.label || cat.id).slice(0, 100),

          description: String(
            cat.description || 'Open a service ticket'
          ).slice(0, 100),

          value: String(cat.id),

          emoji: cat.emoji || undefined,
        }))
    );

  await message
    .edit({
      components: [
        new ActionRowBuilder().addComponents(menu),
      ],
    })
    .catch((err) => {
      console.error(
        'Failed to reset service ticket dropdown:',
        err
      );
    });
}


/* =========================================================
   RESET APPLICATION DROPDOWN
========================================================= */

async function resetApplicationDropdown(message) {
  if (!message) return;

  const apps = config.applications || [];

  if (!apps.length) return;

  const panel = config.applicationsPanel || {};
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${panel.title || 'Applications'}`)
  );

  if (panel.requirementsHeading) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(panel.requirementsHeading)
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
  );

  const requirements = panel.requirements || [];
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      requirements.map((r) => `- ${r}`).join('\n')
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
  );

  const notes = panel.note || [];
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      ['**Note:**', ...notes].join('\n')
    )
  );

  const files = [];
  if (panel.image) {
    let imageUrl = panel.image;

    if (imageUrl.startsWith('attachment://')) {
      const fileName = imageUrl.replace('attachment://', '');
      const filePath = path.join(__dirname, '..', 'assets', fileName);
      files.push(new AttachmentBuilder(filePath, { name: fileName }));
      imageUrl = `attachment://${fileName}`;
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    );
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl)
      )
    );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('application_select')
    .setPlaceholder('Select an application…')
    .addOptions(
      apps
        .slice(0, 25)
        .map((app) => ({
          label: String(
            app.label || app.id
          ).slice(0, 100),

          description: String(
            app.description || 'Apply here'
          ).slice(0, 100),

          value: String(app.id),

          emoji: app.emoji || undefined,
        }))
    );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(menu)
  );

  await message
    .edit({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      files,
    })
    .catch((err) => {
      console.error(
        'Failed to reset application dropdown:',
        err
      );
    });
}


/* =========================================================
   BUILD TICKET QUESTIONS MODAL
========================================================= */

function buildQuestionsModal(category) {
  const questions = category.questions || [];

  const modal = new ModalBuilder()
    .setCustomId(
      `ticket_questions_modal_${category.id}`
    )
    .setTitle(
      String(
        category.label || 'Ticket'
      ).slice(0, 45)
    );

  questions
    .slice(0, 5)
    .forEach((question, i) => {
      const input = new TextInputBuilder()
        .setCustomId(`q_${i}`)
        .setLabel(
          String(question).slice(0, 45)
        )
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(input)
      );
    });

  return modal;
}


/* =========================================================
   BUILD CUSTOM TICKET QUESTIONS MODAL
========================================================= */

function buildCustomQuestionsModal(category, roleId) {
  const questions = category.questions || [];

  const modal = new ModalBuilder()
    .setCustomId(
      `custom_ticket_questions:${category.id}:${roleId}`
    )
    .setTitle(
      String(
        category.label || 'Ticket'
      ).slice(0, 45)
    );

  questions
    .slice(0, 5)
    .forEach((question, i) => {
      const input = new TextInputBuilder()
        .setCustomId(`q_${i}`)
        .setLabel(
          String(question).slice(0, 45)
        )
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(input)
      );
    });

  return modal;
}


/* =========================================================
   FIND NORMAL OR SERVICE CATEGORY
========================================================= */

function findTicketCategory(categoryId) {
  const normalCategory = (
    config.categories || []
  ).find(
    (category) =>
      String(category.id) === String(categoryId)
  );

  if (normalCategory) {
    return normalCategory;
  }

  const serviceCategory = (
    config.serviceCategories || []
  ).find(
    (category) =>
      String(category.id) === String(categoryId)
  );

  return serviceCategory || null;
}


/* =========================================================
   MAIN INTERACTION EVENT
========================================================= */

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {

    try {

      /* =====================================================
         GIVEAWAY FORMS + BUTTONS

         /giveaway start form, Claim Prize (IGN form) and the
         Split or Steal buttons all live in utils/giveawayFlow.js
      ===================================================== */

      if (await handleGiveawayInteraction(interaction)) return;


      /* =====================================================
         SLASH COMMANDS
      ===================================================== */

      if (interaction.isChatInputCommand()) {

        const command =
          interaction.client.commands.get(
            interaction.commandName
          );

        if (!command) return;

        await command.execute(interaction);

        return;
      }


      /* =====================================================
         NORMAL / SERVICE TICKET DROPDOWNS
      ===================================================== */

      if (
        interaction.isStringSelectMenu() &&
        (
          interaction.customId ===
            'ticket_category_select' ||

          interaction.customId ===
            'service_ticket_category_select' ||

          interaction.customId ===
            'service_ticket_select'
        )
      ) {

        const selectedCategoryId =
          interaction.values?.[0];

        if (!selectedCategoryId) {

          return interaction.reply({
            content:
              'No ticket category was selected.',
            flags: MessageFlags.Ephemeral,
          });

        }

        const category =
          findTicketCategory(
            selectedCategoryId
          );

        if (!category) {

          if (
            interaction.customId ===
            'ticket_category_select'
          ) {
            await resetTicketDropdown(
              interaction.message
            );
          } else {
            await resetServiceTicketDropdown(
              interaction.message
            );
          }

          return interaction.reply({
            content:
              'That ticket category could not be found.',
            flags: MessageFlags.Ephemeral,
          });
        }


        const limitMessage = getTicketLimitMessage(
          interaction.guild,
          interaction.user.id
        );

        if (limitMessage) {
          if (
            interaction.customId ===
            'ticket_category_select'
          ) {
            await resetTicketDropdown(interaction.message);
          } else {
            await resetServiceTicketDropdown(interaction.message);
          }

          return interaction.reply({
            content: limitMessage,
            flags: MessageFlags.Ephemeral,
          });
        }

        /* =================================================
           DETERMINE WHICH PANEL WAS USED
        ================================================= */

        const isServicePanel =
          interaction.customId ===
            'service_ticket_category_select' ||
          interaction.customId ===
            'service_ticket_select';


        /* =================================================
           RESET PANEL IMMEDIATELY
           
           This is important because Discord select menus
           visually keep the selected value until the
           original message is edited.
        ================================================= */

        if (isServicePanel) {

          await resetServiceTicketDropdown(
            interaction.message
          );

        } else {

          await resetTicketDropdown(
            interaction.message
          );
        }


        /* =================================================
           CATEGORY HAS QUESTIONS
        ================================================= */

        if (
          Array.isArray(category.questions) &&
          category.questions.length > 0
        ) {

          await interaction.showModal(
            buildQuestionsModal(category)
          );

          return;
        }


        /* =================================================
           CATEGORY HAS NO QUESTIONS
        ================================================= */

        await createTicket(
          interaction,
          selectedCategoryId
        );

        return;
      }


      /* =====================================================
         APPLICATION DM QUESTION MODAL
      ===================================================== */

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'dmapp_question_'
        )
      ) {

        await handleDmApplicationQuestion(
          interaction
        );

        return;
      }


      /* =====================================================
         NORMAL / SERVICE TICKET QUESTIONS MODAL
      ===================================================== */

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'ticket_questions_modal_'
        )
      ) {

        const categoryId =
          interaction.customId.replace(
            'ticket_questions_modal_',
            ''
          );

        const category =
          findTicketCategory(categoryId);

        if (!category) {

          return interaction.reply({
            content:
              'Unknown ticket category.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const questions =
          Array.isArray(category.questions)
            ? category.questions.slice(0, 5)
            : [];

        const answers = questions.map(
          (question, i) => ({
            question,

            answer:
              interaction.fields.getTextInputValue(
                `q_${i}`
              ),
          })
        );

        await createTicket(
          interaction,
          categoryId,
          answers
        );

        return;
      }


      /* =====================================================
         STAFF TRACKER SELECT
      ===================================================== */

      if (
        interaction.isUserSelectMenu() &&
        interaction.customId ===
          'staff_tracker_select'
      ) {

        await interaction.deferUpdate();

        const results = [];

        for (
          const userId of interaction.values
        ) {

          const created =
            await ensureStaffEmbed(
              interaction.guild,
              userId
            );

          results.push(
            `${
              created
                ? 'Created'
                : 'Already exists'
            } — <@${userId}>`
          );
        }

        await interaction.editReply({
          content:
            `Staff tracker setup:\n${results.join(
              '\n'
            )}`,

          components: [],
        });

        return;
      }


      /* =====================================================
         APPLICATION SELECT
      ===================================================== */

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'application_select'
      ) {

        const appId =
          interaction.values?.[0];

        if (!appId) {

          await resetApplicationDropdown(
            interaction.message
          );

          return interaction.reply({
            content:
              'No application was selected.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const appConfig =
          (config.applications || []).find(
            (app) =>
              String(app.id) ===
              String(appId)
          );

        /* =================================================
           INVALID APPLICATION
        ================================================= */

        if (!appConfig) {

          await resetApplicationDropdown(
            interaction.message
          );

          return interaction.reply({
            content:
              'That application no longer exists.',
            flags: MessageFlags.Ephemeral,
          });
        }


        /* =================================================
           CHECK PENDING APPLICATION
        ================================================= */

        if (
          hasApplied(
            interaction.user.id,
            appId
          )
        ) {

          await resetApplicationDropdown(
            interaction.message
          );

          return interaction.reply({
            content:
              'You already have a pending application for this. Please wait for a decision before applying again.',
            flags: MessageFlags.Ephemeral,
          });
        }


        /* =================================================
           RESET APPLICATION PANEL
           
           This happens BEFORE attempting the DM.
           Therefore the dropdown never gets stuck on the
           user's previous selection.
        ================================================= */

        await resetApplicationDropdown(
          interaction.message
        );


        /* =================================================
           SEND APPLICATION TO DMS
        ================================================= */

        const started =
          await startDmApplication(
            interaction.guild,
            interaction.user,
            appId,
            appConfig
          );


        /* =================================================
           DM FAILED
        ================================================= */

        if (!started) {

          return interaction.reply({
            content:
              "I couldn't DM you. Please enable **Direct Messages from server members** and try again.",
            flags: MessageFlags.Ephemeral,
          });
        }


        /* =================================================
           DM SENT
        ================================================= */

        return interaction.reply({
          content:
            'Check your DMs to fill out the application!',
          flags: MessageFlags.Ephemeral,
        });
      }


      /* =====================================================
         BUTTONS
      ===================================================== */

      if (interaction.isButton()) {

        /* =================================================
           CUSTOM TICKET PANEL

           Custom tickets:
           - only the Dev role can see them (plus the ticket owner)
           - no category/parent
           - no support questions
           - closes through the normal ticket close system
        ================================================= */

        if (interaction.customId.startsWith('custom_ticket_create:')) {
          const DEV_ROLE_ID = '1539513728972628058';
          const role = await interaction.guild.roles
            .fetch(DEV_ROLE_ID)
            .catch(() => null);

          if (!role) {
            return interaction.reply({
              content: 'The Dev role could not be found.',
              flags: MessageFlags.Ephemeral,
            });
          }

          const customLimit = getTicketLimitMessage(interaction.guild, interaction.user.id);

          if (customLimit) {
            return interaction.reply({ content: customLimit, flags: MessageFlags.Ephemeral });
          }

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });

          const permissionOverwrites = [
            {
              id: interaction.guild.roles.everyone.id,
              deny: [
                PermissionsBitField.Flags.ViewChannel,
              ],
            },
            {
              id: interaction.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.EmbedLinks,
              ],
            },
            {
              id: DEV_ROLE_ID,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.EmbedLinks,
              ],
            },
          ];

          if (interaction.client.user) {
            permissionOverwrites.push({
              id: interaction.client.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.EmbedLinks,
              ],
            });
          }

          const safeName =
            interaction.user.username
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')
              .slice(0, 20) || 'user';

          try {
            // No parent/category is deliberately specified.
            const channel = await interaction.guild.channels.create({
              name: `custom-${safeName}`,
              type: ChannelType.GuildText,
              topic: `custom_ticket|${interaction.user.id}|${DEV_ROLE_ID}`,
              permissionOverwrites,
            });

            await channel.send({ content: `${interaction.user} <@&${DEV_ROLE_ID}>` });

            await channel.send(
              box(
                [
                  `hi ${interaction.user}, thanks for reaching out.\nexplain what you need and a member of the team will help you shortly.`,
                ],
                { rows: [buildTicketControlRow()] }
              )
            );

            await interaction.editReply({
              ...box(`✅ Your ticket is ready: ${channel}`),
            });
          } catch (err) {
            console.error(
              '[CUSTOM TICKET] Failed to create custom ticket:',
              err
            );

            await interaction.editReply({
              content:
                'Something went wrong creating your ticket. Please contact staff.',
            }).catch(() => {});
          }

          return;
        }

        /* =================================================
           SERVICE TICKET BUTTONS
           The /service-tickets command uses buttons with:
           service_ticket_open_<serviceId>
        ================================================= */

        if (interaction.customId.startsWith('service_ticket_open_')) {
          const categoryId = interaction.customId.replace('service_ticket_open_', '');
          const category = findTicketCategory(categoryId);

          if (!category || !(config.serviceCategories || []).some((c) => c.id === categoryId)) {
            return interaction.reply({
              content: 'That service could not be found.',
              flags: MessageFlags.Ephemeral,
            });
          }

          const serviceLimit = getTicketLimitMessage(interaction.guild, interaction.user.id);
          if (serviceLimit) {
            return interaction.reply({ content: serviceLimit, flags: MessageFlags.Ephemeral });
          }

          if (Array.isArray(category.questions) && category.questions.length > 0) {
            await interaction.showModal(buildQuestionsModal(category));
            return;
          }

          await createTicket(interaction, categoryId);
          return;
        }


        /* =================================================
           DM APPLICATION START
        ================================================= */

        if (
          interaction.customId.startsWith(
            'dmapp_start_'
          )
        ) {

          const applicationData =
            interaction.customId.replace(
              'dmapp_start_',
              ''
            );

          await handleDmApplicationStart(
            interaction,
            applicationData
          );

          return;
        }


        /* =================================================
           DM APPLICATION CANCEL
        ================================================= */

        if (
          interaction.customId.startsWith(
            'dmapp_cancel_'
          )
        ) {

          const applicationData =
            interaction.customId.replace(
              'dmapp_cancel_',
              ''
            );

          await handleDmApplicationCancel(
            interaction,
            applicationData
          );

          return;
        }


        /* =================================================
           VOUCH NO
        ================================================= */

        if (
          interaction.customId.startsWith(
            'vouch_no_'
          )
        ) {

          const rest =
            interaction.customId.replace(
              'vouch_no_',
              ''
            );

          const [
            requesterId,
            optionValue,
          ] = rest.split('|');

          const optionLabel =
            OPTION_LABELS[
              optionValue
            ] || optionValue;


          await interaction.update({
            embeds: [
              new EmbedBuilder().setColor(0x2b2d31)
                .setDescription(
                  'No worries — thanks for letting us know!'
                )
                .setColor(0x2b2d31),
            ],

            components: [],
          });


          const logChannelId =
            config.vouchLogChannelId;

          if (
            logChannelId &&
            !logChannelId.startsWith('PUT_')
          ) {

            const logChannel =
              await interaction.client.channels
                .fetch(logChannelId)
                .catch(() => null);

            if (logChannel) {

              const logEmbed =
                new EmbedBuilder().setColor(0x2b2d31)
                  .setTitle('Vouch Declined')
                  .addFields(
                    {
                      name: 'From',
                      value:
                        `${interaction.user.tag} (${interaction.user.id})`,
                      inline: true,
                    },
                    {
                      name: 'Requested by',
                      value:
                        `<@${requesterId}>`,
                      inline: true,
                    },
                    {
                      name: 'Category',
                      value:
                        optionLabel,
                      inline: true,
                    }
                  )
                  .setColor(0x2b2d31)
                  .setTimestamp();

              await logChannel
                .send({
                  embeds: [logEmbed],
                })
                .catch(() => {});
            }
          }

          return;
        }


        /* =================================================
           VOUCH YES
        ================================================= */

        if (
          interaction.customId.startsWith(
            'vouch_yes_'
          )
        ) {

          const rest =
            interaction.customId.replace(
              'vouch_yes_',
              ''
            );

          const [
            requesterId,
            optionValue,
          ] = rest.split('|');

          await interaction.update({
            embeds: [
              new EmbedBuilder().setColor(0x2b2d31)
                .setDescription(
                  'Awesome! How many stars would you like to give? (1-5)'
                )
                .setColor('#2b2d31'),
            ],

            components: [
              buildStarsRow(
                requesterId,
                optionValue
              ),
            ],
          });

          return;
        }


        /* =================================================
           VOUCH STARS
        ================================================= */

        if (
          interaction.customId.startsWith(
            'vouch_stars_'
          )
        ) {

          const rest =
            interaction.customId.replace(
              'vouch_stars_',
              ''
            );

          const [
            requesterId,
            optionValue,
            stars,
          ] = rest.split('|');

          const modal =
            new ModalBuilder()
              .setCustomId(
                `vouch_comment_modal_${requesterId}|${optionValue}|${stars}`
              )
              .setTitle(
                'Leave a Comment'
              );

          const commentInput =
            new TextInputBuilder()
              .setCustomId(
                'vouch_comment_input'
              )
              .setLabel(
                'Comment (optional)'
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setRequired(false)
              .setMaxLength(500);

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              commentInput
            )
          );

          await interaction.showModal(
            modal
          );

          return;
        }


        /* =================================================
           GIVEAWAY JOIN
        ================================================= */

        if (
          interaction.customId ===
          'giveaway_join'
        ) {

          const giveaways =
            loadGiveaways();

          const giveaway =
            giveaways[
              interaction.message.id
            ];

          if (
            !giveaway ||
            giveaway.ended
          ) {

            return interaction.reply({
              content:
                'This giveaway has ended.',
              flags: MessageFlags.Ephemeral,
            });
          }

          if (
            !Array.isArray(
              giveaway.entrants
            )
          ) {
            giveaway.entrants = [];
          }

          const userId =
            interaction.user.id;

          if (
            giveaway.entrants.includes(
              userId
            )
          ) {

            return interaction.reply({
              content:
                'You already joined the giveaway.',
              components: [
                buildLeaveRow(
                  interaction.message.id
                ),
              ],
              flags: MessageFlags.Ephemeral,
            });
          }

          giveaway.entrants.push(
            userId
          );

          saveGiveaways(
            giveaways
          );

          await interaction.reply({
            content:
              'You joined the giveaway!',
            components: [
              buildLeaveRow(
                interaction.message.id
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });

          const updatedEmbed =
            buildGiveawayEmbed(
              giveaway
            );

          await interaction.message
            .edit({
              embeds: [
                updatedEmbed,
              ],
              components: [
                buildJoinRow(
                  giveaway.entrants.length
                ),
              ],
            })
            .catch(() => {});

          return;
        }


        /* =================================================
           GIVEAWAY LEAVE
        ================================================= */

        if (
          interaction.customId.startsWith(
            'giveaway_leave_'
          )
        ) {

          const messageId =
            interaction.customId.replace(
              'giveaway_leave_',
              ''
            );

          const giveaways =
            loadGiveaways();

          const giveaway =
            giveaways[messageId];

          if (
            !giveaway ||
            giveaway.ended
          ) {

            return interaction.update({
              content:
                'This giveaway has ended.',
              components: [],
            });
          }

          if (
            !Array.isArray(
              giveaway.entrants
            )
          ) {
            giveaway.entrants = [];
          }

          const userId =
            interaction.user.id;

          const idx =
            giveaway.entrants.indexOf(
              userId
            );

          if (idx === -1) {

            return interaction.update({
              content:
                'You are not entered in this giveaway.',
              components: [],
            });
          }

          giveaway.entrants.splice(
            idx,
            1
          );

          saveGiveaways(
            giveaways
          );

          await interaction.update({
            content:
              'You left the giveaway.',
            components: [],
          });

          try {

            const channel =
              await interaction.client.channels.fetch(
                giveaway.channelId
              );

            const message =
              await channel.messages.fetch(
                messageId
              );

            await message.edit({
              embeds: [
                buildGiveawayEmbed(
                  giveaway
                ),
              ],
              components: [
                buildJoinRow(
                  giveaway.entrants.length
                ),
              ],
            });

          } catch (error) {

            console.error(
              'Giveaway update error:',
              error
            );
          }

          return;
        }


        /* =================================================
           REACTION ROLES
        ================================================= */

        if (
          interaction.customId.startsWith(
            'rr_'
          )
        ) {

          const roleId =
            interaction.customId.replace(
              'rr_',
              ''
            );

          const member =
            interaction.member;

          await interaction.deferReply({
            flags: MessageFlags.Ephemeral,
          });

          const role =
            await interaction.guild.roles
              .fetch(roleId)
              .catch(() => null);

          if (!role) {

            return interaction.editReply({
              content:
                'That role no longer exists.',
            });
          }

          const configEntry =
            (
              config.reactionRoles?.roles ||
              []
            ).find(
              (r) =>
                r.roleId === roleId
            );

          const displayName =
            configEntry?.label ||
            role.name;


          if (
            member.roles.cache.has(
              roleId
            )
          ) {

            try {

              await member.roles.remove(
                roleId
              );

              await interaction.editReply({
                content:
                  `Removed the **${displayName}** role.`,
              });

            } catch (err) {

              console.error(
                `Failed to remove role ${roleId}:`,
                err
              );

              await interaction.editReply({
                content:
                  `I couldn't remove the **${displayName}** role — check that my bot role is above it.`,
              });
            }

          } else {

            try {

              await member.roles.add(
                roleId
              );

              await interaction.editReply({
                content:
                  `Gave you the **${displayName}** role!`,
              });

            } catch (err) {

              console.error(
                `Failed to add role ${roleId}:`,
                err
              );

              await interaction.editReply({
                content:
                  `I couldn't give you the **${displayName}** role — check that my bot role is above it.`,
              });
            }
          }

          return;
        }


        /* =================================================
           TICKET CLAIM
        ================================================= */

        if (
          interaction.customId ===
          'ticket_claim'
        ) {

          await claimTicket(
            interaction
          );

          return;
        }


        /* =================================================
           TICKET UNCLAIM
        ================================================= */

        if (
          interaction.customId.startsWith(
            'ticket_unclaim'
          )
        ) {

          await unclaimTicket(
            interaction
          );

          return;
        }


        /* =================================================
           TICKET CLOSE
        ================================================= */

        if (
          interaction.customId ===
          'ticket_close'
        ) {

          await closeTicket(
            interaction,
            null
          );

          return;
        }

        /* =================================================
           CLOSE WITH REASON
        ================================================= */

        if (
          interaction.customId ===
          'ticket_close_reason'
        ) {

          const modal =
            new ModalBuilder()
              .setCustomId(
                'ticket_close_reason_modal'
              )
              .setTitle(
                'Close Ticket'
              );

          const reasonInput =
            new TextInputBuilder()
              .setCustomId(
                'close_reason_input'
              )
              .setLabel(
                'Reason for closing'
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setPlaceholder(
                'e.g. Issue resolved'
              )
              .setRequired(true)
              .setMaxLength(500);

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              reasonInput
            )
          );

          await interaction.showModal(
            modal
          );

          return;
        }


        /* =================================================
           APPLICATION ACCEPT / CLOSE (+ w/ REASON variants)

           NOTE: "app_accept_reason_" / "app_close_reason_"
           are checked as their own prefixes here — since they
           also start with "app_accept_" / "app_close_", the
           bare-vs-reason distinction is made explicitly below
           rather than with .startsWith() elimination.
        ================================================= */

        if (
          interaction.customId.startsWith('app_accept_reason_') ||
          interaction.customId.startsWith('app_close_reason_') ||
          interaction.customId.startsWith('app_accept_') ||
          interaction.customId.startsWith('app_close_')
        ) {

          const wantsReason =
            interaction.customId.startsWith('app_accept_reason_') ||
            interaction.customId.startsWith('app_close_reason_');

          const isAccept =
            interaction.customId.startsWith('app_accept_reason_') ||
            interaction.customId.startsWith('app_accept_');

          const prefix = wantsReason
            ? (isAccept ? 'app_accept_reason_' : 'app_close_reason_')
            : (isAccept ? 'app_accept_' : 'app_close_');

          /*
            Format:

            app_accept_USERID_APPID
            app_accept_reason_USERID_APPID
            app_close_USERID_APPID
            app_close_reason_USERID_APPID

            Split only at the FIRST underscore.
          */

          const rest = interaction.customId.slice(prefix.length);
          const separator = rest.indexOf('_');

          if (separator === -1) {
            return interaction.reply({
              content: 'Invalid application button.',
              flags: MessageFlags.Ephemeral,
            });
          }

          const applicantId = rest.slice(0, separator);
          const appId = rest.slice(separator + 1);


          /* =================================================
             STAFF CHECK
          ================================================= */

          if (
            !interaction.member ||
            !isSupport(interaction.member)
          ) {

            return interaction.reply({
              content:
                'Only staff can accept or deny applications.',
              flags: MessageFlags.Ephemeral,
            });
          }


          /* =================================================
             NO REASON — process immediately
          ================================================= */

          if (!wantsReason) {
            await finalizeApplicationDecision({
              interaction,
              applicantId,
              appId,
              isAccept,
            });

            return;
          }


          /* =================================================
             WITH REASON — ask staff for it first
          ================================================= */

          const reasonModal =
            new ModalBuilder()
              .setCustomId(
                `${prefix}modal_${applicantId}_${appId}`
              )
              .setTitle(
                isAccept ? 'Accept Application' : 'Deny Application'
              );

          const reasonInput =
            new TextInputBuilder()
              .setCustomId('decision_reason_input')
              .setLabel(
                isAccept ? 'Note for the applicant' : 'Reason for denying'
              )
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder(
                isAccept
                  ? 'e.g. Welcome to the team!'
                  : 'e.g. Did not meet requirements'
              )
              .setRequired(true)
              .setMaxLength(500);

          reasonModal.addComponents(
            new ActionRowBuilder().addComponents(reasonInput)
          );

          await interaction.showModal(reasonModal);

          return;
        }


        /* =================================================
           OPEN TICKET (staff-triggered, from the review post)

           Creates the per-applicant ticket channel on demand
           instead of automatically at submission time.
        ================================================= */

        if (
          interaction.customId.startsWith('app_open_ticket_')
        ) {

          const rest = interaction.customId.replace(
            'app_open_ticket_',
            ''
          );

          const separator = rest.indexOf('_');

          if (separator === -1) {
            return interaction.reply({
              content: 'Invalid ticket button.',
              flags: MessageFlags.Ephemeral,
            });
          }

          const applicantId = rest.slice(0, separator);
          const appId = rest.slice(separator + 1);

          if (
            !interaction.member ||
            !isSupport(interaction.member)
          ) {

            return interaction.reply({
              content:
                'Only staff can open a ticket for an application.',
              flags: MessageFlags.Ephemeral,
            });
          }

          const refs = getApplicationRefs(applicantId, appId);

          // Already has a live ticket channel? Point staff at it
          // instead of creating a duplicate.
          if (refs?.ticketChannelId) {
            const existing = await interaction.guild.channels
              .fetch(refs.ticketChannelId)
              .catch(() => null);

            if (existing) {
              return interaction.reply({
                content: `A ticket is already open: ${existing}`,
                flags: MessageFlags.Ephemeral,
              });
            }
          }

          const appConfig = getApplication(appId);

          if (!appConfig) {
            return interaction.reply({
              content: "Couldn't find that application's configuration.",
              flags: MessageFlags.Ephemeral,
            });
          }

          const member = await interaction.guild.members
            .fetch(applicantId)
            .catch(() => null);

          if (!member) {
            return interaction.reply({
              content: 'Could not find that applicant in this server.',
              flags: MessageFlags.Ephemeral,
            });
          }

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });

          const channel = await createApplicationTicketChannel(
            interaction.guild,
            member,
            appId,
            appConfig,
            refs?.answers || []
          );

          if (!channel) {
            return interaction.editReply({
              content: 'Failed to create the ticket channel.',
            });
          }

          return interaction.editReply({
            content: `Ticket opened: ${channel}`,
          });
        }
      }


      /* =====================================================
         APPLICATION ACCEPT / CLOSE — REASON MODAL SUBMIT
      ===================================================== */

      if (
        interaction.isModalSubmit() &&
        (
          interaction.customId.startsWith('app_accept_reason_modal_') ||
          interaction.customId.startsWith('app_close_reason_modal_')
        )
      ) {

        const isAccept = interaction.customId.startsWith(
          'app_accept_reason_modal_'
        );

        const prefix = isAccept
          ? 'app_accept_reason_modal_'
          : 'app_close_reason_modal_';

        const rest = interaction.customId.slice(prefix.length);
        const separator = rest.indexOf('_');

        if (separator === -1) {
          return interaction.reply({
            content: 'Invalid application button.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const applicantId = rest.slice(0, separator);
        const appId = rest.slice(separator + 1);

        if (
          !interaction.member ||
          !isSupport(interaction.member)
        ) {

          return interaction.reply({
            content:
              'Only staff can accept or deny applications.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const reason =
          interaction.fields.getTextInputValue(
            'decision_reason_input'
          );

        await finalizeApplicationDecision({
          interaction,
          applicantId,
          appId,
          isAccept,
          reason,
        });

        return;
      }


      /* =====================================================
         CLOSE REASON MODAL
      ===================================================== */

      if (
        interaction.isModalSubmit() &&
        interaction.customId ===
          'ticket_close_reason_modal'
      ) {

        const reason =
          interaction.fields
            .getTextInputValue(
              'close_reason_input'
            );

        await closeTicket(
          interaction,
          reason
        );

        return;
      }


      /* =====================================================
         VOUCH COMMENT MODAL
      ===================================================== */

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'vouch_comment_modal_'
        )
      ) {

        const rest =
          interaction.customId.replace(
            'vouch_comment_modal_',
            ''
          );

        const [
          requesterId,
          optionValue,
          stars,
        ] = rest.split('|');

        const comment =
          interaction.fields
            .getTextInputValue(
              'vouch_comment_input'
            ) ||
          'No comment left.';

        const optionLabel =
          OPTION_LABELS[
            optionValue
          ] ||
          optionValue;

        const starsNum =
          parseInt(
            stars,
            10
          );

        const safeStars =
          Math.max(
            1,
            Math.min(
              5,
              Number.isNaN(
                starsNum
              )
                ? 5
                : starsNum
            )
          );

        const starDisplay =
          '⭐'.repeat(
            safeStars
          ) +
          '☆'.repeat(
            5 - safeStars
          );


        await interaction.update({
          embeds: [
            new EmbedBuilder().setColor(0x2b2d31)
              .setDescription(
                'Thanks for your vouch!'
              )
              .setColor(
                0x2b2d31
              ),
          ],

          components: [],
        });


        const vouchChannelId =
          config.vouchChannelId;

        if (
          vouchChannelId &&
          !vouchChannelId.startsWith(
            'PUT_'
          )
        ) {

          const vouchChannel =
            await interaction.client.channels
              .fetch(
                vouchChannelId
              )
              .catch(
                () => null
              );

          if (vouchChannel) {

            const requester =
              await interaction.client.users
                .fetch(
                  requesterId
                )
                .catch(
                  () => null
                );

            const vouchEmbed =
              new EmbedBuilder().setColor(0x2b2d31)
                .setTitle(
                  '⭐ New Vouch'
                )
                .addFields(
                  {
                    name:
                      'Vouch For',

                    value:
                      requester
                        ? `${requester}`
                        : `<@${requesterId}>`,

                    inline: true,
                  },

                  {
                    name:
                      'From',

                    value:
                      `${interaction.user}`,

                    inline: true,
                  },

                  {
                    name:
                      'Category',

                    value:
                      optionLabel,

                    inline: true,
                  },

                  {
                    name:
                      'Rating',

                    value:
                      starDisplay,
                  },

                  {
                    name:
                      'Comment',

                    value:
                      comment,
                  }
                )
                .setColor(
                  0x2b2d31
                )
                .setTimestamp();


            await vouchChannel
              .send({
                embeds: [
                  vouchEmbed,
                ],
              })
              .catch(
                () => {}
              );
          }
        }

        return;
      }

    } catch (err) {

      console.error(
        'Error handling interaction:',
        err
      );

      try {

        if (
          interaction.deferred ||
          interaction.replied
        ) {

          await interaction.followUp({
            content:
              'Something went wrong handling that action.',
            flags: MessageFlags.Ephemeral,
          });

        } else {

          await interaction.reply({
            content:
              'Something went wrong handling that action.',
            flags: MessageFlags.Ephemeral,
          });
        }

      } catch (_) {}
    }
  },
};
