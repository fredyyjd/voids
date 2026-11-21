const { EmbedBuilder } = require('discord.js');
const { hasMaxPerms, isMod, isSupport, canModerate } = require('../utils/permissions');
const { parseDuration, addTempBan, scheduleUnban } = require('../utils/tempBanManager');
const { recordAction } = require('../utils/antiNuke');
const { addWarning, removeWarning } = require('../utils/warnManager');
const {
  setSticky,
  removeSticky,
  getSticky,
  updateLastMessageId,
  buildStickyEmbed,
} = require('../utils/stickyManager');
const { setAfk } = require('../utils/afkManager');
const staffStore = require('../utils/staffStore');
const autoMod = require('../utils/autoMod');
const { COLOR } = require('../utils/theme');

const PREFIX = 'v!';
const TICK = '<:green_tick_head:1573510507854303323>';
const CROSS = '<:red_x_head:1573510477215174869>';
const LOADING = '<:blue_loading_head:1573510444889546942>';
const HIGH_STAFF_ROLE_ID = '1546692052031377568';

const GREEN = 0x57f287;
const RED = 0xed4245;
const YELLOW = 0xfee75c;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const MAX_TARGETS = 10;
const NO_REASON = 'No reason provided';

class UserError extends Error {}

const isHighStaff = (member) => hasMaxPerms(member) || Boolean(member?.roles?.cache?.has(HIGH_STAFF_ROLE_ID));
const isStaff = (member) => isMod(member) || isSupport(member) || isHighStaff(member);
const isEveryone = () => true;

function formatMs(ms) {
  const parts = [];
  const units = [
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
    ['second', 1000],
  ];
  let left = ms;
  for (const [name, size] of units) {
    const count = Math.floor(left / size);
    if (count) {
      parts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
      left -= count * size;
    }
  }
  return parts.join(' ') || '0 seconds';
}

function takeTargets(args) {
  const ids = [];
  let index = 0;
  while (index < args.length) {
    const match = /^<@!?(\d{15,25})>$/.exec(args[index]) || /^(\d{15,25})$/.exec(args[index]);
    if (!match) break;
    if (!ids.includes(match[1])) ids.push(match[1]);
    index++;
  }
  return { ids, rest: args.slice(index) };
}

function failure(title, text) {
  return { embed: new EmbedBuilder().setColor(RED).setTitle(`${CROSS} ${title}`).setDescription(text) };
}

function usage(text) {
  return failure('Wrong layout', `Use it like this:\n\`${text}\``);
}

function guardTarget(guild, client, author, target) {
  if (target.id === author.id) throw new UserError("You can't do that to yourself.");
  if (target.id === client.user.id) throw new UserError("You can't do that to me.");
  if (target.id === guild.ownerId) throw new UserError("You can't do that to the owner.");
  if (author.id !== guild.ownerId && !canModerate(author, target)) {
    throw new UserError('Their role is the same as or above yours.');
  }
}

async function logAction(guild, { title, moderator, channelId, ids, reason, extra = [], color = RED }) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      { name: 'Moderator', value: `<@${moderator.id}> (${moderator.user.tag})`, inline: true },
      { name: 'Channel', value: `<#${channelId}>`, inline: true },
      ...(ids.length ? [{ name: 'Targets', value: ids.map((id) => `<@${id}>`).join('\n').slice(0, 1000) }] : []),
      ...extra,
      { name: 'Reason', value: String(reason || NO_REASON).slice(0, 1000) }
    )
    .setFooter({ text: 'Prefix command' })
    .setTimestamp();
  await autoMod.sendLog(guild, autoMod.settings(), embed);
}

