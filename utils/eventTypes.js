// Every event type: how it is configured and how its content is parsed.
// Managers type the questions in one box, one round per line, fields split by "|".

const MAX_ROUNDS = 25;

const clean = (s) => String(s ?? '').trim();
const lines = (content) => clean(content).split('\n').map((l) => l.trim()).filter(Boolean);
const parts = (line) => line.split('|').map((p) => p.trim());
const list = (s, sep = ',') => clean(s).split(sep).map((x) => x.trim()).filter(Boolean);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// "End Crystal", "end_crystal" and " end   crystal " all count as the same answer.
function normalise(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scramble(text) {
  const word = (w) => {
    if (w.length < 3 || new Set(w).size < 2) return w;
    let out = w;
    for (let i = 0; i < 20 && out === w; i++) out = shuffle(w.split('')).join('');
    return out;
  };
  return text.split(' ').map(word).join(' ').toUpperCase();
}

const tooMany = (n) => (n > MAX_ROUNDS ? `You can have ${MAX_ROUNDS} rounds at most (you have ${n}).` : null);

function textRounds(content, build) {
  const ls = lines(content);
  if (!ls.length) return { error: 'Add at least one round.' };
  if (tooMany(ls.length)) return { error: tooMany(ls.length) };

  const rounds = [];
  for (let i = 0; i < ls.length; i++) {
    const r = build(parts(ls[i]), i + 1);
    if (typeof r === 'string') return { error: `Line ${i + 1}: ${r}` };
    rounds.push(r);
  }
  return { rounds };
}

const hintsOf = (s) => list(s, ';');

const TYPES = {
  trivia: {
    label: 'Donut SMP Trivia',
    emoji: '🧠',
    kind: 'choice',
    description: 'Multiple choice questions, fastest correct answers rank higher',
    timeLimit: 20,
    points: 1,
    contentLabel: 'Questions (one per line)',
    placeholder: 'Question | Option A | Option B | Option C | Option D | B',
    parse: (content) =>
      textRounds(content, (p) => {
        if (p.length < 4) return 'use `Question | Option A | Option B | ... | Correct (A-D)`';
        const question = p[0];
        const options = p.slice(1, -1);
        const key = p[p.length - 1].toUpperCase();
        if (options.length < 2 || options.length > 4) return 'use 2 to 4 options.';
        const idx = /^[A-D]$/.test(key) ? key.charCodeAt(0) - 65 : parseInt(key, 10) - 1;
        if (!Number.isInteger(idx) || idx < 0 || idx >= options.length)
          return 'the last field must be the correct option (A-D or 1-4).';
        return { prompt: question, options, correct: idx };
      }),
  },

  truefalse: {
    label: 'True or False',
    emoji: '✅',
    kind: 'choice',
    description: 'Statements, members pick True or False',
    timeLimit: 15,
    points: 1,
    contentLabel: 'Statements (one per line)',
    placeholder: 'Statement | true   (or false)',
    parse: (content) =>
      textRounds(content, (p) => {
        if (p.length < 2) return 'use `Statement | true` or `Statement | false`.';
        const v = p[p.length - 1].toLowerCase();
        const yes = ['true', 't', 'yes', 'y'];
        const no = ['false', 'f', 'no', 'n'];
        if (!yes.includes(v) && !no.includes(v)) return 'the last field must be true or false.';
        return { prompt: p.slice(0, -1).join(' | '), options: ['True', 'False'], correct: yes.includes(v) ? 0 : 1 };
      }),
  },

  unscramble: {
    label: 'Unscramble the Word',
    emoji: '🔤',
    kind: 'text',
    description: 'First to unscramble the word wins the round',
    timeLimit: 30,
    points: 1,
    contentLabel: 'Words (one per line)',
    placeholder: 'netherite, alt answer | optional hint',
    parse: (content) =>
      textRounds(content, (p) => {
        const answers = list(p[0]);
        if (!answers.length) return 'add the word first.';
        return {
          prompt: 'Unscramble this word',
          display: scramble(answers[0]),
          answers,
          hints: hintsOf(p[1]),
        };
      }),
  },

  riddle: {
    label: 'Riddle Challenge',
    emoji: '🧩',
    kind: 'text',
    description: 'First correct riddle answer wins the round',
    timeLimit: 60,
    points: 1,
    contentLabel: 'Riddles (one per line)',
    placeholder: 'Riddle | answer, alt answer | hint 1; hint 2',
    parse: (content) =>
      textRounds(content, (p) => {
        if (p.length < 2) return 'use `Riddle | answer, alt answer | hint`.';
        const answers = list(p[1]);
        if (!p[0] || !answers.length) return 'add the riddle and at least one answer.';
        return { prompt: p[0], answers, hints: hintsOf(p[2]) };
      }),
  },

  guessitem: {
    label: 'Guess the Item',
    emoji: '⛏️',
    kind: 'text',
    description: 'Identify the Minecraft item from an image or clue',
    timeLimit: 30,
    points: 1,
    contentLabel: 'Clues (one per line)',
    placeholder: 'image URL, local:file.png or clue | answer, alt | hint 1; hint 2',
    parse: (content) =>
      textRounds(content, (p) => {
        if (p.length < 2) return 'use `Clue | answer, alt answer | hints`.';
        const answers = list(p[1]);
        if (!p[0] || !answers.length) return 'add a clue and at least one answer.';

        const round = { prompt: 'What Minecraft item is this?', answers, hints: hintsOf(p[2]) };

        if (/^https?:\/\/\S+$/i.test(p[0])) round.image = p[0];
        else if (/^local:/i.test(p[0])) {
          const file = p[0].slice(6).trim();
          if (!/^[\w\- .]+\.(png|jpe?g|gif|webp)$/i.test(file)) return 'local images must be a plain file name like `local:diamond.png`.';
          round.localImage = file;
        } else round.clue = p[0];

        return round;
      }),
  },

  emoji: {
    label: 'Emoji Quiz',
    emoji: '😎',
    kind: 'text',
    description: 'Guess the item, mob or term from emojis',
    timeLimit: 30,
    points: 1,
    contentLabel: 'Emoji puzzles (one per line)',
    placeholder: '🧱⛏️ | answer, alt answer | optional hint',
    parse: (content) =>
      textRounds(content, (p) => {
        if (p.length < 2) return 'use `Emojis | answer, alt answer | hint`.';
        const answers = list(p[1]);
        if (!p[0] || !answers.length) return 'add the emojis and at least one answer.';
        return { prompt: 'What do these emojis mean?', display: p[0], answers, hints: hintsOf(p[2]) };
      }),
  },

  typer: {
    label: 'Fast Typer',
    emoji: '⌨️',
    kind: 'text',
    description: 'First to type the phrase correctly wins the round',
    timeLimit: 20,
    points: 1,
    contentLabel: 'Phrases (one per line)',
    placeholder: 'the quick creeper blew up my base',
    parse: (content) =>
      textRounds(content, (p) => {
        if (!p[0]) return 'add the phrase.';
        return { prompt: 'Type this phrase exactly', display: p[0], answers: [p[0]], hints: [] };
      }),
  },

  math: {
    label: 'Math Race',
    emoji: '➗',
    kind: 'text',
    description: 'Quick maths, first correct answer wins the round',
    timeLimit: 20,
    points: 1,
    contentLabel: 'Rounds | difficulty (easy, medium, hard)',
    placeholder: '5 | medium',
    parse: (content) => {
      const [n, diff = 'medium'] = parts(lines(content)[0] || '');
      const count = parseInt(n, 10);
      if (!Number.isInteger(count) || count < 1 || count > MAX_ROUNDS)
        return { error: `Enter how many rounds (1-${MAX_ROUNDS}), for example \`5 | medium\`.` };
      const level = ['easy', 'medium', 'hard'].includes(diff.toLowerCase()) ? diff.toLowerCase() : null;
      if (!level) return { error: 'Difficulty must be easy, medium or hard.' };

      const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
      const rounds = [];
      for (let i = 0; i < count; i++) {
        let q;
        let ans;
        if (level === 'easy') {
          const a = rnd(10, 99);
          const b = rnd(10, 99);
          if (Math.random() < 0.5) { q = `${a} + ${b}`; ans = a + b; } else { const hi = Math.max(a, b); const lo = Math.min(a, b); q = `${hi} - ${lo}`; ans = hi - lo; }
        } else if (level === 'medium') {
          const a = rnd(3, 15);
          const b = rnd(3, 25);
          q = `${a} × ${b}`;
          ans = a * b;
        } else {
          const a = rnd(6, 19);
          const b = rnd(6, 19);
          const c = rnd(20, 150);
          if (Math.random() < 0.5) { q = `${a} × ${b} + ${c}`; ans = a * b + c; } else { q = `${a} × ${b} - ${c}`; ans = a * b - c; }
        }
        rounds.push({ prompt: 'Solve this', display: q, answers: [String(ans)], numeric: true, hints: [] });
      }
      return { rounds };
    },
  },

  reaction: {
    label: 'Reaction Race',
    emoji: '⚡',
    kind: 'react',
    description: 'A button appears at a random moment, first to click wins',
    timeLimit: 15,
    points: 1,
    contentLabel: 'Number of rounds',
    placeholder: '5',
    parse: (content) => {
      const n = parseInt(clean(content), 10);
      if (!Number.isInteger(n) || n < 1 || n > 10) return { error: 'Enter a number of rounds from 1 to 10.' };
      return { rounds: Array.from({ length: n }, () => ({ prompt: 'Get ready... click the button the moment it turns green!' })) };
    },
  },

  number: {
    label: 'Number Guess',
    emoji: '🔢',
    kind: 'number',
    description: 'Guess the secret number, closest guess wins',
    timeLimit: 120,
    points: 1,
    contentLabel: 'min | max | secret | clue',
    placeholder: '1 | 100 | 42 | it is the answer   (leave secret empty for random)',
    parse: (content) => {
      const p = parts(lines(content)[0] || '');
      const min = parseInt(p[0], 10);
      const max = parseInt(p[1], 10);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max)
        return { error: 'Use `min | max | secret | clue` where min is lower than max.' };
      if (max - min > 1e9) return { error: 'That range is too large.' };

      let secret;
      if (!p[2] || /^random$/i.test(p[2])) secret = min + Math.floor(Math.random() * (max - min + 1));
      else {
        secret = parseInt(p[2], 10);
        if (!Number.isInteger(secret) || secret < min || secret > max)
          return { error: 'The secret number must be between min and max.' };
      }
      return { rounds: [{ prompt: 'Guess the secret number', min, max, secret, clue: p[3] || null }] };
    },
  },
};

// Extra options in the dropdown that reuse the existing giveaway system.
const GIVEAWAY_OPTIONS = [
  { value: 'giveaway', label: 'Giveaway', emoji: '🎉', description: 'Members enter, random winners are picked' },
  { value: 'splitsteal', label: 'Split or Steal', emoji: '🤝', description: 'Two players pick split or steal' },
];

module.exports = { TYPES, GIVEAWAY_OPTIONS, MAX_ROUNDS, normalise, shuffle };
