#!/usr/bin/env node
// WCAG 2.2 AA contrast audit for the design tokens in src/renderer/styles.css.
//
// Parses the --c-* tokens for the dark (:root), light and high-contrast themes,
// composites translucent tokens over the surface they sit on, and checks every
// pair the UI actually draws:
//   text  >= 4.5:1  (1.4.3)  primary/secondary/tertiary text, links, danger, text on accent
//   ui    >= 3:1    (1.4.11) focus ring, control boundaries, active-tool fill, selection
// Decorative hairlines (--c-line) separate regions that are already identified
// by layout and are reported for information only, never failing the audit.
//
// usage: node scripts/contrast-audit.mjs [path/to/styles.css] [--json]
// exit code 1 when any required pair fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const THEMES = {
  dark: /:root\s*\{([^}]*)\}/,
  light: /:root\[data-theme='light'\]\s*\{([^}]*)\}/,
  'high-contrast': /:root\[data-theme='high-contrast'\]\s*\{([^}]*)\}/,
};

/** Surfaces a foreground can sit on. Translucent fills are composited over `over`. */
const SURFACES = ['c-canvas', 'c-app', 'c-panel', 'c-raised', 'c-popover'];

/**
 * Every pair checked. `on` is a list of backgrounds; a background of the form
 * 'c-hover@c-panel' means the translucent token composited over that surface.
 */
export const PAIRS = [
  // text (4.5:1)
  { fg: 'c-text', on: [...SURFACES, 'c-hover@c-panel', 'c-press@c-panel', 'c-press@c-raised', 'c-accent-wash@c-panel'], kind: 'text', note: 'primary text' },
  { fg: 'c-text-2', on: [...SURFACES, 'c-hover@c-app', 'c-hover@c-panel', 'c-accent-wash@c-panel'], kind: 'text', note: 'secondary text, idle icon buttons' },
  { fg: 'c-text-3', on: [...SURFACES, 'c-hover@c-panel'], kind: 'text', note: 'tertiary text, placeholders, units, ruler labels' },
  { fg: 'c-accent', on: ['c-app', 'c-panel', 'c-raised', 'c-popover'], kind: 'text', note: 'links / accent text' },
  { fg: 'c-danger', on: ['c-panel', 'c-raised', 'c-popover'], kind: 'text', note: 'destructive text' },
  { fg: 'c-accent-ink', on: ['c-accent', 'c-accent-hover'], kind: 'text', note: 'text/icon on solid accent' },
  // non-text UI (3:1)
  { fg: 'c-focus', on: SURFACES, kind: 'ui', note: 'focus ring' },
  { fg: 'c-accent', on: ['c-app', 'c-panel', 'c-raised', 'c-popover'], kind: 'ui', note: 'active tool fill, checkbox on, selection outline' },
  { fg: 'c-line-strong', on: ['c-app', 'c-panel', 'c-raised', 'c-popover'], kind: 'ui', note: 'input / button / keycap boundary' },
  // informational only
  { fg: 'c-line', on: ['c-app', 'c-panel', 'c-raised', 'c-popover'], kind: 'decorative', note: 'hairline separators (exempt)' },
];

export const MIN = { text: 4.5, ui: 3, decorative: 0 };

export function parseColor(v) {
  v = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}

export function composite(fg, bg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

function lum({ r, g, b }) {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

/** Token map per theme; light and high-contrast inherit anything they don't set from :root. */
export function parseTokens(css) {
  const out = {};
  const read = (block) => Object.fromEntries([...block.matchAll(/--(c-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const base = read(THEMES.dark.exec(css)?.[1] ?? '');
  for (const [name, re] of Object.entries(THEMES)) {
    const own = name === 'dark' ? {} : read(re.exec(css)?.[1] ?? '');
    out[name] = { ...base, ...own };
  }
  return out;
}

function resolve(tokens, spec) {
  const [top, under] = spec.split('@');
  const raw = parseColor(tokens[top] ?? '');
  if (!raw) throw new Error(`token --${top} missing or not a colour: ${tokens[top]}`);
  if (raw.a >= 1) return raw;
  const base = under ? resolve(tokens, under) : resolve(tokens, 'c-panel');
  return composite(raw, base);
}

/** Run the audit on CSS text. Returns one row per (theme, pair, background). */
export function audit(css) {
  const themes = parseTokens(css);
  const rows = [];
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const p of PAIRS) {
      for (const bgSpec of p.on) {
        const bg = resolve(tokens, bgSpec);
        // a translucent foreground is drawn over the background it is checked against
        const fgRaw = parseColor(tokens[p.fg]);
        const fg = fgRaw.a < 1 ? composite(fgRaw, bg) : fgRaw;
        const r = ratio(fg, bg);
        const min = MIN[p.kind];
        rows.push({ theme, fg: p.fg, bg: bgSpec, kind: p.kind, note: p.note, ratio: Math.round(r * 100) / 100, min, pass: r >= min, fgHex: toHex(fg), bgHex: toHex(bg) });
      }
    }
  }
  return rows;
}

export const failures = (rows) => rows.filter((r) => r.kind !== 'decorative' && !r.pass);

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--')) ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/renderer/styles.css');
  const rows = audit(readFileSync(file, 'utf8'));
  if (args.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    let theme = '';
    for (const r of rows) {
      if (r.theme !== theme) console.log(`\n${(theme = r.theme).toUpperCase()}`);
      const mark = r.kind === 'decorative' ? ' info' : r.pass ? '  ok ' : ' FAIL';
      console.log(`${mark}  ${r.ratio.toFixed(2).padStart(5)}:1 (min ${r.min})  --${r.fg.padEnd(14)} on --${r.bg.padEnd(22)} ${r.fgHex} / ${r.bgHex}  ${r.note}`);
    }
    const f = failures(rows);
    console.log(`\n${rows.filter((r) => r.kind !== 'decorative').length} required pairs checked, ${f.length} failing.`);
  }
  process.exit(failures(rows).length ? 1 : 0);
}
