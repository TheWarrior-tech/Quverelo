/**
 * Hyphenation for the Layout flow engine: Frank Liang's algorithm (as in TeX)
 * with the TeX en-GB and en-US pattern sets, from the `hyphen` package (ISC),
 * bundled offline. Points follow TeX's minimums for English (at least 2
 * letters before a break and 3 after) and words shorter than `minWord`
 * letters are never broken.
 */
import createHyphenator from 'hyphen/hyphen.js';
import type { TextLanguage } from './types';
import enGb from 'hyphen/patterns/en-gb.js';
import enUs from 'hyphen/patterns/en-us.js';

export type HyphenLanguage = TextLanguage;

export const HYPHEN_LANGUAGES: { value: HyphenLanguage; label: string }[] = [
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
];

const SHY = '\u00AD';
const hyphenators = new Map<HyphenLanguage, (t: string) => string>();
function hyphenator(lang: HyphenLanguage): (t: string) => string {
  let h = hyphenators.get(lang);
  if (!h) {
    h = createHyphenator(lang === 'en-US' ? enUs : enGb, { hyphenChar: SHY, minWordLength: 4 });
    hyphenators.set(lang, h);
  }
  return h;
}

export interface HyphenOptions {
  /** shortest word (letters) that may be hyphenated */
  minWord?: number;
  /** letters kept before / after a break */
  before?: number;
  after?: number;
}

const cache = new Map<string, number[]>();
const LETTER = /\p{L}/u;

/**
 * Offsets in `word` where it may break (the hyphen goes after word[i - 1]).
 * Leading and trailing punctuation ("(word," or "word.") is skipped; words
 * with digits or inner punctuation other than an apostrophe are left alone.
 * Soft hyphens already in the text are honoured as the only break points.
 */
export function hyphenPoints(word: string, lang: HyphenLanguage = 'en-GB', opts: HyphenOptions = {}): number[] {
  const minWord = opts.minWord ?? 5;
  const before = Math.max(1, opts.before ?? 2);
  const after = Math.max(1, opts.after ?? 3);
  const key = `${lang}|${minWord}|${before}|${after}|${word}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let a = 0;
  let b = word.length;
  while (a < b && !LETTER.test(word[a])) a++;
  while (b > a && !LETTER.test(word[b - 1])) b--;
  const core = word.slice(a, b);
  let out: number[] = [];
  if (core.includes(SHY)) {
    // discretionary hyphens typed by the user: break after each one
    for (let i = 0; i < core.length; i++) if (core[i] === SHY && i > 0 && i < core.length - 1) out.push(a + i + 1);
  } else if (core.length >= minWord && /^[\p{L}'’]+$/u.test(core)) {
    const marked = hyphenator(lang)(core);
    let i = 0;
    for (const ch of marked) {
      if (ch === SHY) {
        if (i >= before && core.length - i >= after) out.push(a + i);
      } else i += ch.length;
    }
  }
  if (cache.size > 20000) cache.clear();
  out = out.filter((p, i, arr) => arr.indexOf(p) === i);
  cache.set(key, out);
  return out;
}

/** The word with "-" at each break point (tests, the inspector preview). */
export function hyphenateWord(word: string, lang: HyphenLanguage = 'en-GB', opts?: HyphenOptions): string {
  const pts = hyphenPoints(word, lang, opts);
  let out = '';
  let last = 0;
  for (const p of pts) {
    out += word.slice(last, p) + '-';
    last = p;
  }
  return out + word.slice(last);
}
