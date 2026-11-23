const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { box } = require('./box');

/* =========================================================
   MATH
   A tiny parser, so nothing typed by a member is ever run as code.
   Supports + - * / ( ) decimals and a leading minus. (× and ÷ work too.)
========================================================= */

class CalcError extends Error {}

function evaluate(raw) {
  const src = String(raw || '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/\s+/g, '');

  if (!src) throw new CalcError('Type something first.');
  if (src.length > 80) throw new CalcError('That is too long.');
  if (!/^[0-9+\-*/().]+$/.test(src)) throw new CalcError('Use numbers and `+ - × ÷ ( )` only.');

  let i = 0;

  const parseExpr = () => {
    let v = parseTerm();
    while (src[i] === '+' || src[i] === '-') {
      const op = src[i++];
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  const parseTerm = () => {
    let v = parseFactor();
    while (src[i] === '*' || src[i] === '/') {
      const op = src[i++];
      const r = parseFactor();
      if (op === '/' && r === 0) throw new CalcError('You cannot divide by zero.');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };

  const parseFactor = () => {
    if (src[i] === '-') {
      i++;
      return -parseFactor();
    }
    if (src[i] === '+') {
      i++;
      return parseFactor();
    }
    if (src[i] === '(') {
      i++;
      const v = parseExpr();
      if (src[i] !== ')') throw new CalcError('A bracket is not closed.');
      i++;
      return v;
    }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (!m) throw new CalcError("Couldn't work that out.");
    i += m[0].length;
    return parseFloat(m[0]);
  };

  const result = parseExpr();
  if (i < src.length) throw new CalcError("Couldn't work that out.");
  if (!Number.isFinite(result)) throw new CalcError('That number is too big.');

  return String(parseFloat(result.toPrecision(12)));
}

const pretty = (expr) => String(expr).replace(/\*/g, '×').replace(/\//g, '÷');

/* =========================================================
   LOOKS
========================================================= */

// What /calc shows: pick Normal or Cool. Only the person who ran /calc can press these.
function pickerPayload() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('calc_normal').setLabel('Normal Calc').setEmoji('🧮').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('calc_cool').setLabel('Cool Calc').setEmoji('✨').setStyle(ButtonStyle.Primary)
  );

  return box(
    [
      '## 🧮  Calculator',
      '**Normal Calc**  ·  type a sum and get the answer.\n**Cool Calc**  ·  a full calculator with buttons.\n-# Only you can use these buttons.',
    ],
    { rows: [row] }
  );
}

// The answer to a typed sum.
const resultPayload = (expr, result) => box(`\`${pretty(expr)}\`\n## = ${result}`);

function modal() {
  return new ModalBuilder()
    .setCustomId('calc_modal')
    .setTitle('Calculator')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('expr')
          .setLabel('Your sum')
          .setPlaceholder('e.g. (5 + 3) * 2')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
      )
    );
}

/* =========================================================
   COOL CALC (button keypad)
   One small state per keypad message, kept in memory.
========================================================= */

const MAX_LEN = 40;
const states = new Map(); // message id -> { userId, expr, fresh, last, at }

function sweep() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of states) if (s.at < cutoff) states.delete(id);
}

function getState(messageId, userId) {
  sweep();
  if (!states.has(messageId)) states.set(messageId, { userId, expr: '', fresh: false, last: null, at: Date.now() });
  const s = states.get(messageId);
  s.at = Date.now();
  return s;
}

const KEYS = [
  ['7', '8', '9', '/', 'C'],
  ['4', '5', '6', '*', 'B'],
  ['1', '2', '3', '-', '('],
  ['0', '.', '=', '+', ')'],
];

const LABEL = { '/': '÷', '*': '×', '-': '−', B: '⌫' };

function keypadPayload(state, notice = null) {
  const rows = KEYS.map((keys) =>
    new ActionRowBuilder().addComponents(
      keys.map((k) => {
        let style = ButtonStyle.Secondary;
        if ('/*-+()'.includes(k)) style = ButtonStyle.Primary;
        if (k === '=') style = ButtonStyle.Success;
        if (k === 'C') style = ButtonStyle.Danger;
        return new ButtonBuilder().setCustomId(`calc:${k}`).setLabel(LABEL[k] || k).setStyle(style);
      })
    )
  );

  const shown = state.last ? `${pretty(state.last.expr)}\n= ${state.last.result}` : pretty(state.expr) || '0';
  const parts = ['## ✨  Cool Calc', `\`\`\`\n${shown}\n\`\`\``];
  if (notice) parts.push(`⚠️ ${notice}`);

  return box(parts, { rows });
}

// Applies one button press. Returns a notice (or null).
function press(state, key) {
  if (key === 'C') {
    state.expr = '';
    state.fresh = false;
    state.last = null;
    return null;
  }

  if (key === 'B') {
    if (state.fresh) {
      state.expr = '';
      state.fresh = false;
      state.last = null;
    } else {
      state.expr = state.expr.slice(0, -1);
    }
    return null;
  }

  if (key === '=') {
    if (!state.expr) return 'Type something first.';
    try {
      const result = evaluate(state.expr);
      state.last = { expr: state.expr, result };
      state.expr = result;
      state.fresh = true;
      return null;
    } catch (err) {
      return err instanceof CalcError ? err.message : "Couldn't work that out.";
    }
  }

  // After an answer, a number starts a new sum and an operator carries on from the answer.
  const startsNew = /[0-9.(]/.test(key);
  if (state.fresh && startsNew) state.expr = '';
  state.fresh = false;
  state.last = null;

  if (state.expr.length >= MAX_LEN) return 'That is as long as it can get.';
  state.expr += key;
  return null;
}

module.exports = {
  CalcError,
  evaluate,
  pickerPayload,
  resultPayload,
  modal,
  keypadPayload,
  getState,
  press,
};
