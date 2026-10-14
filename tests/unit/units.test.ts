import { describe, expect, it } from 'vitest';
import { fromPx, parseLength, toPx } from '../../src/core/units';

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
