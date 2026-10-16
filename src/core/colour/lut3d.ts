/**
 * 3D colour lookup tables for the viewport (soft proof, gamut warning, and
 * showing Adobe RGB / P3 documents correctly on an sRGB screen).
 *
 * The colour engine evaluates the real ICC transform once on a size³ grid; the
 * viewport then maps every screen pixel through the grid with trilinear
 * interpolation, which keeps panning and zooming smooth (lcms per frame would
 * not). Pure: no DOM, no wasm.
 */

export interface Lut3D {
  size: number;
  /** size³ RGB triplets, index ((r * size) + g) * size + b */
  rgb: Uint8Array;
  /** optional per-node flag (255 = out of gamut) */
  flags?: Uint8Array;
}

/** Grid coordinates in 0..1 for every node, in LUT order (r slowest, b fastest). */
export function lutGrid(size: number): Float64Array {
  const g = new Float64Array(size * size * size * 3);
  let k = 0;
  for (let r = 0; r < size; r++) {
    for (let gg = 0; gg < size; gg++) {
      for (let b = 0; b < size; b++) {
        g[k++] = r / (size - 1);
        g[k++] = gg / (size - 1);
        g[k++] = b / (size - 1);
      }
    }
  }
  return g;
}

export function buildLut(size: number, evaluate: (grid: Float64Array) => { rgb: Uint8Array; flags?: Uint8Array }): Lut3D {
  if (size < 2) throw new Error('LUT size must be at least 2');
  const { rgb, flags } = evaluate(lutGrid(size));
  if (rgb.length !== size * size * size * 3) throw new Error('LUT has the wrong number of entries');
  return { size, rgb, flags };
}

export interface ApplyLutOptions {
  /** paint out-of-gamut pixels with this colour (the gamut warning) */
  gamutColor?: [number, number, number];
  /** how strongly the warning colour covers the pixel, 0..1 */
  gamutOpacity?: number;
}

/**
 * Map RGBA pixels (straight alpha, as getImageData returns them) through the
 * LUT in place. Fully transparent pixels are skipped.
 */
export function applyLut(px: Uint8ClampedArray | Uint8Array, lut: Lut3D, o: ApplyLutOptions = {}): void {
  const { size, rgb, flags } = lut;
  const s1 = size - 1;
  const k = s1 / 255;
  const ss = size * size;
  const warn = flags && o.gamutColor ? o.gamutColor : null;
  const wa = o.gamutOpacity ?? 0.85;
  // one-entry cache: flat areas (most of a page) cost a single lookup
  let lastKey = -1;
  let lr = 0, lg = 0, lb = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const key = (r << 16) | (g << 8) | b;
    if (key === lastKey) {
      px[i] = lr; px[i + 1] = lg; px[i + 2] = lb;
      continue;
    }
    const fr = r * k, fg = g * k, fb = b * k;
    const r0 = Math.min(s1 - 1, fr | 0), g0 = Math.min(s1 - 1, fg | 0), b0 = Math.min(s1 - 1, fb | 0);
    const dr = fr - r0, dg = fg - g0, db = fb - b0;
    const n000 = (r0 * ss + g0 * size + b0) * 3;
    const n001 = n000 + 3;
    const n010 = n000 + size * 3;
    const n011 = n010 + 3;
    const n100 = n000 + ss * 3;
    const n101 = n100 + 3;
    const n110 = n100 + size * 3;
    const n111 = n110 + 3;
    const w000 = (1 - dr) * (1 - dg) * (1 - db), w001 = (1 - dr) * (1 - dg) * db;
    const w010 = (1 - dr) * dg * (1 - db), w011 = (1 - dr) * dg * db;
    const w100 = dr * (1 - dg) * (1 - db), w101 = dr * (1 - dg) * db;
    const w110 = dr * dg * (1 - db), w111 = dr * dg * db;
    let out0 = 0, out1 = 0, out2 = 0;
    for (let c = 0; c < 3; c++) {
      const v = rgb[n000 + c] * w000 + rgb[n001 + c] * w001 + rgb[n010 + c] * w010 + rgb[n011 + c] * w011
        + rgb[n100 + c] * w100 + rgb[n101 + c] * w101 + rgb[n110 + c] * w110 + rgb[n111 + c] * w111;
      if (c === 0) out0 = v; else if (c === 1) out1 = v; else out2 = v;
    }
    if (warn) {
      const f = flags![n000 / 3] * w000 + flags![n001 / 3] * w001 + flags![n010 / 3] * w010 + flags![n011 / 3] * w011
        + flags![n100 / 3] * w100 + flags![n101 / 3] * w101 + flags![n110 / 3] * w110 + flags![n111 / 3] * w111;
      if (f >= 128) {
        out0 = out0 * (1 - wa) + warn[0] * wa;
        out1 = out1 * (1 - wa) + warn[1] * wa;
        out2 = out2 * (1 - wa) + warn[2] * wa;
      }
    }
    lastKey = key;
    lr = px[i] = Math.round(out0);
    lg = px[i + 1] = Math.round(out1);
    lb = px[i + 2] = Math.round(out2);
  }
}

/** Look up one colour (0..255) through the LUT. */
export function lookup(lut: Lut3D, r: number, g: number, b: number): { rgb: [number, number, number]; outOfGamut: boolean } {
  const px = new Uint8ClampedArray([r, g, b, 255]);
  applyLut(px, lut);
  let outOfGamut = false;
  if (lut.flags) {
    const flagPx = new Uint8ClampedArray([r, g, b, 255]);
    applyLut(flagPx, { ...lut, rgb: new Uint8Array(lut.rgb.length) }, { gamutColor: [255, 255, 255], gamutOpacity: 1 });
    outOfGamut = flagPx[0] === 255;
  }
  return { rgb: [px[0], px[1], px[2]], outOfGamut };
}
