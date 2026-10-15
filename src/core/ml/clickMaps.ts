/**
 * Click-prompt encoding shared with the training code (ml/quvrelo_ml/data.py `click_map`).
 * value(x, y) = max_k exp(-d_k^2 / (2 sigma^2)),  sigma = CLICK_SIGMA_FRAC * max(H, W)
 * Any change here must be mirrored in Python and the model retrained.
 */
export const CLICK_SIGMA_FRAC = 0.02;

export interface SelectionClick {
  /** pixel coordinates in the image the click was made on */
  x: number;
  y: number;
  /** true = "include this", false = "exclude this" */
  positive: boolean;
}

/**
 * Gaussian click map at model resolution. Clicks are given in source-image pixels and are scaled
 * to the w x h grid (same squash-resize as the image). Pixel centres follow numpy's mgrid convention.
 */
export function encodeClicks(
  w: number,
  h: number,
  points: { x: number; y: number }[],
  srcW = w,
  srcH = h,
): Float32Array {
  const out = new Float32Array(w * h);
  if (!points.length) return out;
  const s = CLICK_SIGMA_FRAC * Math.max(w, h);
  const inv = 1 / (2 * s * s);
  const r = Math.ceil(s * 4); // exp(-8) ~ 3e-4: negligible beyond 4 sigma
  for (const p of points) {
    // map source pixel centre -> model grid (align_corners=False style)
    const cx = ((p.x + 0.5) * w) / srcW - 0.5;
    const cy = ((p.y + 0.5) * h) / srcH - 0.5;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const v = Math.exp(-(dx * dx + dy * dy) * inv);
        const i = y * w + x;
        if (v > out[i]) out[i] = v;
      }
    }
  }
  return out;
}
