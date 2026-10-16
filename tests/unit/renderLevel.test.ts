import { describe, expect, it } from 'vitest';
import { renderLevel } from '../../src/renderer/engine/assets';

describe('renderLevel (adjustment render size for the view)', () => {
  it('is full size from 75 % of the source pixels up, and for nonsense input', () => {
    for (const n of [0.75, 1, 2, 8]) expect(renderLevel(n)).toBe(1);
    for (const n of [0, -1, NaN]) expect(renderLevel(n)).toBe(1);
  });
  it('rounds up to the next power-of-two fraction so the shown image is never upscaled', () => {
    expect(renderLevel(0.5)).toBe(0.5);
    expect(renderLevel(0.51)).toBe(1);
    expect(renderLevel(0.2)).toBe(0.25);
    expect(renderLevel(0.13)).toBe(0.25);
    expect(renderLevel(0.1)).toBe(0.125);
  });
  it('never goes below 1/64', () => {
    expect(renderLevel(0.0001)).toBe(1 / 64);
  });
});
