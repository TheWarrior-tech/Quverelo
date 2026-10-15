import { describe, expect, it } from 'vitest';
import { UNITS, UNIT_DIGITS, formatLength, formatSize, fromPx, lengthIn, parseLength, pixelsAt, toPx } from '../../src/core/units';

describe('units', () => {
  it('converts', () => {
    expect(toPx(1, 'in')).toBe(96);
    expect(fromPx(toPx(210, 'mm'), 'mm')).toBeCloseTo(210);
  });
  it('parses lengths', () => {
    expect(parseLength('1in', 'px')).toBe(96);
    expect(parseLength('25.4 mm', 'px')).toBeCloseTo(96);
    expect(parseLength('12', 'pt')).toBe(16);
    expect(parseLength('abc', 'px')).toBeNaN();
  });
});

/** CRITIQUE-3 N1: one formatter and one parser for every length readout. */
describe('formatLength / parseLength', () => {
  const A4 = { w: toPx(210, 'mm'), h: toPx(297, 'mm') };

  it('shows an A4 page in its own unit, not px', () => {
    expect(A4.w).toBeCloseTo(793.7, 1);
    expect(formatLength(A4.w, 'mm')).toBe('210 mm');
    expect(formatLength(A4.h, 'mm', { suffix: false })).toBe('297');
    expect(formatSize(A4.w, A4.h, 'mm')).toBe('210 × 297 mm');
    expect(formatSize(A4.w, A4.h, 'px')).toBe('793.7 × 1122.5 px');
    expect(formatSize(toPx(8.5, 'in'), toPx(11, 'in'), 'in')).toBe('8.5 × 11 in');
    expect(formatSize(A4.w, A4.h, 'pt', 0)).toBe('595 × 842 pt');
  });

  it('trims zeros, kills float noise and negative zero', () => {
    expect(formatLength(toPx(15, 'mm'), 'mm')).toBe('15 mm');
    expect(formatLength(toPx(12.7, 'mm'), 'mm')).toBe('12.7 mm');
    expect(formatLength(toPx(0.125, 'in'), 'in')).toBe('0.125 in');
    expect(formatLength(-0.00001, 'px')).toBe('0 px');
    expect(formatLength(NaN, 'mm')).toBe('');
    expect(lengthIn(toPx(3, 'mm'), 'mm')).toBe(3);
  });

  it('uses one precision table, so every readout of a length agrees', () => {
    for (const u of UNITS) expect(UNIT_DIGITS[u]).toBeGreaterThanOrEqual(1);
    // inspector and status bar both read 1122.5, never 1122.52 (P2-14)
    expect(formatLength(1122.52, 'px', { suffix: false })).toBe('1122.5');
  });

  it('parses what the user types in the field unit, with units and arithmetic', () => {
    expect(parseLength('15', 'mm')).toBeCloseTo(toPx(15, 'mm'));
    expect(parseLength('15mm', 'px')).toBeCloseTo(56.69, 2);
    expect(parseLength('1in', 'mm')).toBe(96);
    expect(parseLength('10+5', 'mm')).toBeCloseTo(toPx(15, 'mm'));
    expect(parseLength('1"', 'pt')).toBe(96);
    expect(parseLength('2,5 cm', 'mm')).toBeCloseTo(toPx(25, 'mm'));
    expect(parseLength('', 'mm')).toBeNaN();
    expect(parseLength('mm', 'mm')).toBeNaN();
  });

  it('round-trips format → parse in every unit', () => {
    for (const u of UNITS) {
      for (const px of [0, 1, 48, 56.69, 793.7, 1122.52, 3508]) {
        const back = parseLength(formatLength(px, u), u);
        // within half a display step of the original
        expect(Math.abs(back - px)).toBeLessThanOrEqual(toPx(0.5 * 10 ** -UNIT_DIGITS[u], u) + 1e-9);
      }
    }
  });

  it('reports output pixels at a dpi', () => {
    expect(pixelsAt(A4.w, 300)).toBe(2480);
    expect(pixelsAt(A4.h, 300)).toBe(3508);
  });
});
