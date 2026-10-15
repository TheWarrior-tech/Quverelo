/**
 * Critique 3 P2-5: every palette command row has an icon (the top "Export" row
 * had none while its neighbours did). Checked from source so the test does not
 * need the editor runtime.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { allMenuCommands } from '../../src/shared/menu';

describe('command palette icons', () => {
  it('every menu command maps to an icon', () => {
    const src = fs.readFileSync('src/renderer/state/palette.ts', 'utf8');
    const fn = src.slice(src.indexOf('export function commandIcon'), src.indexOf('export function paletteContext'));
    const direct = new Set([...fn.matchAll(/'([a-z-]+\.[a-z0-9-]+)': '/g)].map((m) => m[1]));
    const icons = new Set(fs.readFileSync('src/renderer/ui/Icons.tsx', 'utf8').match(/^ {2}'?[a-z0-9-]+'?: /gm)!.map((s) => s.trim().replace(/['":]/g, '')));
    for (const m of fn.matchAll(/'[a-z-]+\.[a-z0-9-]+': '([a-z0-9-]+)'/g)) expect(icons.has(m[1]), m[1]).toBe(true);
    const missing = allMenuCommands()
      .map((c) => c.id)
      .filter((id) => !direct.has(id) && id !== 'file.export' && !id.startsWith('file.export-') && !id.startsWith('studio.') && !/^(align-|distribute-|flip-|bool-)/.test(id.split('.')[1] ?? ''));
    expect(missing).toEqual([]);
    expect(fn).toMatch(/id === 'file\.export'/);
  });
});
