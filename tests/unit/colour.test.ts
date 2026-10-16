import { describe, expect, it } from 'vitest';
import { deltaE } from '../../src/core/colour/cms';
import { applyLut, buildLut, lookup, lutGrid } from '../../src/core/colour/lut3d';
import { CMYK_PROFILES, colourSummary, DEFAULT_COLOUR, docColour, PROFILES, RGB_PROFILES } from '../../src/core/colour/profiles';
import { testEngine } from './colourTestEngine';

describe('colour profiles', () => {
  it('bundles sRGB, Adobe RGB, Display P3 and two CMYK presses with PDF/X conditions', async () => {
    const e = await testEngine();
    expect(RGB_PROFILES).toEqual(['srgb', 'adobe-rgb', 'display-p3']);
    expect(CMYK_PROFILES).toEqual(['fogra39', 'crpc6']);
    for (const id of CMYK_PROFILES) {
      const b = e.profileBytes(id);
      // ICC header: 'prtr' output class, 'CMYK' data space, version 2.x
      const ascii = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
      expect(ascii(12)).toBe('prtr');
      expect(ascii(16)).toBe('CMYK');
      expect(b[8]).toBe(2);
      expect(PROFILES[id].pdfx?.identifier).toMatch(/^(FOGRA39|CGATS21_CRPC6)$/);
    }
    for (const id of RGB_PROFILES) expect(String.fromCharCode(...e.profileBytes(id).subarray(16, 19))).toBe('RGB');
    expect(e.profileDescription('fogra39')).toContain('FOGRA39');
  });

  it('fills document colour defaults and summarises them', () => {
    expect(docColour(undefined)).toEqual(DEFAULT_COLOUR);
    expect(docColour({ colour: { mode: 'cmyk', rgbProfile: 'nope' as never, cmykProfile: 'crpc6', bitDepth: 16, intent: 'perceptual' } })).toEqual({ mode: 'cmyk', rgbProfile: 'srgb', cmykProfile: 'crpc6', bitDepth: 16, intent: 'perceptual' });
    expect(colourSummary(DEFAULT_COLOUR)).toBe('sRGB');
    expect(colourSummary({ ...DEFAULT_COLOUR, mode: 'cmyk' })).toBe('CMYK · FOGRA39');
    expect(colourSummary({ ...DEFAULT_COLOUR, rgbProfile: 'adobe-rgb', bitDepth: 16 })).toBe('Adobe RGB · 16-bit');
  });
});