async function runTargets(ctx, o) {
  const list = o.ids.slice(0, MAX_TARGETS);
  const lines = [];
  const done = [];

  for (const id of list) {
    const author = await ctx.guild.members.fetch({ user: ctx.member.id, force: true }).catch(() => null);
    if (!author || !o.allowed(author)) {
      lines.push(`${CROSS} Stopped. You no longer have permission.`);
      break;
    }

    try {
      const detail = await o.act(id, author);
      done.push(id);
      lines.push(`${TICK} <@${id}>${detail ? ` - ${detail}` : ''}`);
    } catch (err) {
      if (!(err instanceof UserError)) console.error(`[prefix] ${o.logTitle} error:`, err);
      lines.push(`${CROSS} <@${id}> - ${err instanceof UserError ? err.message : 'Something went wrong.'}`);
    }
  }

  if (o.ids.length > MAX_TARGETS) lines.push(`-# Only the first ${MAX_TARGETS} were handled.`);

  const all = done.length === list.length;
  const embed = new EmbedBuilder()
    .setColor(done.length ? (all ? GREEN : YELLOW) : RED)
    .setTitle(
      done.length
        ? `${TICK} ${o.doneTitle}${all ? '' : ` (${done.length}/${list.length})`}`
        : `${CROSS} ${o.failTitle}`
    )
    .setDescription(lines.join('\n').slice(0, 4000))
    .addFields({ name: 'Reason', value: o.reason.slice(0, 1000) });

  if (done.length) {
    staffStore.recordDuty(ctx.member.id, 'mod', ctx.message.id);
    await logAction(ctx.guild, {
      title: o.logTitle,
      moderator: ctx.member,
      channelId: ctx.message.channelId,
      ids: done,
      reason: o.reason,
      extra: o.logExtra || [],
    }).catch((err) => console.error('[prefix] log failed:', err.message));
  }

  return { embed };
}

async function runTimeout(ctx) {
  const { ids, rest } = takeTargets(ctx.args);
  const ms = parseDuration(rest[0]);
  if (!ids.length || !ms) return usage('v!to @user 10s reason');
  if (ms > MAX_TIMEOUT_MS) return failure("Couldn't time out", 'Timeouts max out at **28 days**.');
  const reason = rest.slice(1).join(' ') || NO_REASON;

  return runTargets(ctx, {
    ids,
    reason,
    allowed: isStaff,
    doneTitle: 'Timed out successfully',
    failTitle: "Couldn't time out",
    logTitle: 'Timeout',
    logExtra: [{ name: 'Length', value: formatMs(ms), inline: true }],
    async act(id, author) {
      const member = await ctx.guild.members.fetch(id).catch(() => null);
      if (!member) throw new UserError("They aren't in the server.");
      guardTarget(ctx.guild, ctx.client, author, member);
      if (!member.moderatable) throw new UserError('Their role is above mine.');
      await member.timeout(ms, `${reason} | by ${author.user.tag}`.slice(0, 450));
      return `for ${formatMs(ms)}`;
    },
  });
}

async function runKick(ctx) {
  const { ids, rest } = takeTargets(ctx.args);
  if (!ids.length) return usage('v!kick @user reason');
  const reason = rest.join(' ') || NO_REASON;

  return runTargets(ctx, {
    ids,
    reason,
    allowed: isHighStaff,
    doneTitle: 'Kicked successfully',
    failTitle: "Couldn't kick",
    logTitle: 'Kick',
    async act(id, author) {
      const member = await ctx.guild.members.fetch(id).catch(() => null);
      if (!member) throw new UserError("They aren't in the server.");
      guardTarget(ctx.guild, ctx.client, author, member);
      if (!member.kickable) throw new UserError('Their role is above mine.');
      await member.user
        .send(`You have been kicked from **${ctx.guild.name}**.\nReason: ${reason}`)
        .catch(() => {});
      await member.kick(`${reason} | by ${author.user.tag}`.slice(0, 450));
      recordAction(ctx.guild, author.id, 'kick').catch(() => {});
      return null;
    },
  });
}

