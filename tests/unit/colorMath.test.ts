import { describe, expect, it } from 'vitest';
import { channels, cmykToRgb, fromChannels, hslToRgb, hsvToRgb, luminance, parseCss, parseHex, pushRecent, rgbToCmyk, rgbToHsl, rgbToHsv, sameRgb, toCss, toHex } from '../../src/renderer/ui/color/colorMath';

const near = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => {
  expect(a.r).toBeCloseTo(b.r, 0);
  expect(a.g).toBeCloseTo(b.g, 0);
  expect(a.b).toBeCloseTo(b.b, 0);
};

describe('colour conversions', () => {
  it('HSV <-> RGB', () => {
    near(hsvToRgb(0, 1, 1), { r: 255, g: 0, b: 0 });
    near(hsvToRgb(120, 1, 1), { r: 0, g: 255, b: 0 });
    near(hsvToRgb(240, 0.5, 0.5), { r: 63.75, g: 63.75, b: 127.5 });
    near(hsvToRgb(360, 1, 1), { r: 255, g: 0, b: 0 });
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual([0, 1, 1]);
    const [h, s, v] = rgbToHsv({ r: 60, g: 196, b: 176 });
    expect(h).toBeCloseTo(171.2, 1);
    near(hsvToRgb(h, s, v), { r: 60, g: 196, b: 176 });
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual([0, 0, 0]);
  });
  it('HSL <-> RGB round-trips', () => {
    near(hslToRgb(0, 0, 0.5), { r: 127.5, g: 127.5, b: 127.5 });
    near(hslToRgb(210, 1, 0.5), { r: 0, g: 127.5, b: 255 });
    for (const c of [{ r: 12, g: 200, b: 99 }, { r: 255, g: 255, b: 255 }, { r: 1, g: 2, b: 3 }, { r: 240, g: 10, b: 200 }]) {
      const [h, s, l] = rgbToHsl(c);
      near(hslToRgb(h, s, l), c);
    }
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual([0, 0, 1]);
  });
  it('CMYK <-> RGB (device)', () => {
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual([0, 0, 0, 1]);
    expect(rgbToCmyk({ r: 255, g: 255, b: 255 })).toEqual([0, 0, 0, 0]);
    expect(rgbToCmyk({ r: 255, g: 0, b: 0 })).toEqual([0, 1, 1, 0]);
    near(cmykToRgb(0, 1, 1, 0), { r: 255, g: 0, b: 0 });
    for (const c of [{ r: 60, g: 196, b: 176 }, { r: 10, g: 20, b: 30 }]) {
      const [cc, m, y, k] = rgbToCmyk(c);
      near(cmykToRgb(cc, m, y, k), c);
    }
  });
  it('parses and formats hex', () => {
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseHex('3cc4b0')).toEqual({ r: 60, g: 196, b: 176, a: 1 });
    expect(parseHex(' #3CC4B080 ')!.a).toBeCloseTo(0.5, 2);
    expect(parseHex('#12')).toBeNull();
    expect(parseHex('#ggg')).toBeNull();
    expect(toHex({ r: 60.4, g: 196, b: 300 })).toBe('#3cc4ff');
  });
  it('parses the CSS strings documents store', () => {
    expect(parseCss('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCss('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCss('rgb(10 20 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseCss('nonsense')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(toCss({ r: 255, g: 0, b: 0 })).toBe('#ff0000');
    expect(toCss({ r: 255, g: 0, b: 0 }, 0.456)).toBe('rgba(255,0,0,0.46)');
    expect(sameRgb('#FF0000', 'rgba(255,0,0,0.2)')).toBe(true);
  });
  it('maps display channels both ways', () => {
    const c = { r: 60, g: 196, b: 176 };
    expect(channels('rgb', c)).toEqual([60, 196, 176]);
    expect(channels('hsl', c)).toEqual([171, 54, 50]);
    expect(channels('cmyk', c)).toEqual([69, 0, 10, 23]);
    near(fromChannels('rgb', [60, 196, 176]), c);
    near(fromChannels('hsl', [0, 100, 50]), { r: 255, g: 0, b: 0 });
    near(fromChannels('cmyk', [0, 0, 0, 100]), { r: 0, g: 0, b: 0 });
  });
  it('keeps a de-duplicated most-recent-first list', () => {
    expect(pushRecent(['#aaaaaa', '#bbbbbb'], '#BBBBBB')).toEqual(['#bbbbbb', '#aaaaaa']);
    expect(pushRecent(['#1', '#2', '#3'], '#4', 3)).toEqual(['#4', '#1', '#2']);
    expect(pushRecent(['#1'], '  ')).toEqual(['#1']);
  });
  it('computes luminance', () => {
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1);
    expect(luminance({ r: 0, g: 0, b: 0 })).toBe(0);
  });
});

describe('layer thumbnail tint (critique 3 P2-6)', () => {
  it('falls back to text-3 when the fill would vanish on the tile', async () => {
    const { thumbTint, contrastRatio, parseCss } = await import('../../src/renderer/ui/color/colorMath');
    expect(contrastRatio(parseCss('#ffffff'), parseCss('#000000'))).toBeCloseTo(21, 0);
    expect(thumbTint('#ffffff', '#ffffff')).toBeNull(); // white Paper on the light theme's white tile
    expect(thumbTint('#f4f1ea', '#ffffff')).toBeNull();
    expect(thumbTint('#ffffff', '#1e1f21')).toBe('#ffffff');
    expect(thumbTint('#3a86ff', '#ffffff')).toBe('#3a86ff');
    expect(thumbTint('#1e1f21', '#1e1f21')).toBeNull();
    expect(thumbTint('rgba(255,0,0,0.1)', '#1e1f21')).toBeNull();
    expect(thumbTint(undefined, '#1e1f21')).toBeNull();
  });
});
