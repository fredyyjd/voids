const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const createStore = require('./jsonStore');
const extra = require('../extraConfig');

const cfg = extra.schematics;

// data/schematics.json
//   nextId  the next SI number
//   posts   every schematic that was posted (id, category, title, message link)
//   known   fingerprints of posted files, to block repeats
//   panel   where the count / search panel message lives
const store = createStore('schematics.json', { nextId: 1, posts: [], known: {}, panel: null });

const PAGE_SIZE = 10;

/* ---------- categories ---------- */

function categories() {
  return (cfg.categories || []).filter((c) => c && c.key && c.source && c.posting);
}

function categoryBySource(channelId) {
  return categories().find((c) => c.source === String(channelId)) || null;
}

function categoryByKey(key) {
  return categories().find((c) => c.key === key) || null;
}

function parseEmoji(value) {
  if (!value) return undefined;
  const text = String(value).trim();
  const match = /^<(a?):([A-Za-z0-9_]+):(\d+)>$/.exec(text);
  if (match) return { animated: match[1] === 'a', name: match[2], id: match[3] };
  return { name: text };
}

function hexToInt(hex) {
  const n = parseInt(String(hex || '#3B82F6').replace('#', ''), 16);
  return Number.isNaN(n) ? 0x3b82f6 : n;
}

function trunc(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/* ---------- title ---------- */

function baseName(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '');
}

function cleanTitle(text) {
  return String(text || '')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/<@[!&]?\d+>|<#\d+>/g, ' ')
    .replace(/@(everyone|here)/gi, ' ')
    .replace(/[*_~`#>|\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

// Removes advert text from a file name, like "Join Zyrins Discord For More".
function stripPromo(text) {
  return String(text || '')
    .replace(/(?:https?:\/\/)?discord\.(?:gg|com)\/\S*/gi, ' ')
    .replace(/join[\s_\-.]*[\s\S]*?for[\s_\-.]*more/gi, ' ')
    .replace(/join[\s_\-.]*[\s\S]*?discord/gi, ' ')
    .replace(/(?<![A-Za-z0-9])join(?![A-Za-z]).*$/gi, ' ')
    .replace(/discord/gi, ' ');
}

// "christmas_tree_gamble.litematic" -> "Christmas Tree Gamble"
function makeTitle(fileName) {
  const text = stripPromo(baseName(fileName))
    .replace(/\(\s*\d+\s*\)\s*$/, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/(^|\s)[-–—]+(\s|$)/g, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
    .trim();

  const title = cleanTitle(
    text
      .split(' ')
      .map((w) => (w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ')
  );
  return title || 'Schematic';
}

// The forwarded message's first line, when it is **bold** or a # heading.
function readPostTitle(text) {
  const first = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return null;
  const match = first.match(/^\*\*(.+?)\*\*$/) || first.match(/^#{1,3}\s+(.+)$/);
  if (!match) return null;
  const title = cleanTitle(match[1]);
  if (!title || /do not share|taking this schematic/i.test(title)) return null;
  return title;
}

/* ---------- repeat blocking ---------- */

function nameKey(fileName) {
  return 'n:' + baseName(fileName).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hashKey(hash) {
  return 'h:' + hash;
}

function findDuplicate(keys) {
  const known = store.get('known') || {};
  for (const key of keys) {
    if (known[key]) return known[key];
  }
  return null;
}

function rememberAll(keys, info) {
  const known = store.get('known') || {};
  for (const key of keys) known[key] = info;
  store.set('known', known);
}

/* ---------- ids + posts ---------- */

function nextId() {
  return store.get('nextId') || 1;
}

function recordPost(post) {
  const posts = store.get('posts') || [];
  posts.push(post);
  store.set('posts', posts);
  store.set('nextId', post.id + 1);
}

function counts() {
  const out = {};
  for (const c of categories()) out[c.key] = 0;
  for (const p of store.get('posts') || []) {
    if (p.category in out) out[p.category] += 1;
  }
  return out;
}

/* ---------- the post itself ---------- */

function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : vars[k]));
}

function buildPostText(title, id) {
  const t = cfg.template || {};
  const vars = { title, id };
  return [fill(t.title || '## __{title}__', vars), ...(t.lines || []).map((l) => fill(l, vars))].join('\n');
}

/* ---------- count + search panel ---------- */

function buildPanelEmbed() {
  const p = cfg.panel || {};
  const cats = categories();
  const c = counts();
  let total = 0;

  const lines = cats.map((cat) => {
    total += c[cat.key];
    const shared = cats.filter((x) => x.posting === cat.posting).length > 1;
    return `${cat.emoji || '📁'} <#${cat.posting}>${shared ? ` **${cat.label}**` : ''} - **${c[cat.key]}**`;
  });
  lines.push('', `**Total** - **${total}**`);

  return new EmbedBuilder()
    .setTitle(p.title || 'Schematic Count')
    .setColor(hexToInt(p.color))
    .setDescription(lines.join('\n'))
    .setFooter({ text: p.footer || 'Auto updating schematic search' })
    .setTimestamp();
}

