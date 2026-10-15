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
