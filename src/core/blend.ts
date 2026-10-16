/**
 * Blend-mode maths (W3C Compositing and Blending Level 1, plus the Photoshop /
 * Affinity extras canvas 2D has no operator for). Pure, so the same formulas
 * drive the renderer's per-pixel compositor and the tests that check the
 * native canvas modes against the specification.
 *
 * Channel values are 0..1, colours are straight (not premultiplied) RGB.
 */
import type { BlendMode } from './types';
import { BLEND_MODES } from './types';

export type RGB = [number, number, number];

const NATIVE = new Set<BlendMode>(BLEND_MODES);

/** Canvas 2D (and SVG / PDF) composite this mode natively. */
export function isNativeBlend(mode: BlendMode): boolean {
  return NATIVE.has(mode);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function colorDodge(b: number, s: number): number {
  if (b === 0) return 0;
  if (s >= 1) return 1;
  return Math.min(1, b / (1 - s));
}

function colorBurn(b: number, s: number): number {
  if (b >= 1) return 1;
  if (s <= 0) return 0;
  return 1 - Math.min(1, (1 - b) / s);
}

function hardLight(b: number, s: number): number {
  return s <= 0.5 ? b * 2 * s : screen(b, 2 * s - 1);
}

function screen(b: number, s: number): number {
  return b + s - b * s;
}

function softLight(b: number, s: number): number {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

function vividLight(b: number, s: number): number {
  return s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5));
}

/** Separable blend function B(Cb, Cs) for one channel. */
export function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'normal': return s;
    case 'multiply': return b * s;
    case 'screen': return screen(b, s);
    case 'overlay': return hardLight(s, b);
    case 'darken': return Math.min(b, s);
    case 'lighten': return Math.max(b, s);
    case 'color-dodge': return colorDodge(b, s);
    case 'color-burn': return colorBurn(b, s);
    case 'hard-light': return hardLight(b, s);
    case 'soft-light': return softLight(b, s);
    case 'difference': return Math.abs(b - s);
    case 'exclusion': return b + s - 2 * b * s;
    case 'linear-burn': return Math.max(0, b + s - 1);
    case 'linear-dodge': return Math.min(1, b + s);
    case 'vivid-light': return vividLight(b, s);
    case 'linear-light': return clamp01(b + 2 * s - 1);
    case 'pin-light': return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case 'hard-mix': return b + s >= 1 ? 1 : 0;
    case 'subtract': return Math.max(0, b - s);
    case 'divide': return s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s);
    default: return s;
  }
}

// --- non-separable (W3C §10) -------------------------------------------------

function lum(c: RGB): number {
  return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
}

function clipColor(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out: RGB = [c[0], c[1], c[2]];
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as RGB;
  return out;
}

function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

function sat(c: RGB): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

function setSat(c: RGB, s: number): RGB {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [mn, md, mx] = idx;
  const out: RGB = [0, 0, 0];
  if (c[mx] > c[mn]) {
    out[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn]);
    out[mx] = s;
  } else {
    out[md] = 0;
    out[mx] = 0;
  }
  out[mn] = 0;
  return out;
}

/** B(Cb, Cs) for a whole colour (handles the non-separable modes). */
export function blendColor(mode: BlendMode, b: RGB, s: RGB): RGB {
  switch (mode) {
    case 'hue': return setLum(setSat(s, sat(b)), lum(b));
    case 'saturation': return setLum(setSat(b, sat(s)), lum(b));
    case 'color': return setLum(s, lum(b));
    case 'luminosity': return setLum(b, lum(s));
    default: return [blendChannel(mode, b[0], s[0]), blendChannel(mode, b[1], s[1]), blendChannel(mode, b[2], s[2])];
  }
}

/**
 * Composite one straight-alpha source pixel over a backdrop pixel (source-over
 * with blending, W3C §5.8). Values 0..1. Returns straight RGBA.
 */
export function compositePixel(mode: BlendMode, b: RGB, ab: number, s: RGB, as: number): [number, number, number, number] {
  const ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const mixed = blendColor(mode, b, s);
  const out: [number, number, number, number] = [0, 0, 0, ao];
  for (let i = 0; i < 3; i++) {
    const cs = (1 - ab) * s[i] + ab * clamp01(mixed[i]);
    out[i] = (as * cs + ab * b[i] * (1 - as)) / ao;
  }
  return out;
}

/**
 * Composite `src` over `dst` in place (both RGBA 0..255, same length) with a
 * blend mode, an extra opacity and an optional 0..255 coverage mask.
 */
export function compositeBuffers(dst: Uint8ClampedArray, src: Uint8ClampedArray, mode: BlendMode, opacity = 1, mask?: Uint8ClampedArray | Uint8Array, maskStride = 1, maskOffset = 0): void {
  const inv = 1 / 255;
  const b: RGB = [0, 0, 0];
  const s: RGB = [0, 0, 0];
  for (let i = 0, p = 0; i < dst.length; i += 4, p++) {
    let as = src[i + 3] * inv * opacity;
    if (mask) as *= mask[p * maskStride + maskOffset] * inv;
    if (as <= 0) continue;
    const ab = dst[i + 3] * inv;
    b[0] = dst[i] * inv; b[1] = dst[i + 1] * inv; b[2] = dst[i + 2] * inv;
    s[0] = src[i] * inv; s[1] = src[i + 1] * inv; s[2] = src[i + 2] * inv;
    const o = compositePixel(mode, b, ab, s, as);
    dst[i] = o[0] * 255;
    dst[i + 1] = o[1] * 255;
    dst[i + 2] = o[2] * 255;
    dst[i + 3] = o[3] * 255;
  }
}

/** Human labels for the Blend menu (sentence case, British spelling like the rest of the UI). */
export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten',
  'color-dodge': 'Colour dodge', 'color-burn': 'Colour burn', 'hard-light': 'Hard light', 'soft-light': 'Soft light',
  difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Colour', luminosity: 'Luminosity',
  'linear-burn': 'Linear burn', 'linear-dodge': 'Add (linear dodge)', 'vivid-light': 'Vivid light', 'linear-light': 'Linear light',
  'pin-light': 'Pin light', 'hard-mix': 'Hard mix', subtract: 'Subtract', divide: 'Divide',
};
