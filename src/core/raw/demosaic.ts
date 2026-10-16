/**
 * Demosaicing of a colour filter array (CFA) mosaic to RGB.
 *
 *  - Bayer (any 2×2 arrangement of R, G, G, B): Malvar–He–Cutler
 *    gradient-corrected linear interpolation (ICASSP 2004). It is bilinear
 *    plus a Laplacian correction from the pixel's own channel, which removes
 *    most of bilinear's zipper and colour fringing at about the same cost. The
 *    paper's eight 5×5 kernels are used as published.
 *  - Any other repeating pattern (for example Fujifilm X-Trans 6×6): a generic
 *    neighbourhood average of each missing colour over 3×3, widening to 5×5.
 *
 * Input values are linear and already white-balanced (0..1). Pure; unit-tested
 * in tests/unit/raw.test.ts.
 */

/** Colour (0 = R, 1 = G, 2 = B) at mosaic pixel (x, y). */
export type CfaColour = (x: number, y: number) => number;

export interface CfaPattern {
  /** repeat size (rows, cols) */
  rows: number;
  cols: number;
  /** colour per cell, row-major (0 R, 1 G, 2 B) */
  cells: number[];
}

export function cfaColourFn(p: CfaPattern, offX = 0, offY = 0): CfaColour {
  return (x, y) => p.cells[((y + offY) % p.rows) * p.cols + ((x + offX) % p.cols)];
}

export function isBayer(p: CfaPattern): boolean {
  if (p.rows !== 2 || p.cols !== 2) return false;
  const s = [...p.cells].sort().join('');
  return s === '0112';
}

/** Mirror-pad by 2 pixels; mirroring about the edge pixel keeps the 2×2 CFA phase. */
function pad2(src: Float32Array, w: number, h: number): Float32Array {
  const pw = w + 4;
  const out = new Float32Array(pw * (h + 4));
  const rx = (x: number) => (x < 0 ? -x : x >= w ? 2 * (w - 1) - x : x);
  for (let y = -2; y < h + 2; y++) {
    const sy = y < 0 ? -y : y >= h ? 2 * (h - 1) - y : y;
    const row = (y + 2) * pw;
    const srow = Math.max(0, Math.min(h - 1, sy)) * w;
    for (let x = -2; x < w + 2; x++) out[row + x + 2] = src[srow + Math.max(0, Math.min(w - 1, rx(x)))];
  }
  return out;
}

/**
 * Malvar–He–Cutler on a Bayer mosaic. `emit(i, r, g, b)` receives every
 * pixel (index y*w+x) so the caller can colour-convert straight into its own
 * output without a full float RGB buffer.
 */
export function demosaicMalvar(mosaic: Float32Array, w: number, h: number, colour: CfaColour, emit: (i: number, r: number, g: number, b: number) => void): void {
  const P = pad2(mosaic, w, h);
  const pw = w + 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = colour(x, y);
      const o = (y + 2) * pw + x + 2;
      const v = P[o];
      const n1 = P[o - pw], s1 = P[o + pw], w1 = P[o - 1], e1 = P[o + 1];
      const n2 = P[o - 2 * pw], s2 = P[o + 2 * pw], w2 = P[o - 2], e2 = P[o + 2];
      const nw = P[o - pw - 1], ne = P[o - pw + 1], sw = P[o + pw - 1], se = P[o + pw + 1];
      let r: number, g: number, b: number;
      if (c === 1) {
        // green pixel: which of R/B is in this row?
        const rowHasRed = colour(x + 1 >= w ? x - 1 : x + 1, y) === 0;
        // value of the colour horizontally adjacent (row colour)
        const horiz = (5 * v + 4 * (w1 + e1) + 0.5 * (n2 + s2) - (nw + ne + sw + se) - (w2 + e2)) / 8;
        const vert = (5 * v + 4 * (n1 + s1) + 0.5 * (w2 + e2) - (nw + ne + sw + se) - (n2 + s2)) / 8;
        g = v;
        if (rowHasRed) { r = horiz; b = vert; } else { b = horiz; r = vert; }
      } else {
        // red or blue pixel: green from the cross, the other colour from the diagonals
        g = (4 * v + 2 * (n1 + s1 + w1 + e1) - (n2 + s2 + w2 + e2)) / 8;
        const other = (6 * v + 2 * (nw + ne + sw + se) - 1.5 * (n2 + s2 + w2 + e2)) / 8;
        if (c === 0) { r = v; b = other; } else { b = v; r = other; }
      }
      emit(y * w + x, r, g, b);
    }
  }
}

/** Generic CFA: average each missing colour over the 3×3 (else 5×5) neighbourhood. */
export function demosaicGeneric(mosaic: Float32Array, w: number, h: number, colour: CfaColour, emit: (i: number, r: number, g: number, b: number) => void): void {
  const sum = [0, 0, 0];
  const cnt = [0, 0, 0];
  const rgb = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const own = colour(x, y);
      for (let radius = 1; radius <= 2; radius++) {
        sum[0] = sum[1] = sum[2] = 0;
        cnt[0] = cnt[1] = cnt[2] = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const c = colour(xx, yy);
            sum[c] += mosaic[yy * w + xx];
            cnt[c]++;
          }
        }
        if (cnt[0] && cnt[1] && cnt[2]) break;
      }
      for (let c = 0; c < 3; c++) rgb[c] = c === own ? mosaic[y * w + x] : cnt[c] ? sum[c] / cnt[c] : 0;
      emit(y * w + x, rgb[0], rgb[1], rgb[2]);
    }
  }
}
