/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { audit, failures, parseColor, ratio, parseTokens } from '../../scripts/contrast-audit.mjs';

const css = readFileSync(new URL('../../src/renderer/styles.css', import.meta.url), 'utf8');

describe('contrast audit (WCAG 2.2 AA)', () => {
  it('computes reference ratios', () => {
    expect(ratio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 5);
    expect(ratio(parseColor('#777777')!, parseColor('#ffffff')!)).toBeCloseTo(4.48, 2);
    expect(parseColor('rgba(255, 255, 255, 0.5)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
  });

  it('reads all three themes from styles.css', () => {
    const t = parseTokens(css);
    for (const theme of ['dark', 'light', 'high-contrast'] as const) {
      for (const k of ['c-text', 'c-text-2', 'c-text-3', 'c-panel', 'c-accent', 'c-accent-ink', 'c-focus', 'c-line-strong']) {
        expect(parseColor(t[theme][k] ?? ''), `${theme} --${k}`).not.toBeNull();
      }
    }
    expect(t.light['c-text']).not.toBe(t.dark['c-text']);
  });

  it('every text pair is >= 4.5:1 and every UI/focus pair >= 3:1 in dark, light and high contrast', () => {
    const rows = audit(css);
    expect(rows.length).toBeGreaterThan(100);
    const bad = failures(rows).map((r) => `${r.theme}: --${r.fg} on --${r.bg} = ${r.ratio}:1 (needs ${r.min})`);
    expect(bad).toEqual([]);
  });

  it('segmented active tile is distinguishable from its track in every theme and on panels and dialogs', () => {
    const rows = audit(css).filter((r) => r.note.startsWith('segmented active tile'));
    expect(rows.map((r) => r.theme).sort()).toEqual(['dark', 'dark', 'high-contrast', 'high-contrast', 'light', 'light']);
    expect(rows.filter((r) => !r.pass)).toEqual([]);
  });

  it('text selection uses the accent wash with readable ink in every theme', () => {
    const rows = audit(css).filter((r) => r.fg === 'c-selection-ink');
    expect(rows.length).toBe(9);
    expect(rows.filter((r) => !r.pass)).toEqual([]);
  });
});