function parseBanLength(rest) {
  const first = rest[0];
  if (!first) return { ms: null, reason: NO_REASON };
  if (/^(perm|permanent|permanently|forever|p)$/i.test(first)) {
    return { ms: null, reason: rest.slice(1).join(' ') || NO_REASON };
  }
  const ms = parseDuration(first);
  if (ms) return { ms, reason: rest.slice(1).join(' ') || NO_REASON };
  if (/^\d+[a-z]+$/i.test(first)) throw new UserError('Use a length like 30m, 12h, 7d, 2w or perm.');
  return { ms: null, reason: rest.join(' ') };
}

async function runBan(ctx) {
  const { ids, rest } = takeTargets(ctx.args);
  if (!ids.length) return usage('v!ban @user 7d reason');

  let parsed;
  try {
    parsed = parseBanLength(rest);
  } catch (err) {
    return failure("Couldn't ban", err.message);
  }
  const { ms, reason } = parsed;

  return runTargets(ctx, {
    ids,
    reason,
    allowed: hasMaxPerms,
    doneTitle: 'Banned successfully',
    failTitle: "Couldn't ban",
    logTitle: 'Ban',
    logExtra: [{ name: 'Length', value: ms ? formatMs(ms) : 'Permanent', inline: true }],
    async act(id, author) {
      const member = await ctx.guild.members.fetch(id).catch(() => null);
      const user = member ? member.user : await ctx.client.users.fetch(id).catch(() => null);
      if (!user) throw new UserError("I couldn't find that user.");

      if (member) {
        guardTarget(ctx.guild, ctx.client, author, member);
        if (!member.bannable) throw new UserError('Their role is above mine.');
      } else if (id === author.id || id === ctx.guild.ownerId) {
        throw new UserError("You can't do that.");
      }

      await user
        .send(
          `You have been banned from **${ctx.guild.name}**${ms ? ` for ${formatMs(ms)}` : ''}.\nReason: ${reason}`
        )
        .catch(() => {});

      await ctx.guild.members.ban(id, { reason: `${reason} | by ${author.user.tag}`.slice(0, 450) });

      if (ms) {
        const unbanAt = Date.now() + ms;
        addTempBan(ctx.guild.id, id, unbanAt);
        scheduleUnban(ctx.client, ctx.guild.id, id, unbanAt);
      }

      recordAction(ctx.guild, author.id, 'ban').catch(() => {});
      return ms ? `for ${formatMs(ms)}` : 'permanent';
    },
  });
}

async function runWarn(ctx) {
  const { ids, rest } = takeTargets(ctx.args);
  const reason = rest.join(' ');
  if (!ids.length || !reason) return usage('v!warn @user reason');

  return runTargets(ctx, {
    ids,
    reason,
    allowed: isStaff,
    doneTitle: 'Warned successfully',
    failTitle: "Couldn't warn",
    logTitle: 'Warn',
    async act(id, author) {
      const member = await ctx.guild.members.fetch(id).catch(() => null);
      if (!member) throw new UserError("They aren't in the server.");
      guardTarget(ctx.guild, ctx.client, author, member);
      const count = addWarning(id, reason, author.id);
      await member.user
        .send(`You have been warned in **${ctx.guild.name}**.\nReason: ${reason}`)
        .catch(() => {});
      return `Warnings: **${count}**`;
    },
  });
}

async function runUnwarn(ctx) {
  const { ids, rest } = takeTargets(ctx.args);
  if (!ids.length) return usage('v!unwarn @user reason');
  const reason = rest.join(' ') || NO_REASON;

  return runTargets(ctx, {
    ids,
    reason,
    allowed: isStaff,
    doneTitle: 'Warning removed successfully',
    failTitle: "Couldn't remove the warning",
    logTitle: 'Unwarn',
    async act(id, author) {
      const member = await ctx.guild.members.fetch(id).catch(() => null);
      if (member) guardTarget(ctx.guild, ctx.client, author, member);
      const left = removeWarning(id);
      if (left === null) throw new UserError('They have no warnings.');
      if (member) {
        await member.user
          .send(`A warning was removed in **${ctx.guild.name}**.\nReason: ${reason}`)
          .catch(() => {});
      }
      return `Warnings left: **${left}**`;
    },
  });
}