describe('ICC conversions (lcms2)', () => {
  it('converts sRGB primaries to plausible FOGRA39 separations', async () => {
    const e = await testEngine();
    const red = e.rgbToCmyk([1, 0, 0], 'srgb', 'fogra39');
    expect(red[0]).toBeLessThan(0.05);
    expect(red[1]).toBeGreaterThan(0.85);
    expect(red[2]).toBeGreaterThan(0.85);
    const white = e.rgbToCmyk([1, 1, 1], 'srgb', 'fogra39');
    expect(Math.max(...white)).toBeLessThan(0.01);
    const black = e.rgbToCmyk([0, 0, 0], 'srgb', 'fogra39');
    expect(black[3]).toBeGreaterThan(0.85);
    // total ink stays under the 330% limit the profile was built with
    expect(black.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3.31);
  });

  it('round-trips in-gamut colours and flags out-of-gamut ones', async () => {
    const e = await testEngine();
    const mid: [number, number, number] = [0.55, 0.45, 0.4];
    const back = e.cmykToRgb(e.rgbToCmyk(mid, 'srgb', 'fogra39', { intent: 'relative', bpc: false }), 'fogra39', 'srgb');
    expect(deltaE(e.toLab(mid, 'srgb'), e.toLab(back, 'srgb'))).toBeLessThan(2);
    expect(e.outOfGamut(mid, 'srgb', 'fogra39')).toBe(false);
    expect(e.outOfGamut([0, 0, 1], 'srgb', 'fogra39')).toBe(true); // screen blue can't be printed
    expect(e.outOfGamut([0, 1, 0], 'srgb', 'crpc6')).toBe(true);
  });

  it('converts between RGB profiles: Adobe RGB green is outside sRGB', async () => {
    const e = await testEngine();
    const g = e.rgbToRgb([0, 1, 0], 'adobe-rgb', 'srgb', { intent: 'relative', bpc: false });
    expect(g[0]).toBe(0);
    expect(g[1]).toBeGreaterThan(0.95);
    const grey = e.rgbToRgb([0.5, 0.5, 0.5], 'display-p3', 'srgb');
    expect(Math.abs(grey[0] - 0.5)).toBeLessThan(0.01);
  });

  it('converts pixel buffers, 8 and 16 bit, and keeps the CMYK of white at zero', async () => {
    const e = await testEngine();
    const px = new Uint8Array([255, 255, 255, 255, 255, 0, 0, 128, 0, 0, 0, 0]);
    const cmyk = e.rgbaToCmyk(px, 3, 'srgb', 'fogra39');
    expect(Array.from(cmyk.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(cmyk[5]).toBeGreaterThan(220);
    const px16 = new Uint16Array([65535, 0, 0, 65535]);
    const c16 = e.rgba16ToCmyk(px16, 1, 'srgb', 'fogra39');
    expect(Math.abs(c16[1] - cmyk[5])).toBeLessThanOrEqual(2);
    const rgba = new Uint8ClampedArray([0, 255, 0, 255]);
    e.convertRgbaInPlace(rgba, 1, 'adobe-rgb', 'srgb');
    expect(rgba[0]).toBe(0);
    expect(rgba[3]).toBe(255);
  });

  it('builds proof and gamut LUTs the viewport can apply', async () => {
    const e = await testEngine();
    const lut = e.displayLut({ rgbProfile: 'srgb', cmykProfile: 'fogra39', proof: true, gamut: true, size: 17 });
    expect(lut.rgb.length).toBe(17 ** 3 * 3);
    const blue = lookup(lut, 0, 0, 255);
    expect(blue.outOfGamut).toBe(true);
    // printed blue is duller than screen blue
    expect(blue.rgb[2]).toBeLessThan(240);
    const skin = lookup(lut, 200, 160, 140);
    expect(skin.outOfGamut).toBe(false);
    expect(Math.abs(skin.rgb[0] - 200)).toBeLessThan(14);
    // plain sRGB without proofing is the identity
    const id = e.displayLut({ rgbProfile: 'srgb', cmykProfile: 'fogra39', proof: false, gamut: false, size: 9 });
    expect(lookup(id, 12, 130, 250).rgb).toEqual([12, 130, 250]);
  });
});

describe('3D LUT', () => {
  it('grid order and trilinear interpolation', () => {
    const g = lutGrid(2);
    expect(Array.from(g.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 1]);
    const inv = buildLut(5, (grid) => ({ rgb: Uint8Array.from(grid, (v) => Math.round((1 - v) * 255)) }));
    const px = new Uint8ClampedArray([0, 128, 255, 255, 10, 10, 10, 0]);
    applyLut(px, inv);
    expect(Array.from(px.subarray(0, 4))).toEqual([255, 127, 0, 255]);
    expect(Array.from(px.subarray(4))).toEqual([10, 10, 10, 0]); // transparent pixel untouched
  });

  it('paints flagged colours with the warning colour', () => {
    const id = buildLut(3, (grid) => ({ rgb: Uint8Array.from(grid, (v) => Math.round(v * 255)), flags: Uint8Array.from({ length: 27 }, (_, i) => (i === 26 ? 255 : 0)) }));
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    applyLut(px, id, { gamutColor: [128, 128, 128], gamutOpacity: 1 });
    expect(Array.from(px)).toEqual([128, 128, 128, 255, 0, 0, 0, 255]);
  });

  it('rejects a bad table', () => {
    expect(() => buildLut(1, () => ({ rgb: new Uint8Array(3) }))).toThrow();
    expect(() => buildLut(2, () => ({ rgb: new Uint8Array(3) }))).toThrow();
  });
});
