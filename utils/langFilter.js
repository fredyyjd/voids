// Language filter for auto moderation.
//   targeted = swearing AT someone ("fuck you", "fuck @user", "you bitch", "stfu", "kys"...)
//   slur     = the slurs you listed (faggot, retard, nigga / nigger) in any sense
// Normal swearing that is not aimed at a person ("this is fucking annoying") is NOT caught.
// To add more words, add a pattern to SLURS or TARGETED below.

const SEP = '[.\\-_*]*'; // allows "f.u.c.k" / "n-i-g-g-a" style evasion

const FUCK = `(?:f${SEP}u+${SEP}c+${SEP}k+|f+u+k+|f+c+k+|ph+u+c+k+|fvck|fuq)(?:ing|er|ers|ed|s)?`;
const INSULT =
  '(?:bitch|bitches|cunt|asshole|ass hole|dickhead|dick head|prick|bastard|twat|wanker|shithead|dumbass|dumb ass|motherfucker|mf|piece of shit|scumbag|whore|slut)';
const YOU = '(?:you|youu|u|ur|youre|ya|usertoken)';

const SLURS = [
  // n-word (nigga / nigger / nigguh / nibba ...). "nigeria", "niger", "snigger" and "niggardly" do not match.
  new RegExp(`(?<![a-z])n+${SEP}i+${SEP}[gq]+${SEP}[gq]+${SEP}(?:a+|e+r+|ah|uh|as|ers)?s?(?![a-z])`),
  /(?<![a-z])n+i+b+b+(?:a+|er)s?(?![a-z])/,
  // f-slur
  /(?<![a-z])f+a+g+(?:g+)?(?:o+t+|i+t+|e+t+)?s?(?![a-z])/,
  // r-slur ("retard", "retarded"). "fire retardant" does not match.
  /(?<![a-z])re+t+a+r+d+(?:ed|s|ation)?(?![a-z])/,
  /(?<![a-z])tards?(?![a-z])/,
];

const TARGETED = [
  // fuck you / fuck u / fuck ur mom / fuck off / fuck him / fuck @user / fuck all of you
  new RegExp(
    `(?<![a-z])${FUCK}\\s+(?:all\\s+of\\s+)?(?:you|u|ya|yo|yourself|urself|ur|your|yall|him|her|them|usertoken|off)(?![a-z])`
  ),
  // shut the fuck up / stfu / shut up bitch
  new RegExp(`(?<![a-z])shut\\s+(?:the\\s+)?${FUCK}\\s+up(?![a-z])`),
  /(?<![a-z])stfu(?![a-z])/,
  new RegExp(`(?<![a-z])shut\\s+up\\s+${INSULT}(?![a-z])`),
  // you are a bitch / u fucking asshole / youre a cunt
  new RegExp(
    `(?<![a-z])${YOU}\\s*(?:are|r|re|were)?\\s*(?:such\\s+)?(?:a|an|so|the)?\\s*(?:${FUCK}\\s+|f\\w*ing\\s+)?${INSULT}(?![a-z])`
  ),
  /(?<![a-z])suck\s+(?:my|a)\s+(?:dick|cock|balls)(?![a-z])/,
  /(?<![a-z])eat\s+shit(?![a-z])/,
  /(?<![a-z])(?:kys|kill\s+(?:yourself|urself)|go\s+kill\s+(?:yourself|urself)|go\s+die)(?![a-z])/,
];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', $: 's', '!': 'i', '|': 'i', '+': 't', '@': 'a' };

function prepare(content) {
  let t = String(content || '');
  t = t
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/<@[!&]?\d+>/g, ' usertoken ')
    .replace(/https?:\/\/\S+/g, ' ');
  t = t.normalize('NFKD').replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, '');
  t = t.toLowerCase();
  t = t.replace(/@(?:everyone|here)\b/g, ' usertoken ').replace(/@\w+/g, ' usertoken ');
  t = t.replace(/[0134578$!|+@]/g, (c) => LEET[c] || c);
  t = t.replace(/([a-z])\1{2,}/g, '$1$1'); // fuuuuck -> fuuck
  return t.replace(/\s+/g, ' ').trim();
}

// Returns { type: 'slur' | 'targeted', match } or null.
function check(content) {
  const text = prepare(content);
  if (!text) return null;

  for (const re of SLURS) {
    const m = text.match(re);
    if (m) return { type: 'slur', match: m[0] };
  }
  for (const re of TARGETED) {
    const m = text.match(re);
    if (m) return { type: 'targeted', match: m[0] };
  }
  return null;
}

module.exports = { check, prepare };