async function runPurge(ctx) {
  const amount = Number(ctx.args[0]);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) return usage('v!purge 50 (1 to 100)');

  const channel = ctx.message.channel;
  const fetched = await channel.messages.fetch({ limit: amount, before: ctx.message.id }).catch(() => null);
  if (!fetched) return failure("Couldn't purge", "I couldn't read the messages here.");

  const deleted = await channel.bulkDelete([...fetched.values()], true).catch(() => null);
  if (!deleted) return failure("Couldn't purge", 'I need the Manage Messages permission here.');

  staffStore.recordDuty(ctx.member.id, 'mod', ctx.message.id);
  await logAction(ctx.guild, {
    title: 'Purge',
    moderator: ctx.member,
    channelId: channel.id,
    ids: [],
    reason: `Deleted ${deleted.size} message${deleted.size === 1 ? '' : 's'}`,
    color: YELLOW,
  }).catch((err) => console.error('[prefix] log failed:', err.message));

  return {
    cleanup: true,
    embed: new EmbedBuilder()
      .setColor(GREEN)
      .setTitle(`${TICK} Purged successfully`)
      .setDescription(`Deleted **${deleted.size}** message${deleted.size === 1 ? '' : 's'}.`),
  };
}

async function runAfk(ctx) {
  const reason = ctx.args.join(' ').slice(0, 100) || 'no reason given';
  await setAfk(ctx.member, reason);
  return {
    embed: new EmbedBuilder()
      .setColor(GREEN)
      .setTitle(`${TICK} You are now afk`)
      .setDescription(`<@${ctx.member.id}> is now afk\nReason: ${reason}`),
  };
}

async function runStick(ctx) {
  const text = ctx.content.replace(/\\n/g, '\n').trim();
  if (!text) return usage('v!stick text (use \\n for a new line)');
  if (text.length > 4000) return failure("Couldn't stick", 'That is too long. Max 4000 characters.');

  const channel = ctx.message.channel;
  const previous = getSticky(channel.id);
  if (previous?.lastMessageId) await channel.messages.delete(previous.lastMessageId).catch(() => {});

  setSticky(channel.id, text);
  const sent = await channel.send({ embeds: [buildStickyEmbed(text)] }).catch(() => null);
  if (!sent) {
    removeSticky(channel.id);
    return failure("Couldn't stick", "I can't send messages in this channel.");
  }
  updateLastMessageId(channel.id, sent.id);

  staffStore.recordDuty(ctx.member.id, 'mod', ctx.message.id);
  await logAction(ctx.guild, {
    title: 'Sticky set',
    moderator: ctx.member,
    channelId: channel.id,
    ids: [],
    reason: text.slice(0, 500),
    color: YELLOW,
  }).catch((err) => console.error('[prefix] log failed:', err.message));

  return {
    embed: new EmbedBuilder().setColor(GREEN).setTitle(`${TICK} Sticky set successfully`).setDescription(`<#${channel.id}>`),
  };
}

async function runUnstick(ctx) {
  const channel = ctx.message.channel;
  const sticky = removeSticky(channel.id);
  if (!sticky) return failure('No sticky', 'There is no sticky in this channel.');
  if (sticky.lastMessageId) await channel.messages.delete(sticky.lastMessageId).catch(() => {});

  staffStore.recordDuty(ctx.member.id, 'mod', ctx.message.id);
  await logAction(ctx.guild, {
    title: 'Sticky removed',
    moderator: ctx.member,
    channelId: channel.id,
    ids: [],
    reason: 'Sticky removed',
    color: YELLOW,
  }).catch((err) => console.error('[prefix] log failed:', err.message));

  return {
    embed: new EmbedBuilder().setColor(GREEN).setTitle(`${TICK} Sticky removed successfully`).setDescription(`<#${channel.id}>`),
  };
}

