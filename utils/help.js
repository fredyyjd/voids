const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { COLOR } = require('./theme');
const { hasMaxPerms, isMod, isSupport } = require('./permissions');
const { COUNTING } = require('./economyConfig');

// One page per category. Each line: [command, what it does].
// Add new commands here and they show up in /help and v!help.
const PAGES = {
  start: {
    label: 'Overview',
    emoji: '📖',
    blurb: 'Pick a category from the menu below to see its commands.',
  },
  vb: {
    label: 'Void Bucks',
    emoji: '💰',
    blurb:
      '**VB = Void Bucks.** Earn VB by chatting, counting and unlocking achievements, then spend it in the item shop. Spamming or farming VB gets your VB reset, your earn rate cut by 35% and then timeouts, a kick and a ban.',
    lines: [
      ['/item shop', 'Open the item shop: name colours, perks, roles, badges, sales and specials'],
      ['/inv', 'See your VB, colours, items and badges, and wear a colour'],
      ['/vb balance [user]', 'Check your VB or someone else\'s'],
      ['/achievements [user]', 'See your achievements or someone else\'s'],
      ['/achievements-lb', 'Achievement leaderboard'],
      ['/item giveaway', 'Giveaway VB, any shop item or a winner\'s choice from the shop  ·  *max perms*'],
      ['/shop center', 'Give items, run sales and specials, add or remove shop items  ·  *max perms*'],
      ['/2x vb', 'Turn 2x VB on or off and announce it  ·  *max perms*'],
      ['/vb strikes <user>', 'See someone\'s VB abuse strikes  ·  *max perms*'],
      ['/vb pardon <user>', 'Clear someone\'s VB abuse strikes  ·  *max perms*'],
      ['/countset', 'Set the counting channel  ·  *max perms*'],
    ],
    note: `Counting: type the next number in the counting channel. Right number = ✅ and ${COUNTING.reward} VB, once every ${COUNTING.cooldownMs / 3600000} hours each.`,
  },
  fun: {
    label: 'Fun and Games',
    emoji: '🎮',
    lines: [
      ['/game <name>', 'Start a mini game (trivia, dice, roulette, typing race and more)'],
      ['/game stop', 'Stop the game running in this channel'],
      ['/rps <user>', 'Challenge someone to rock paper scissors'],
      ['/calc', 'Calculator: pick Normal (type a sum) or Cool (button keypad). Only you can press the buttons'],
      ['/afk [reason]  ·  v!afk', 'Go afk until you type again'],
      ['/vouch lb', 'Who has the most vouches'],
      ['/vouch see <user>', 'See someone\'s vouches'],
      ['/loa request', 'Ask for a leave of absence (staff)'],
    ],
  },
  mod: {
    label: 'Moderation',
    emoji: '🛡️',
    lines: [
      ['/warn <user> <reason>  ·  v!warn', 'Warn a member  ·  *staff*'],
      ['v!unwarn @user', 'Remove their latest warning  ·  *staff*'],
      ['/timeout  ·  v!to @user 10m', 'Time a member out  ·  *staff*'],
      ['/mute <user>', 'Mute or unmute a member  ·  *staff*'],
      ['/kick <user>  ·  v!kick', 'Kick a member  ·  *staff*'],
      ['/ban <user>  ·  v!ban @user 7d', 'Ban a member  ·  *max perms*'],
      ['v!purge 50', 'Delete 1 to 100 messages  ·  *high staff*'],
      ['/lockdown lock | unlock', 'Lock or unlock the channel  ·  *staff*'],
      ['/sticky set | remove  ·  v!stick  ·  v!unstick', 'Pin a message to the bottom of a channel'],
      ['/ping prot', 'Ping protect roles or people  ·  *max perms*'],
      ['/honeypot', 'Set up a honeypot channel'],
    ],
  },
  giveaways: {
    label: 'Giveaways',
    emoji: '🎉',
    lines: [
      ['/giveaway start', 'Start a giveaway or Split or Steal  ·  *staff*'],
      ['/giveaway end <id>', 'End a giveaway now  ·  *staff*'],
      ['/giveaway reroll <id>', 'Pick new winners  ·  *staff*'],
      ['/item giveaway', 'Giveaway VB or shop items, given out automatically  ·  *max perms*'],
      ['/ign giveaway', 'IGN giveaway: lock, unlock and pick one  ·  *staff*'],
      ['/gw ping', 'Ping the giveaway or drop role  ·  *staff*'],
      ['/gw total', 'Make the total given channel  ·  *max perms*'],
    ],
    note: 'Joined a giveaway already? Press **Join** again to use an extra entry (up to 3 per giveaway) or leave.',
  },
  tickets: {
    label: 'Tickets and Panels',
    emoji: '🎫',
    lines: [
      ['/ticket add <user>', 'Add someone to this ticket'],
      ['/ticket rename <name>', 'Rename this ticket'],
      ['/ticket close', 'Ask to close this ticket'],
      ['/close', 'Close this ticket now or ask the owner'],
      ['/panel  ·  /services  ·  /tos', 'Post the ticket, services and Terms of Service panels'],
      ['/apply', 'Post the staff application panel'],
      ['/custom', 'Post a custom ticket panel'],
      ['/request ping', 'Request a ping'],
      ['/legit panel', 'Post the "Are we legit?" panel'],
      ['/roles', 'Post the reaction roles panel'],
      ['/embed', 'Post an embed'],
    ],
  },
  staff: {
    label: 'Staff',
    emoji: '👥',
    lines: [
      ['/staff center', 'Open the staff center'],
      ['/staff lb  ·  /staff all-time', 'Staff points leaderboards'],
      ['/staff activity [user]', 'See this week\'s tracked activity'],
      ['/staff see <user>', 'See a member\'s staff warns and strikes'],
      ['/staff announce', 'Ping @staff with an announcement  ·  *max perms*'],
      ['/staff review status | preview | run | resend', 'The weekly staff review  ·  *max perms*'],
      ['/active check | view | reset', 'Staff activity checks'],
      ['/server-management view', 'Server protection and staff progress  ·  *max perms*'],
      ['/schem panel', 'Post the schematic count and search panel'],
    ],
  },
  prefix: {
    label: 'Prefix Commands',
    emoji: '⌨️',
    blurb: 'These work with the **v!** prefix. You can use a user ID instead of a ping.',
    lines: [
      ['v!help', 'This list'],
      ['v!afk [reason]', 'Go afk  ·  *everyone*'],
      ['v!to @user 10s reason', 'Time out (s, m, h, d, w, max 28d)  ·  *staff*'],
      ['v!warn @user reason', 'Warn a member  ·  *staff*'],
      ['v!unwarn @user reason', 'Remove their latest warning  ·  *staff*'],
      ['v!kick @user reason', 'Kick  ·  *high staff*'],
      ['v!purge 50', 'Delete 1 to 100 messages  ·  *high staff*'],
      ['v!stick text', 'Stick a message to the bottom of the channel  ·  *high staff*'],
      ['v!unstick', 'Remove the sticky  ·  *high staff*'],
      ['v!ban @user 7d reason', 'Ban (leave the time out or use perm for permanent)  ·  *max perms*'],
    ],
    note: 'Kick, ban, timeout and warn take more than one person.',
  },
};

