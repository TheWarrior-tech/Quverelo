/**
 * Device-pixel snapping for 2D-canvas chrome (rulers, plot grids, selection and hover
 * outlines, handles, page guides) drawn in CSS px under a `dpr` transform.
 *
 * A 1 CSS px line at 150 % is 1.5 device px, so it always lands on one full and one half
 * pixel and reads as a blurred 2px grey line, whatever the position. Chromium draws a 1px
 * CSS border as floor(dpr) device px, so canvas hairlines do the same: 1 device px at
 * 100–175 %, 2 at 200 %, centred on a whole device pixel (odd widths) or a pixel edge
 * (even widths). At 100 % every helper returns what `Math.round(v) + 0.5` / `lineWidth = 1`
 * always gave, so 1x rendering is unchanged.
 */
export interface Hairline {
  dpr: number;
  /** device px of a hairline (floor(dpr), at least 1) */
  device: number;
  /** lineWidth, in CSS px, of a hairline */
  width: number;
  /** CSS coordinate of the centre of a crisp hairline nearest `v` */
  line(v: number): number;
  /** CSS coordinate snapped to a device-pixel edge (fill rects) */
  edge(v: number): number;
  /** CSS length rounded to whole device pixels (at least one) */
  size(v: number): number;
  /**
   * lineWidth for a thicker stroke centred on a `line()` coordinate: whole device pixels with
   * the hairline's parity, so both edges of the stroke land on pixel edges.
   */
  stroke(v: number): number;
}

export function hairline(dpr: number = (typeof window !== 'undefined' && window.devicePixelRatio) || 1): Hairline {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const device = Math.max(1, Math.floor(d + 1e-6));
  const half = device % 2 ? 0.5 : 0;
  return {
    dpr: d,
    device,
    width: device / d,
    line: (v) => (Math.round(v * d) + half) / d,
    edge: (v) => Math.round(v * d) / d,
    size: (v) => Math.max(1, Math.round(v * d)) / d,
    stroke: (v) => {
      let n = Math.max(device, Math.round(v * d));
      if ((n - device) % 2) n += 1;
      return n / d;
    },
  };
}

/**
 * The same snapping for lines drawn in scene units under the viewport transform
 * (`scale` = zoom, `offset` = translate in CSS px): returns a scene coordinate whose
 * screen position is a crisp hairline centre.
 */
export function sceneLine(h: Hairline, pos: number, scale: number, offset: number): number {
  return (h.line(pos * scale + offset) - offset) / scale;
}
