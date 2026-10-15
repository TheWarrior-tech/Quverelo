/**
 * Shell v3 guard rails (docs/DESIGN.md §2, §8; UX P1-3, P1-5):
 * - no native <input type="color"> in the shell: colour goes through ColorChipButton
 * - inline styles in ui/ only carry runtime values (CSS custom properties,
 *   positions, sizes of virtualised rows, font previews), never design values
 * - one segmented control implementation
 * Dialogs and the Welcome screen are owned by other work and excluded here.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const UI = path.resolve('src/renderer/ui');
const EXCLUDE = [/^dialogs\//, /^Welcome\.tsx$/];

function files(dir = UI, rel = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return files(path.join(dir, e.name), r);
    return e.name.endsWith('.tsx') && !EXCLUDE.some((x) => x.test(r)) ? [r] : [];
  });
}

/** keys an inline style may set: runtime geometry and data-driven paint only */
const RUNTIME_KEYS = new Set(['left', 'top', 'height', 'width', 'fontFamily', 'background', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'visibility']);

describe('shell lint', () => {
  const list = files();

  it('has no native colour inputs', () => {
    const bad = list.filter((f) => /<input[^>]*type=["']color["']/.test(fs.readFileSync(path.join(UI, f), 'utf8')));
    expect(bad).toEqual([]);
  });

  it('keeps design values out of inline styles', () => {
    const bad: string[] = [];
    for (const f of list) {
      const src = fs.readFileSync(path.join(UI, f), 'utf8');
      for (const m of src.matchAll(/style=\{\{([^}]*)\}\}/g)) {
        const body = m[1];
        // split top-level "key: value" pairs
        for (const pair of body.split(/,(?![^(]*\))/)) {
          const key = pair.split(':')[0].trim();
          if (!key || key.startsWith("['--") || key.startsWith('[`--') || key.startsWith('...')) continue;
          if (key === 'display' && /'contents'/.test(pair)) continue; // layout-neutral wrapper
          if (!RUNTIME_KEYS.has(key)) bad.push(`${f}: ${pair.trim()}`);
          else if (/:\s*['"][^'"]*var\(--/.test(pair) || /:\s*['"]#[0-9a-f]{3,8}['"]/i.test(pair)) bad.push(`${f}: ${pair.trim()} (token or colour literal)`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('has one Segmented implementation', () => {
    const defs = list.filter((f) => /export function Segmented\b/.test(fs.readFileSync(path.join(UI, f), 'utf8')));
    expect(defs).toEqual(['controls/Segmented.tsx']);
    // dialogs keep a sized adapter, which must render the shared component
    const dlg = fs.readFileSync(path.join(UI, 'dialogs/controls.tsx'), 'utf8');
    expect(dlg).toMatch(/<SharedSegmented\b/);
  });

  it('has no hand-rolled segmented styles (.seg, .choice-row) outside the shared control', () => {
    const css = [path.resolve('src/renderer/styles.css'), ...fs.readdirSync(UI, { recursive: true }).map(String).filter((f) => f.endsWith('.css')).map((f) => path.join(UI, f))];
    const bad: string[] = [];
    for (const f of css) {
      const src = fs.readFileSync(f, 'utf8');
      if (/\.seg[\s.{[:,]/.test(src)) bad.push(`${path.relative(process.cwd(), f)}: .seg`);
      if (/\.choice-row\b/.test(src)) bad.push(`${path.relative(process.cwd(), f)}: .choice-row`);
    }
    const allTsx = fs.readdirSync(UI, { recursive: true }).map(String).filter((f) => f.endsWith('.tsx'));
    for (const f of allTsx) {
      const src = fs.readFileSync(path.join(UI, f), 'utf8');
      if (/className=["'`{][^>]*(?<![\w-])(seg|choice-row)(?![\w-])/.test(src)) bad.push(`${f}: seg/choice-row class`);
    }
    expect(bad).toEqual([]);
  });

  it('uses radius tokens only (DESIGN.md §6): no literal px border-radius in CSS', () => {
    const css = [path.resolve('src/renderer/styles.css'), ...fs.readdirSync(UI, { recursive: true }).map(String).filter((f) => f.endsWith('.css')).map((f) => path.join(UI, f))];
    const bad: string[] = [];
    for (const f of css) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // values derived from a radius token (calc(var(--r-1) - 1px)) are allowed; bare px are not
        const v = line.replace(/calc\([^)]*var\(--r-[\w-]+\)[^)]*\)/g, 'token');
        if (/border-radius\s*:[^;]*\b\d*\.?\d+px/.test(v) && !/^\s*--/.test(line)) bad.push(`${path.relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('keeps themed scrollbars: no global scrollbar-width/colour, one ::-webkit-scrollbar block (CRITIQUE-3 N7)', () => {
    const css = [path.resolve('src/renderer/styles.css'), ...fs.readdirSync(UI, { recursive: true }).map(String).filter((f) => f.endsWith('.css')).map((f) => path.join(UI, f))];
    const bad: string[] = [];
    let webkitBlocks = 0;
    for (const f of css) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      webkitBlocks += (src.match(/(^|\n)\s*::-webkit-scrollbar\s*\{/g) ?? []).length;
      // Chromium 121+ lets these win over ::-webkit-scrollbar, bringing back native arrows:
      // allowed only as "none" on one element, or inside @supports not selector(::-webkit-scrollbar)
      const outsideSupports = src.replace(/@supports\s+not\s+selector\(::-webkit-scrollbar\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
      for (const m of outsideSupports.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        const [sel, body] = [m[1].trim(), m[2]];
        if (/scrollbar-color\s*:/.test(body)) bad.push(`${path.relative(process.cwd(), f)}: ${sel} sets scrollbar-color`);
        if (/scrollbar-width\s*:(?!\s*none)/.test(body)) bad.push(`${path.relative(process.cwd(), f)}: ${sel} sets scrollbar-width`);
      }
    }
    expect(bad).toEqual([]);
    expect(webkitBlocks).toBe(1);
  });
});

/* ---------- high contrast selection vocabulary (DESIGN.md §9, critique 4 R1) ---------- */

const CSS_FILES = () => [path.resolve('src/renderer/styles.css'), ...fs.readdirSync(UI, { recursive: true }).map(String).filter((f) => f.endsWith('.css')).map((f) => path.join(UI, f))];
const HC = "[data-theme='high-contrast']";

interface Rule { file: string; selectors: string[]; body: string }

/** split at top-level commas (not inside :is(), :not(), [attr]) */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** expand every :is(a, b) into one selector per alternative */
function expandIs(sel: string): string[] {
  const i = sel.indexOf(':is(');
  if (i < 0) return [sel];
  let depth = 0;
  let j = i + 3;
  for (; j < sel.length; j++) {
    if (sel[j] === '(') depth++;
    else if (sel[j] === ')' && --depth === 0) break;
  }
  const inner = sel.slice(i + 4, j);
  return splitTop(inner).flatMap((alt) => expandIs(sel.slice(0, i) + alt + sel.slice(j + 1)));
}

/** flat rules (top level and inside @media/@supports), comments stripped */
function rules(): Rule[] {
  const out: Rule[] = [];
  for (const f of CSS_FILES()) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim();
      if (!sel || /^(from|to|\d+%)/.test(sel)) continue;
      out.push({ file: path.relative(process.cwd(), f), selectors: splitTop(sel).flatMap(expandIs), body: m[2] });
    }
  }
  return out;
}

/** the subject compound of a selector: what follows the last descendant/child combinator */
const subject = (sel: string) => {
  let depth = 0;
  let cut = 0;
  for (let k = 0; k < sel.length; k++) {
    const ch = sel[k];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) cut = k + 1;
  }
  return sel.slice(cut);
};
/** a selected / current / checked / on state on the subject itself (not disabled) */
const SELECTED_STATE = /(\.selected|\.current|\.active|\.on|\[aria-(current|selected|checked|pressed)=['"]true['"]\])(?![\w-])/;
const isSelectedRule = (sel: string) => sel.includes(HC) && SELECTED_STATE.test(subject(sel).replace(/:not\([^)]*\)/g, '')) && !/disabled/.test(subject(sel)) && !/::/.test(sel);
const decl = (body: string, prop: string) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1].trim();
const isWash = (v: string) => /color-mix|accent-wash|transparent|rgba\([^)]*,\s*0?\.\d+\s*\)/.test(v);

describe('high contrast selection vocabulary', () => {
  const all = rules();

  it('never draws a selected/current/checked state as an outline or inset ring alone (selected must not look like focus)', () => {
    const bad: string[] = [];
    for (const r of all) {
      for (const sel of r.selectors.filter(isSelectedRule)) {
        if (/:focus/.test(subject(sel))) continue; // the focus half of selected+focused
        const outline = decl(r.body, 'outline');
        const shadow = decl(r.body, 'box-shadow') ?? '';
        const bg = decl(r.body, 'background') ?? decl(r.body, 'background-color');
        const ringOnly = (outline && outline !== 'none' && !/^0/.test(outline)) || /inset\s+0\s+0\s+0\s+[1-9]/.test(shadow);
        if (ringOnly && (!bg || isWash(bg) || bg === '#000' || bg === 'var(--c-popover)')) bad.push(`${r.file}: ${sel} { outline/inset ring without a fill }`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never fills a selected state with a translucent wash or olive in high contrast', () => {
    const bad: string[] = [];
    for (const r of all) {
      for (const sel of r.selectors.filter(isSelectedRule)) {
        const bg = decl(r.body, 'background') ?? decl(r.body, 'background-color');
        if (bg && isWash(bg)) bad.push(`${r.file}: ${sel} { background: ${bg} }`);
      }
    }
    // the high-contrast token block itself: no translucent accent wash
    const styles = fs.readFileSync(path.resolve('src/renderer/styles.css'), 'utf8');
    const hcBlock = styles.match(/:root\[data-theme='high-contrast'\]\s*\{([^}]*)\}/)![1];
    const wash = hcBlock.match(/--c-accent-wash:\s*([^;]+);/)![1];
    expect(wash).not.toMatch(/rgba|color-mix/);
    for (const f of CSS_FILES()) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of src.matchAll(/([^{}]*high-contrast[^{}]*)\{([^{}]*)\}/g)) if (/color-mix/.test(m[2])) bad.push(`${path.relative(process.cwd(), f)}: ${m[1].trim()} uses color-mix`);
    }
    expect(bad).toEqual([]);
  });

  it('writes the HC selected rows once, in styles.css, as a solid accent fill with accent ink', () => {
    // every list the critique names is covered by the one fill rule
    const want = [
      '.layer-row.selected',
      '.history-list li.current button',
      ".nav-item[aria-current='true']",
      ".nav-item[aria-selected='true']",
      ".preset[aria-checked='true']",
      ".theme-tile[aria-checked='true']",
      '.page-thumb.active',
      '.flyout-item.on',
      '.cmdk-row.active',
      '.font-row.active',
      ".menu-item[aria-checked='true']",
    ];
    const fill = all.filter((r) => r.file === 'src/renderer/styles.css' && decl(r.body, 'background') === 'var(--c-accent)' && decl(r.body, 'color') === 'var(--c-accent-ink)');
    const covered = new Set(fill.flatMap((r) => r.selectors).map((s) => s.replace(`:root${HC} `, '').trim()));
    expect(want.filter((w) => !covered.has(w))).toEqual([]);
    // and no other file styles those rows' selected state in high contrast
    const elsewhere: string[] = [];
    for (const r of all) {
      if (r.file === 'src/renderer/styles.css') continue;
      for (const sel of r.selectors) if (sel.includes(HC) && want.some((w) => sel.includes(w))) elsewhere.push(`${r.file}: ${sel}`);
    }
    expect(elsewhere).toEqual([]);
    // focus in high contrast is the §9 ring: 3px yellow outline, 2px offset
    const focus = all.find((r) => r.file === 'src/renderer/styles.css' && r.selectors.some((s) => s.includes(HC) && s.endsWith('.layer-row:focus-visible')));
    expect(focus && decl(focus.body, 'outline')).toBe('3px solid var(--c-focus)');
    expect(focus && decl(focus.body, 'outline-offset')).toBe('2px');
  });

  it('defines .layer-row.selected once per theme (no duplicate blocks across files)', () => {
    const count = (hc: boolean) => all.filter((r) => r.selectors.some((s) => (hc ? s === `:root${HC} .layer-row.selected` : s === '.layer-row.selected'))).length;
    expect(count(false)).toBe(1);
    expect(count(true)).toBe(1);
  });

  it('never makes a disabled control translucent in high contrast', () => {
    // every base rule that fades a disabled control has an HC rule restoring opacity: 1
    const faded = all.filter((r) => { const o = decl(r.body, 'opacity'); return o && parseFloat(o) < 1; })
      .flatMap((r) => r.selectors.filter((s) => !s.includes('data-theme') && /(:disabled|\.disabled)/.test(subject(s))));
    const restored = new Set(all.filter((r) => decl(r.body, 'opacity') === '1').flatMap((r) => r.selectors).filter((s) => s.includes(HC)).map((s) => s.replace(`:root${HC} `, '').trim()));
    expect(faded.filter((s) => !restored.has(s))).toEqual([]);
  });
});