function buildPanelMessage() {
  const cats = categories();
  const c = counts();
  const message = { embeds: [buildPanelEmbed()], components: [] };

  if (cats.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('schem_search')
      .setPlaceholder((cfg.panel && cfg.panel.placeholder) || 'Search schematics')
      .addOptions(
        cats.slice(0, 25).map((cat) => ({
          label: trunc(cat.label, 100),
          value: cat.key,
          description: `${c[cat.key]} schematic${c[cat.key] === 1 ? '' : 's'}`,
          emoji: parseEmoji(cat.emoji),
        }))
      );
    message.components.push(new ActionRowBuilder().addComponents(menu));
  }
  return message;
}

async function updatePanel(client) {
  const ref = store.get('panel');
  if (!ref) return;
  const channel = await client.channels.fetch(ref.channelId).catch(() => null);
  const message = channel ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
  if (!message) return;
  await message.edit(buildPanelMessage()).catch((err) => console.error('[schematics] panel update failed:', err.message));
}

let updateTimer = null;
function scheduleUpdate(client) {
  if (updateTimer) return;
  updateTimer = setTimeout(() => {
    updateTimer = null;
    updatePanel(client).catch(() => {});
  }, 2000);
  if (updateTimer.unref) updateTimer.unref();
}

function getPanelRef() {
  return store.get('panel');
}

function setPanelRef(ref) {
  store.set('panel', ref);
}

/* ---------- search results (what the dropdown shows) ---------- */

function buildSearchPage(key, page = 0) {
  const cat = categoryByKey(key);
  if (!cat) return { content: 'That category no longer exists.', embeds: [], components: [] };

  const posts = (store.get('posts') || [])
    .filter((p) => p.category === key)
    .sort((a, b) => b.id - a.id);

  const pages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  const current = Math.min(Math.max(0, page), pages - 1);
  const slice = posts.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const description = slice.length
    ? slice
        .map((p) => {
          const name = trunc(String(p.title).replace(/[\[\]]/g, ''), 60);
          return `**SI ${p.id}** · [${name}](https://discord.com/channels/${p.guildId}/${p.channelId}/${p.messageId})`;
        })
        .join('\n')
    : 'No schematics here yet.';

  const embed = new EmbedBuilder()
    .setTitle(`${cat.emoji || '📁'} ${cat.label}`)
    .setColor(hexToInt(cfg.panel && cfg.panel.color))
    .setDescription(description)
    .setFooter({ text: `Page ${current + 1}/${pages} · ${posts.length} schematic${posts.length === 1 ? '' : 's'}` });

  const components = [];
  if (pages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`schem_page:${key}:${current - 1}`)
          .setLabel('Prev')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(current === 0),
        new ButtonBuilder()
          .setCustomId(`schem_page:${key}:${current + 1}`)
          .setLabel('Next')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(current >= pages - 1)
      )
    );
  }

  return { embeds: [embed], components };
}

module.exports = {
  categories,
  categoryBySource,
  categoryByKey,
  cleanTitle,
  makeTitle,
  readPostTitle,
  nameKey,
  hashKey,
  findDuplicate,
  rememberAll,
  nextId,
  recordPost,
  counts,
  buildPostText,
  buildPanelMessage,
  buildSearchPage,
  updatePanel,
  scheduleUpdate,
  getPanelRef,
  setPanelRef,
};
