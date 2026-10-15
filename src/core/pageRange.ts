/**
 * Page ranges as typed in the Export dialog: "1-3, 5", "2–4", "7-" (to the end).
 * Pages are 1-based in the text and 0-based in the result.
 */
export type PageRangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

export function parsePageRange(text: string, pageCount: number): PageRangeResult {
  const src = text.trim();
  if (!src) return { ok: false, error: 'Enter pages, for example 1–3, 5' };
  const out: number[] = [];
  const seen = new Set<number>();
  const add = (p: number) => {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p - 1);
    }
  };
  for (const raw of src.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)\s*(?:[-–—]\s*(\d*))?$/.exec(part);
    if (!m) return { ok: false, error: `“${part}” is not a page or range` };
    const a = parseInt(m[1], 10);
    const open = part.length > m[1].length && m[2] === '';
    const b = m[2] ? parseInt(m[2], 10) : open ? pageCount : a;
    if (a < 1 || b < 1) return { ok: false, error: 'Pages start at 1' };
    if (a > pageCount || b > pageCount) return { ok: false, error: `This document has ${pageCount} page${pageCount === 1 ? '' : 's'}` };
    if (b < a) return { ok: false, error: `“${part}” runs backwards` };
    for (let p = a; p <= b; p++) add(p);
  }
  if (!out.length) return { ok: false, error: 'Enter pages, for example 1–3, 5' };
  return { ok: true, pages: out };
}

/** Compact text for a page list: [0,1,2,4] → "1–3, 5". */
export function formatPageRange(pages: number[]): string {
  const s = [...new Set(pages)].sort((a, b) => a - b).map((p) => p + 1);
  const parts: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i]}–${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return parts.join(', ');
}
