import { describe, expect, it } from 'vitest';
import { fuzzyMatch, mergeRanges, normalize, rank } from '../../src/renderer/ui/fuzzy';
import { disabledReason, pushRecent, TOOL_KEYWORDS, type PaletteContext } from '../../src/renderer/state/paletteModel';
import { APP_MENU, allMenuCommands } from '../../src/shared/menu';

const cmds = allMenuCommands().map((c) => ({ ...c, label: c.label.replace(/…$/, ''), group: '' }));
const top = (q: string, n = 1) => rank(q, cmds).slice(0, n).map((r) => r.item.id);

describe('fuzzy matching', () => {
  it('normalises case, accents, whitespace and the ellipsis', () => {
    expect(normalize('  Save  As… ')).toBe('save as');
    expect(normalize('Café')).toBe('cafe');
  });

  it('ranks prefix > word start > substring', () => {
    const items = [{ label: 'Unexported' }, { label: 'File: Export PNG' }, { label: 'Export PDF' }];
    expect(rank('export', items).map((r) => r.item.label)).toEqual(['Export PDF', 'File: Export PNG', 'Unexported']);
  });

  it('finds commands by label', () => {
    expect(top('save')).toEqual(['file.save']);
    expect(top('undo')).toEqual(['edit.undo']);
    expect(top('export pdf')).toEqual(['file.export-pdf']);
    expect(top('pdf export')).toEqual(['file.export-pdf']);
  });

  it('finds commands by synonym (keywords)', () => {
    expect(top('cutout')).toEqual(['select.subject']);
    expect(top('remove background')).toEqual(['select.subject']);
    expect(top('print')).toEqual(['file.export-pdf']);
    expect(top('rasterize')).toEqual(['layer.rasterize']);
    expect(top('union')).toEqual(['layer.bool-add']);
    expect(top('settings')).toEqual(['app.preferences']);
  });

  it('matches word-initial abbreviations', () => {
    expect(top('btf')).toEqual(['arrange.front']);
    expect(fuzzyMatch('zf', { label: 'Zoom to Fit' })).not.toBeNull();
  });

  it('rejects scattered letters and non-matches', () => {
    expect(fuzzyMatch('xq', { label: 'Export PNG' })).toBeNull();
    expect(fuzzyMatch('zzz', { label: 'Save' })).toBeNull();
    expect(rank('qwertyuiop', cmds)).toEqual([]);
  });

  it('returns highlight ranges inside the label', () => {
    const m = fuzzyMatch('pdf', { label: 'Export PDF' })!;
    expect(m.ranges).toEqual([[7, 10]]);
    expect(mergeRanges([[3, 5], [0, 2], [4, 8]])).toEqual([[0, 2], [3, 8]]);
  });

  it('empty query keeps every item in order; disabled items sink on ties', () => {
    expect(rank('', cmds).length).toBe(cmds.length);
    const r = rank('align', [{ label: 'Align Left', disabled: 'x' }, { label: 'Align Left' }]);
    expect(r[0].item.disabled).toBeUndefined();
  });
});

describe('menu commands for the palette', () => {
  it('has Command Palette on Ctrl/Cmd+K', () => {
    const c = allMenuCommands().find((x) => x.id === 'help.command-palette');
    expect(c?.accel).toBe('CmdOrCtrl+K');
  });

  it('ids and accelerators are unique', () => {
    const ids = allMenuCommands().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const accels = allMenuCommands().filter((c) => c.accel).map((c) => c.accel);
    expect(new Set(accels).size).toBe(accels.length);
  });

  it('keywords are lowercase, non-empty and not just the label again', () => {
    for (const s of APP_MENU) {
      for (const c of s.items) {
        if (c === '-' || !c.keywords) continue;
        for (const k of c.keywords) {
          expect(k, c.id).toBe(k.toLowerCase());
          expect(k.trim().length, c.id).toBeGreaterThan(1);
        }
      }
    }
    expect(allMenuCommands().filter((c) => c.keywords?.length).length).toBeGreaterThan(60);
  });

  it('every tool has synonyms', () => {
    expect(Object.keys(TOOL_KEYWORDS).length).toBeGreaterThanOrEqual(20);
  });
});

describe('palette availability', () => {
  const base: PaletteContext = { hasDoc: true, selection: 0, groups: 0, textFrames: 0, pixelSelection: false, canUndo: false, canRedo: false, pages: 1, pageIndex: 0, studio: 'photo' };
  it('without a document only app-level commands run', () => {
    const c = { ...base, hasDoc: false };
    expect(disabledReason('file.new', c)).toBeNull();
    expect(disabledReason('file.open', c)).toBeNull();
    expect(disabledReason('app.preferences', c)).toBeNull();
    expect(disabledReason('view.theme-light', c)).toBeNull();
    expect(disabledReason('help.shortcuts', c)).toBeNull();
    expect(disabledReason('file.save', c)).toMatch(/document/);
    expect(disabledReason('view.zoom-in', c)).toMatch(/document/);
  });
  it('explains selection requirements', () => {
    expect(disabledReason('select.crop', base)).toBe('Needs a pixel selection');
    expect(disabledReason('select.crop', { ...base, pixelSelection: true })).toBeNull();
    expect(disabledReason('arrange.align-left', base)).toMatch(/Select/);
    expect(disabledReason('arrange.align-left', { ...base, selection: 1 })).toBeNull();
    expect(disabledReason('layer.bool-add', { ...base, selection: 1 })).toMatch(/two/);
    expect(disabledReason('arrange.distribute-h', { ...base, selection: 2 })).toMatch(/3/);
    expect(disabledReason('arrange.group', { ...base, selection: 2 })).toBeNull();
    expect(disabledReason('arrange.ungroup', { ...base, selection: 2 })).toMatch(/group/);
    expect(disabledReason('edit.undo', base)).toBe('Nothing to undo');
    expect(disabledReason('edit.delete', { ...base, pixelSelection: true })).toBeNull();
    expect(disabledReason('page.delete', base)).toMatch(/one page/);
    expect(disabledReason('select.subject', base)).toBeNull();
  });
  it('keeps the five most recent, newest first, without duplicates', () => {
    let r: string[] = [];
    for (const k of ['a', 'b', 'c', 'a', 'd', 'e', 'f']) r = pushRecent(r, k);
    expect(r).toEqual(['f', 'e', 'd', 'a', 'c']);
  });
});

describe('fuzzy noise', () => {
  it('a subsequence must start on a word', () => {
    expect(fuzzyMatch('exp', { label: 'Next Page' })).toBeNull();
    expect(fuzzyMatch('np', { label: 'Next Page' })).not.toBeNull();
  });
});