const ORDER = ['start', 'vb', 'fun', 'mod', 'giveaways', 'tickets', 'staff', 'prefix'];

function menuRow(selected) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('help_menu')
      .setPlaceholder('Choose a category…')
      .addOptions(
        ORDER.map((key) => ({
          label: PAGES[key].label,
          value: key,
          emoji: PAGES[key].emoji,
          default: key === selected,
        }))
      )
  );
}

function overview() {
  return [
    'Everything the bot can do, split into categories.',
    '',
    ...ORDER.filter((k) => k !== 'start').map((k) => `${PAGES[k].emoji}  **${PAGES[k].label}**`),
    '',
    '-# Slash commands start with `/`, prefix commands start with `v!`. Use the menu to open a category.',
  ].join('\n');
}

function helpPayload(key = 'start', member = null) {
  const page = PAGES[key] || PAGES.start;
  const pageKey = PAGES[key] ? key : 'start';

  const embed = new EmbedBuilder().setColor(COLOR).setTitle(`${page.emoji}  ${pageKey === 'start' ? 'Help' : page.label}`);

  if (pageKey === 'start') {
    embed.setDescription(overview());
  } else {
    const lines = page.lines.map(([cmd, what]) => `**\`${cmd}\`**\n${what}`).join('\n\n');
    embed.setDescription([page.blurb, page.blurb ? '' : null, lines].filter((l) => l !== null).join('\n'));
    if (page.note) embed.addFields({ name: '\u200b', value: `-# ${page.note}` });
  }

  const tag = member && (hasMaxPerms(member) ? 'Max perms' : isMod(member) || isSupport(member) ? 'Staff' : null);
  embed.setFooter({ text: tag ? `Your access: ${tag}  ·  VB = Void Bucks` : 'VB = Void Bucks' });

  return { embeds: [embed], components: [menuRow(pageKey)] };
}

module.exports = { helpPayload, PAGES };
