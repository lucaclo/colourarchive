/**
 * A place's name, short enough for Scout's minimised sheet.
 *
 * Nominatim hands back OpenStreetMap's `name` tag, which in bilingual places
 * holds both scripts at once: "淺水灣 Repulse Bay", "ᐊᐃᕕᓕᐅᑉ ᑕᕆᐅᖓ Repulse Bay",
 * "海灘道 Beach Road". The short name keeps the words written in the reader's
 * own script (from the browser's languages), then Latin, and drops anything
 * after a comma. A name written in one script stays whole.
 */

type Script = string;

/** Scripts a word can be in, checked in this order. Kana counts as Han. */
const SCRIPTS: [Script, RegExp][] = [
  ['Latin', /\p{Script=Latin}/u],
  ['Han', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Ethiopic', /\p{Script=Ethiopic}/u],
  ['Canadian_Aboriginal', /\p{Script=Canadian_Aboriginal}/u],
];

/** The script a language is written in; anything not listed reads Latin. */
const LANGUAGE_SCRIPT: Record<string, Script> = {
  zh: 'Han', ja: 'Han', ko: 'Hangul',
  ru: 'Cyrillic', uk: 'Cyrillic', be: 'Cyrillic', bg: 'Cyrillic', mk: 'Cyrillic', sr: 'Cyrillic', kk: 'Cyrillic', mn: 'Cyrillic',
  el: 'Greek',
  ar: 'Arabic', fa: 'Arabic', ur: 'Arabic', ps: 'Arabic',
  he: 'Hebrew', yi: 'Hebrew',
  th: 'Thai',
  hi: 'Devanagari', mr: 'Devanagari', ne: 'Devanagari',
  ka: 'Georgian', hy: 'Armenian', am: 'Ethiopic', iu: 'Canadian_Aboriginal',
};

const scriptOf = (word: string): Script | null => {
  const letter = word.match(/\p{L}/u)?.[0];
  if (!letter) return null;
  return SCRIPTS.find(([, test]) => test.test(letter))?.[0] ?? 'Other';
};

export function shortPlaceName(name: string, languages: readonly string[] = []): string {
  const head = name.split(',')[0].trim();
  const words = head.split(/\s+/).filter(Boolean);
  const scripts = words.map(scriptOf);
  const present = new Set(scripts.filter((s): s is Script => s !== null));
  if (present.size < 2) return head;

  const wanted = [...languages.map((tag) => LANGUAGE_SCRIPT[tag.toLowerCase().split('-')[0]] ?? 'Latin'), 'Latin']
    .find((script) => present.has(script));
  if (!wanted) return head;

  // Words with no letters ("39", "&") go with the words beside them.
  const near = (i: number, step: number) => {
    for (let j = i + step; j >= 0 && j < words.length; j += step) if (scripts[j] !== null) return scripts[j];
    return null;
  };
  const kept = words.filter((_, i) => scripts[i] === wanted || (scripts[i] === null && (near(i, -1) === wanted || near(i, 1) === wanted)));
  // Brackets that held the other script's half go; so does a dangling dash.
  const short = kept.join(' ').replace(/[()[\]{}（）]/g, '').replace(/^[\s/·–—-]+|[\s/·–—-]+$/g, '');
  return short || head;
}
