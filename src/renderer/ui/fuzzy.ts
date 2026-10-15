/**
 * Fuzzy matching for the command palette. Pure (no DOM, no editor state) so it
 * is unit-tested directly.
 *
 * Ranking, best first: the label starts with the query, a word in the label
 * starts with it, the label contains it, a synonym (keyword) matches, then a
 * subsequence of the label whose letters land on word starts ("bf" → Bring to
 * Front). Multi-word queries match when every word matches somewhere (label,
 * keyword or group), so "export pdf" and "pdf export" both find Export PDF….
 */

export interface Searchable {
  label: string;
  keywords?: readonly string[];
  /** Group name ("File", "Tool"); matched weakly. */
  group?: string;
}

export interface Match {
  score: number;
  /** [start, end) ranges in `label` to highlight. */
  ranges: [number, number][];
}

/** Lowercase, strip diacritics and the ellipsis so "Save As…" matches "save as". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/…/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const isWordStart = (s: string, i: number) => i === 0 || /[\s\-/(:.·]/.test(s[i - 1]);

/** Score one query term against the label; null when it does not match the label. */
function matchLabel(term: string, label: string): Match | null {
  const l = normalize(label);
  if (!term) return { score: 0, ranges: [] };
  if (l === term) return { score: 1000, ranges: [[0, label.length]] };
  if (l.startsWith(term)) return { score: 900 - l.length, ranges: [[0, term.length]] };
  // word-start substring ("pdf" in "Export PDF")
  let at = -1;
  for (let i = l.indexOf(term); i >= 0; i = l.indexOf(term, i + 1)) {
    if (isWordStart(l, i)) {
      at = i;
      break;
    }
  }
  if (at >= 0) return { score: 800 - at - l.length / 10, ranges: [[at, at + term.length]] };
  const sub = l.indexOf(term);
  if (sub >= 0 && term.length >= 3) return { score: 600 - sub - l.length / 10, ranges: [[sub, sub + term.length]] };
  // subsequence, rewarding letters that land on word starts and runs
  if (term.length < 2) return null;
  const ranges: [number, number][] = [];
  let j = 0;
  let bonus = 0;
  let last = -2;
  for (let i = 0; i < l.length && j < term.length; i++) {
    if (l[i] !== term[j]) continue;
    if (isWordStart(l, i)) bonus += 12;
    if (i === last + 1) {
      bonus += 6;
      ranges[ranges.length - 1][1] = i + 1;
    } else ranges.push([i, i + 1]);
    last = i;
    j++;
  }
  if (j < term.length) return null;
  // a scatter of single letters inside words is noise, not a match
  const starts = ranges.filter(([s]) => isWordStart(l, s)).length;
  if (!isWordStart(l, ranges[0][0])) return null;
  if (ranges.length > Math.max(2, Math.ceil(term.length / 2)) && starts < ranges.length - 1) return null;
  return { score: 300 + bonus - ranges.length * 8 - l.length / 10, ranges };
}

function matchKeywords(term: string, keywords: readonly string[] | undefined): number {
  if (!term || !keywords) return 0;
  let best = 0;
  for (const k of keywords) {
    const kw = normalize(k);
    if (kw === term) best = Math.max(best, 700);
    else if (kw.startsWith(term)) best = Math.max(best, 650 - kw.length / 10);
    else if (term.length >= 3 && kw.split(' ').some((w) => w.startsWith(term))) best = Math.max(best, 560);
    else if (term.length >= 4 && kw.includes(term)) best = Math.max(best, 450);
  }
  return best;
}

/** Score `item` for `query`. Returns null when it does not match. An empty query matches everything with score 0. */
export function fuzzyMatch(query: string, item: Searchable): Match | null {
  const q = normalize(query);
  if (!q) return { score: 0, ranges: [] };
  const whole = matchLabel(q, item.label);
  const kwWhole = matchKeywords(q, item.keywords);
  if (whole || kwWhole) {
    if (whole && whole.score >= kwWhole) return whole;
    return { score: kwWhole, ranges: whole?.ranges ?? [] };
  }
  const terms = q.split(' ').filter(Boolean);
  if (terms.length < 2) return null;
  let score = 0;
  const ranges: [number, number][] = [];
  const group = item.group ? normalize(item.group) : '';
  for (const t of terms) {
    const m = matchLabel(t, item.label);
    const k = matchKeywords(t, item.keywords);
    const g = group && group.startsWith(t) ? 400 : 0;
    const best = Math.max(m?.score ?? 0, k, g);
    if (!best) return null;
    if (m && m.score >= k) ranges.push(...m.ranges);
    score += best;
  }
  return { score: score / terms.length - 50, ranges: mergeRanges(ranges) };
}

export function mergeRanges(r: [number, number][]): [number, number][] {
  const s = [...r].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

/**
 * Filter and sort `items` for `query`. Ties keep their original order, so the
 * caller's ordering (menu order, recents first) is the tiebreaker. Disabled
 * items sink below enabled ones with a similar score.
 */
export function rank<T extends Searchable & { disabled?: unknown }>(query: string, items: readonly T[]): { item: T; match: Match }[] {
  const out: { item: T; match: Match; i: number }[] = [];
  items.forEach((item, i) => {
    const match = fuzzyMatch(query, item);
    if (match) out.push({ item, match, i });
  });
  if (!normalize(query)) return out;
  const eff = (x: { item: T; match: Match }) => x.match.score - (x.item.disabled ? 150 : 0);
  out.sort((a, b) => eff(b) - eff(a) || a.i - b.i);
  return out;
}
