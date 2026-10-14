import { describe, expect, it } from 'vitest';
import { clamp, evalArithmetic, formatNumber, fraction, parseNumericInput, roundTo, scrubValue, stepDigits, stepMultiplier, stepValue } from '../../src/renderer/ui/controls/numeric';

describe('numeric field logic', () => {
  it('rounds without float noise or negative zero', () => {
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(-0.0001, 2)).toBe(0);
    expect(Object.is(roundTo(-0.0001, 2), -0)).toBe(false);
    expect(formatNumber(12.5000001, 2)).toBe('12.5');
    expect(formatNumber(NaN)).toBe('');
  });
  it('steps with arrow keys, shift ×10, alt ×0.1, clamped', () => {
    expect(stepMultiplier({})).toBe(1);
    expect(stepMultiplier({ shiftKey: true })).toBe(10);
    expect(stepMultiplier({ altKey: true })).toBe(0.1);
    expect(stepValue(10, 1, 1)).toBe(11);
    expect(stepValue(10, -1, 1, { shiftKey: true })).toBe(0);
    expect(stepValue(0.3, 1, 0.1)).toBe(0.4);
    expect(stepValue(1, 1, 1, { altKey: true })).toBe(1.1);
    expect(stepValue(98, 1, 1, { shiftKey: true }, 0, 100)).toBe(100);
    expect(stepValue(2, -1, 1, { shiftKey: true }, 0, 100)).toBe(0);
  });
  it('knows the decimals a step implies', () => {
    expect(stepDigits(1)).toBe(0);
    expect(stepDigits(0.25)).toBe(2);
    expect(stepDigits(1e-7)).toBe(7);
  });
  it('scrubs one step per pixel, scaled by modifiers and clamped', () => {
    expect(scrubValue(50, 12, 1)).toBe(62);
    expect(scrubValue(50, -12, 1)).toBe(38);
    expect(scrubValue(50, 3, 1, { shiftKey: true })).toBe(80);
    expect(scrubValue(1, 5, 1, { altKey: true })).toBe(1.5);
    expect(scrubValue(50, 500, 1, {}, 0, 100)).toBe(100);
    expect(scrubValue(0, 9, 1, {}, undefined, undefined, 4)).toBe(2);
    expect(scrubValue(0.5, 3, 0.01)).toBe(0.53);
  });
  it('evaluates arithmetic safely', () => {
    expect(evalArithmetic('100+20')).toBe(120);
    expect(evalArithmetic('50*2-1')).toBe(99);
    expect(evalArithmetic('(3+1)/2')).toBe(2);
    expect(evalArithmetic('-4*-2')).toBe(8);
    expect(evalArithmetic('(3+1')).toBeNaN();
    expect(evalArithmetic('2**')).toBeNaN();
  });
  it('parses typed values, suffixes and units', () => {
    expect(parseNumericInput('42')).toBe(42);
    expect(parseNumericInput(' -3.5 ')).toBe(-3.5);
    expect(parseNumericInput('1,5')).toBe(1.5);
    expect(parseNumericInput('45°')).toBe(45);
    expect(parseNumericInput('80 %')).toBe(80);
    expect(parseNumericInput('100+20')).toBe(120);
    expect(parseNumericInput('12px', 'px')).toBe(12);
    expect(parseNumericInput('1in', 'px')).toBe(96);
    expect(parseNumericInput('25.4mm', 'in')).toBeCloseTo(1);
    expect(parseNumericInput('72pt', 'in')).toBeCloseTo(1);
    expect(parseNumericInput('1"', 'mm')).toBeCloseTo(25.4);
    expect(parseNumericInput('abc')).toBeNaN();
    expect(parseNumericInput('')).toBeNaN();
    expect(parseNumericInput('alert(1)')).toBeNaN();
  });
  it('clamps and maps fractions for slider fills', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(fraction(25, 0, 100)).toBe(0.25);
    expect(fraction(-50, -100, 100)).toBe(0.25);
    expect(fraction(5, 5, 5)).toBe(0);
    expect(fraction(200, 0, 100)).toBe(1);
  });
});