function runPrefix() {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Prefix Commands')
    .setDescription(
      [
        `**Staff**`,
        `\`v!to @user 10s reason\` - timeout (s, m, h, d, w, max 28d)`,
        `\`v!warn @user reason\` - warn a member`,
        `\`v!unwarn @user reason\` - remove their latest warning`,
        '',
        `**Max perms and high staff**`,
        `\`v!kick @user reason\` - kick`,
        `\`v!purge 50\` - delete messages (1 to 100)`,
        `\`v!stick text\` - stick a message to the bottom of the channel`,
        `\`v!unstick\` - remove the sticky`,
        '',
        `**Max perms only**`,
        `\`v!ban @user 7d reason\` - ban (length is optional, leave it out or use perm for a permanent ban)`,
        '',
        `**Everyone**`,
        `\`v!afk reason\` - go afk`,
        `\`v!prefix\` - this list`,
        '',
        '-# You can use a user ID instead of a ping, and kick, ban, timeout and warn take more than one person.',
      ].join('\n')
    );
  return { embed, plain: true };
}

const COMMANDS = [
  { names: ['to', 'timeout'], can: isStaff, run: runTimeout },
  { names: ['kick'], can: isHighStaff, run: runKick },
  { names: ['ban'], can: hasMaxPerms, run: runBan },
  { names: ['purge'], can: isHighStaff, run: runPurge },
  { names: ['afk'], can: isEveryone, run: runAfk },
  { names: ['stick'], can: isHighStaff, run: runStick },
  { names: ['unstick'], can: isHighStaff, run: runUnstick },
  { names: ['warn'], can: isStaff, run: runWarn },
  { names: ['unwarn'], can: isStaff, run: runUnwarn },
  { names: ['prefix', 'commands'], can: isEveryone, run: runPrefix },
];

const lookup = new Map();
for (const command of COMMANDS) for (const name of command.names) lookup.set(name, command);

const seen = new Set();

async function sendEmbed(message, embed) {
  const payload = { embeds: [embed], allowedMentions: { parse: [], repliedUser: false } };
  const sent = await message.reply(payload).catch(() => null);
  if (sent) return sent;
  return message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
}

async function markDone(message, loading, ok) {
  if (loading) await loading.users.remove(message.client.user.id).catch(() => {});
  await message.react(ok ? TICK : CROSS).catch(() => {});
}

async function handle(message) {
  if (!message.guild || !message.author || message.author.bot || message.webhookId || message.system) return;
  const raw = message.content || '';
  if (raw.slice(0, PREFIX.length).toLowerCase() !== PREFIX) return;

  const body = raw.slice(PREFIX.length).trim();
  const name = body.split(/\s+/)[0]?.toLowerCase();
  const command = lookup.get(name);
  if (!command) return;

  if (seen.has(message.id)) return;
  seen.add(message.id);
  setTimeout(() => seen.delete(message.id), 60000).unref?.();

  const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;

  const content = body.slice(name.length).trim();
  const ctx = {
    message,
    guild: message.guild,
    client: message.client,
    member,
    content,
    args: content ? content.split(/\s+/) : [],
  };

  if (!command.can(member)) {
    await message.react(CROSS).catch(() => {});
    await sendEmbed(message, failure('No permission', "You can't use this command.").embed);
    return;
  }

  if (command.names[0] === 'prefix') {
    await sendEmbed(message, runPrefix().embed);
    return;
  }

  const loading = await message.react(LOADING).catch(() => null);

  let result;
  try {
    result = await command.run(ctx);
  } catch (err) {
    console.error(`[prefix] ${name} error:`, err);
    result = failure('Something went wrong', 'That command failed. Try again in a moment.');
  }

  await markDone(message, loading, result.embed.data.color !== RED);
  const sent = await sendEmbed(message, result.embed);

  if (result.cleanup) {
    setTimeout(() => {
      message.delete().catch(() => {});
      sent?.delete?.().catch(() => {});
    }, 5000).unref?.();
  }
}

module.exports = {
  name: 'prefixCommands',

  register(client) {
    client.on('messageCreate', (message) => {
      handle(message).catch((err) => console.error('[prefix] error:', err));
    });
  },
};
