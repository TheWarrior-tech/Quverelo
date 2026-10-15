/**
 * Sentence case for every UI string (docs/DESIGN.md §4, critique 2 P1-8):
 * buttons, dialog titles, tabs, headings, labels and tooltips are written
 * "Document setup", never "Document Setup". Two exceptions, both checked here:
 * - native menu items keep platform Title Case (shared/menu.ts), so a string
 *   may quote a menu item as a path ("File › Place Image");
 * - proper nouns (product, font and platform names, keys) keep their capitals.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_MENU } from '../../src/shared/menu';

const UI = path.resolve('src/renderer/ui');
const STATE = path.resolve('src/renderer/state');
/** state modules whose strings reach the UI (confirm dialogs, toasts, tool names). palette.ts mirrors the native menu. */
const STATE_FILES = fs.readdirSync(STATE).filter((f) => f.endsWith('.ts') && !['palette.ts', 'paletteModel.ts'].includes(f));

/** Words that are capitalised wherever they appear. */
const PROPER = new Set([
  'Quvrelo', 'Inter', 'Atkinson', 'Hyperlegible', 'OpenDyslexic', 'Merriweather', 'Roboto', 'Slab', 'Caveat', 'Open', 'Font', 'Licence',
  'Windows', 'Linux', 'Electron', 'Ctrl', 'Shift', 'Alt', 'Cmd', 'Option', 'Enter', 'Esc', 'Tab', 'Space', 'Delete', 'Backspace',
  'Ms', 'Mr', 'Mrs', 'Patel', 'Friday', 'November', 'Academy', 'Flatpak', 'Snap', 'Mobbin', 'Figma', 'Affinity', 'Linear',
]);

function menuLabels(): string[] {
  const out: string[] = [];
  const walk = (items: unknown[]) => {
    for (const it of items as { label?: string; items?: unknown[]; submenu?: unknown[] }[]) {
      if (it.label) out.push(it.label.replace(/…$/, ''));
      if (it.items) walk(it.items);
      if (it.submenu) walk(it.submenu);
    }
  };
  walk(APP_MENU as unknown[]);
  return out.sort((a, b) => b.length - a.length);
}

function files(dir = UI, rel = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return files(path.join(dir, e.name), r);
    return e.name.endsWith('.tsx') ? [r] : [];
  });
}

/** The user-facing strings in a TSX source: JSX text, text-bearing props, object labels, tooltip text. */
export function uiStrings(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out: string[] = [];
  for (const m of code.matchAll(/(?<![=\-])>([^<>{}]*[A-Za-z][^<>{}]*)(?=[<{])/g)) out.push(m[1]);
  for (const m of code.matchAll(/\b(?:title|label|aria-label|ariaLabel|data-tip|placeholder|heading|description|hint|footnote)\s*=\s*\{?\s*(['"`])((?:(?!\1).)*)\1/g)) out.push(m[2]);
  for (const m of code.matchAll(/\b(?:label|title|description|hint|detail)\s*:\s*(['"`])((?:(?!\1).)*)\1/g)) out.push(m[2]);
  for (const m of code.matchAll(/\b(?:tip|toast)\(\s*(['"`])((?:(?!\1).)*)\1/g)) out.push(m[2]);
  return out.map((s) => s.replace(/\$\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** The offending pair of Title Case words in a string, or null. */
export function titleCasePair(text: string, menu = menuLabels()): string | null {
  let t = text;
  // a menu item quoted as a path ('File › Place Image') keeps the menu's Title Case
  for (const l of menu) t = t.split(`› ${l}`).join(' ');
  const isCap = (w: string) => /^[A-Z][a-z]+(?:['’][a-z]+)?$/.test(w) && !PROPER.has(w);
  // punctuation ends a run: "Add, Subtract" is a list of names, not a Title Case phrase
  for (const run of t.split(/[/·,;:()–—.!?…&"“”]+/)) {
    const words = run.split(/[\s-]+/).filter(Boolean);
    for (let i = 0; i + 1 < words.length; i++) {
      if (isCap(words[i]) && isCap(words[i + 1])) return `${words[i]} ${words[i + 1]}`;
    }
  }
  return null;
}

describe('sentence case', () => {
  it('flags Title Case and accepts sentence case, menu items and proper nouns', () => {
    expect(titleCasePair('Document Setup')).toBe('Document Setup');
    expect(titleCasePair("Don't Save")).toBe("Don't Save");
    expect(titleCasePair('Check for Updates')).toBeNull(); // "for" breaks the pair; caught by the button rule below
    expect(titleCasePair('Document setup…')).toBeNull();
    expect(titleCasePair('Place one with File › Place Image.')).toBeNull();
    expect(titleCasePair('Bundled fonts: Inter, Atkinson Hyperlegible')).toBeNull();
    expect(uiStrings('<button className="btn">Clear List</button>')).toEqual(['Clear List']);
    expect(uiStrings('<Dialog title="New Document" />')).toEqual(['New Document']);
  });

  it('every string in ui/ is sentence case', () => {
    const menu = menuLabels();
    const bad: string[] = [];
    const sources = [...files().map((f) => [f, path.join(UI, f)]), ...STATE_FILES.map((f) => [`state/${f}`, path.join(STATE, f)])];
    for (const [f, abs] of sources) {
      for (const s of uiStrings(fs.readFileSync(abs, 'utf8'))) {
        const pair = titleCasePair(s, menu);
        if (pair) bad.push(`${f}: "${s}" (${pair})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no button label is Title Case (critique 2: >[A-Z]\\w+ [A-Z]\\w+</button>)', () => {
    const bad: string[] = [];
    for (const f of files()) {
      const src = fs.readFileSync(path.join(UI, f), 'utf8');
      for (const m of src.matchAll(/>\s*([A-Z]\w+(?: \w+)* [A-Z]\w+)\s*<\/button>/g)) {
        if (!titleCasePair(m[1].replace(/\b(for|to|and|or|of|the|a|with|in|on)\b/g, ''))) continue;
        bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
