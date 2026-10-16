import { describe, expect, it } from 'vitest';
import { blendColour, Compositor16 } from '../../src/core/composite16';
import { createPixels16, distinctLevels } from '../../src/core/pixels16';
import { BLEND_MODES } from '../../src/core/types';

describe('16-bit compositor', () => {
  it('draws a 16-bit image at identity without losing a level', () => {
    const img = createPixels16(1000, 1);
    for (let x = 0; x < 1000; x++) img.data.set([20000 + x, 20000 + x, 20000 + x, 65535], x * 4);
    const c = new Compositor16(1000, 1);
    c.drawImage16(img, [1, 0, 0, 1, 0, 0], 1, 'normal');
    const out = c.toPixels16();
    expect(distinctLevels(out)).toBe(1000);
    for (let x = 0; x < 1000; x++) expect(Math.abs(out.data[x * 4] - (20000 + x))).toBeLessThanOrEqual(1);
  });

  it('applies transforms (2x scale + offset) and opacity', () => {
    const img = createPixels16(2, 2, [65535, 0, 0, 65535]);
    const c = new Compositor16(10, 10);
    c.fill(0, 0, 1, 1);
    c.drawImage16(img, [2, 0, 0, 2, 3, 3], 0.5, 'normal');
    const out = c.toPixels16();
    const at = (x: number, y: number) => Array.from(out.data.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4));
    expect(at(4, 4)[0]).toBeGreaterThan(32000);
    expect(at(4, 4)[2]).toBeGreaterThan(32000);
    expect(at(0, 0)).toEqual([0, 0, 65535, 65535]);
  });

  it('separable and non-separable blend modes follow the W3C formulas', () => {
    expect(blendColour('multiply', [0.5, 0.5, 0.5], [0.5, 1, 0])).toEqual([0.25, 0.5, 0]);
    expect(blendColour('screen', [0.5, 0.5, 0.5], [0.5, 1, 0])).toEqual([0.75, 1, 0.5]);
    expect(blendColour('difference', [0.2, 0.8, 0.5], [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.3);
    // luminosity: keeps the backdrop's hue, takes the source's luma
    const l = blendColour('luminosity', [1, 0, 0], [0.5, 0.5, 0.5]);
    expect(0.3 * l[0] + 0.59 * l[1] + 0.11 * l[2]).toBeCloseTo(0.5, 5);
    for (const m of BLEND_MODES) {
      const r = blendColour(m, [0.3, 0.6, 0.9], [0.7, 0.2, 0.4]);
      for (const v of r) {
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('blends an 8-bit layer over the 16-bit backdrop with coverage', () => {
    const c = new Compositor16(2, 1);
    c.fill(0.5, 0.5, 0.5, 1);
    c.drawRgba8(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]), 'multiply', new Float32Array([1, 0]));
    const out = c.toPixels16();
    expect(Math.abs(out.data[0] - 32768)).toBeLessThan(2);
    expect(Math.abs(out.data[4] - 32768)).toBeLessThan(2);
    c.drawRgba8(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]), 'normal', new Float32Array([1, 0.5]));
    const o2 = c.toPixels16();
    expect(o2.data[0]).toBe(0);
    expect(Math.abs(o2.data[4] - 16384)).toBeLessThan(2);
  });

  it('transparent export keeps alpha', () => {
    const c = new Compositor16(1, 1);
    c.drawImage16(createPixels16(1, 1, [65535, 0, 0, 65535]), [1, 0, 0, 1, 0, 0], 0.25, 'normal');
    const out = c.toPixels16();
    expect(Math.abs(out.data[3] - 16384)).toBeLessThan(2);
    expect(out.data[0]).toBe(65535);
  });
});
