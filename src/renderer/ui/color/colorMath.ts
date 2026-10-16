/**
 * Colour model conversions for the colour picker. Pure, DOM-free (unit tested).
 * Conventions: r/g/b in 0..255 (floats allowed), hue in degrees 0..360,
 * every other channel (s, v, l, c, m, y, k, alpha) in 0..1.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface RGBA extends RGB {
  a: number;
}

export type ColorModel = 'hex' | 'rgb' | 'hsl' | 'cmyk';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const wrapHue = (h: number) => ((h % 360) + 360) % 360;

export function hsvToRgb(h: number, s: number, v: number): RGB {
  h = wrapHue(h);
  s = clamp01(s);
  v = clamp01(v);
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: f(5), g: f(3), b: f(1) };
}

/** Returns [h, s, v]. Hue is 0 for greys (callers keep their previous hue). */
export function rgbToHsv({ r, g, b }: RGB): [number, number, number] {
  r = clamp255(r) / 255;
  g = clamp255(g) / 255;
  b = clamp255(b) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  return [hueOf(r, g, b, max, d), max ? d / max : 0, max];
}

function hueOf(r: number, g: number, b: number, max: number, d: number): number {
  if (!d) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return wrapHue(h * 60);
}

/** Returns [h, s, l]. */
export function rgbToHsl({ r, g, b }: RGB): [number, number, number] {
  r = clamp255(r) / 255;
  g = clamp255(g) / 255;
  b = clamp255(b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [hueOf(r, g, b, max, d), clamp01(s), l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  h = wrapHue(h);
  s = clamp01(s);
  l = clamp01(l);
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/** Device CMYK (no ICC profile): a readable approximation for school print work. Returns [c, m, y, k]. */
export function rgbToCmyk({ r, g, b }: RGB): [number, number, number, number] {
  r = clamp255(r) / 255;
  g = clamp255(g) / 255;
  b = clamp255(b) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

export function cmykToRgb(c: number, m: number, y: number, k: number): RGB {
  const kk = 1 - clamp01(k);
  return { r: 255 * (1 - clamp01(c)) * kk, g: 255 * (1 - clamp01(m)) * kk, b: 255 * (1 - clamp01(y)) * kk };
}

/** "#abc", "abc", "#aabbcc", "aabbccdd" (with alpha). Returns null when the text is not a hex colour. */
export function parseHex(input: string): RGBA | null {
  const m = input.trim().replace(/^#/, '').match(/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
}

/** Lower-case "#rrggbb". */
export function toHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(clamp255(v)).toString(16).padStart(2, '0')).join('');
}

/** Parse the colour strings documents store: hex (3/4/6/8) and rgb()/rgba(). Falls back to opaque black. */
export function parseCss(color: string): RGBA {
  const hex = parseHex(color);
  if (hex && color.trim().startsWith('#')) return hex;
  const m = color.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map((x) => parseFloat(x));
    return { r: clamp255(p[0] || 0), g: clamp255(p[1] || 0), b: clamp255(p[2] || 0), a: p.length > 3 && Number.isFinite(p[3]) ? clamp01(p[3]) : 1 };
  }
  return hex ?? { r: 0, g: 0, b: 0, a: 1 };
}

/** Hex when opaque, rgba() otherwise (alpha rounded to 2 places), matching what the document already stores. */
export function toCss(c: RGB, a = 1): string {
  const hex = toHex(c);
  if (a >= 1) return hex;
  const n = parseHex(hex)!;
  return `rgba(${n.r},${n.g},${n.b},${Math.round(clamp01(a) * 100) / 100})`;
}

/** Same colour ignoring alpha (compares rounded channels). */
export function sameRgb(a: string, b: string): boolean {
  return toHex(parseCss(a)) === toHex(parseCss(b));
}

/** Most-recent-first list with case-insensitive de-duplication. */
export function pushRecent(list: readonly string[], color: string, max = 12): string[] {
  const key = color.trim().toLowerCase();
  if (!key) return [...list];
  return [key, ...list.filter((c) => c.toLowerCase() !== key)].slice(0, max);
}

/** Relative luminance (WCAG) 0..1, used to pick knob/ink contrast. */
export function luminance({ r, g, b }: RGB): number {
  const ch = (v: number) => {
    v = clamp255(v) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Tint for a layer thumbnail's type glyph (critique 3 P2-6): the object's fill,
 * unless it would vanish on the thumbnail tile (a white "Paper" rectangle on the
 * light theme's white tile), in which case null and the glyph falls back to text-3.
 */
export function thumbTint(fill: string | undefined, tile: string): string | null {
  if (!fill) return null;
  const f = parseCss(fill);
  if (f.a < 0.35) return null;
  return contrastRatio(f, parseCss(tile)) < 1.5 ? null : fill;
}

/** An ICC conversion for the picker's CMYK fields (the document's CMYK profile); RGB 0..255, CMYK 0..1. */
export interface CmykConverter {
  /** profile name for the tooltip */
  name: string;
  toCmyk: (c: RGB) => [number, number, number, number];
  toRgb: (c: number, m: number, y: number, k: number) => RGB;
}

let cmykConverter: (() => CmykConverter | null) | null = null;

/** Use ICC conversions for CMYK fields (the app installs this once the colour engine is ready). */
export function setCmykConverter(fn: (() => CmykConverter | null) | null): void {
  cmykConverter = fn;
}

/** The active CMYK conversion, or null for the device approximation. */
export function activeCmykConverter(): CmykConverter | null {
  return cmykConverter?.() ?? null;
}

/** Channel values shown in the picker for a model, rounded for display. */
export function channels(model: Exclude<ColorModel, 'hex'>, c: RGB): number[] {
  if (model === 'rgb') return [c.r, c.g, c.b].map((v) => Math.round(v));
  if (model === 'hsl') {
    const [h, s, l] = rgbToHsl(c);
    return [Math.round(h) % 360, Math.round(s * 100), Math.round(l * 100)];
  }
  const conv = activeCmykConverter();
  return (conv ? conv.toCmyk(c) : rgbToCmyk(c)).map((v) => Math.round(v * 100));
}

/** Inverse of channels(): rebuild RGB after one display channel was edited. */
export function fromChannels(model: Exclude<ColorModel, 'hex'>, v: number[]): RGB {
  if (model === 'rgb') return { r: clamp255(v[0]), g: clamp255(v[1]), b: clamp255(v[2]) };
  if (model === 'hsl') return hslToRgb(v[0], v[1] / 100, v[2] / 100);
  const conv = activeCmykConverter();
  return (conv ? conv.toRgb : cmykToRgb)(v[0] / 100, v[1] / 100, v[2] / 100, v[3] / 100);
}

export const MODEL_CHANNELS: Record<Exclude<ColorModel, 'hex'>, { key: string; label: string; max: number; unit: string }[]> = {
  rgb: [
    { key: 'r', label: 'R', max: 255, unit: '' },
    { key: 'g', label: 'G', max: 255, unit: '' },
    { key: 'b', label: 'B', max: 255, unit: '' },
  ],
  hsl: [
    { key: 'h', label: 'H', max: 359, unit: '°' },
    { key: 's', label: 'S', max: 100, unit: '%' },
    { key: 'l', label: 'L', max: 100, unit: '%' },
  ],
  cmyk: [
    { key: 'c', label: 'C', max: 100, unit: '%' },
    { key: 'm', label: 'M', max: 100, unit: '%' },
    { key: 'y', label: 'Y', max: 100, unit: '%' },
    { key: 'k', label: 'K', max: 100, unit: '%' },
  ],
};
