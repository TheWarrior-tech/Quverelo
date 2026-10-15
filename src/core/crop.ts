/**
 * Crop box geometry (pure, no DOM): ratio presets, handle hit-testing,
 * resizing with an optional locked aspect ratio, and clamping to the canvas.
 * Used by the Crop tool (engine/tools.ts) and the crop context bar.
 */

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type CropHit = CropHandle | 'move';

export type CropRatioId = 'free' | 'original' | '1:1' | '4:5' | '3:2' | '4:3' | '16:9' | 'a4';
export type CropOverlay = 'thirds' | 'grid' | 'none';

export const CROP_RATIOS: { id: CropRatioId; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1 Square' },
  { id: '4:5', label: '4:5' },
  { id: '3:2', label: '3:2' },
  { id: '4:3', label: '4:3' },
  { id: '16:9', label: '16:9' },
  { id: 'a4', label: 'A4' },
];

export const CROP_HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Smallest crop side in document px. */
export const MIN_CROP = 4;

/**
 * Width / height for a preset, or null when free. Presets are landscape by
 * default (long side first); `portrait` flips them. 'original' follows the
 * document's own orientation, so `portrait` flips it relative to that.
 */
export function ratioValue(id: CropRatioId, docW: number, docH: number, portrait = false): number | null {
  let r: number;
  switch (id) {
    case 'free':
      return null;
    case 'original':
      r = docW / docH;
      return portrait ? 1 / r : r;
    case '1:1':
      return 1;
    case '4:5':
      r = 5 / 4;
      break;
    case '3:2':
      r = 3 / 2;
      break;
    case '4:3':
      r = 4 / 3;
      break;
    case '16:9':
      r = 16 / 9;
      break;
    case 'a4':
      r = 297 / 210;
      break;
    default:
      return null;
  }
  return portrait ? 1 / r : r;
}

/** Handle positions (document units). */
export function handlePoints(r: CropRect): Record<CropHandle, { x: number; y: number }> {
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return {
    nw: { x: x0, y: y0 }, n: { x: cx, y: y0 }, ne: { x: x1, y: y0 }, e: { x: x1, y: cy },
    se: { x: x1, y: y1 }, s: { x: cx, y: y1 }, sw: { x: x0, y: y1 }, w: { x: x0, y: cy },
  };
}

/**
 * What a pointer at p grabs: a handle (within `tol` document units, corners
 * win over edges), the box interior ('move'), or nothing. Edges also grab
 * along their whole length, not just at the midpoint handle.
 */
export function hitCrop(r: CropRect, p: { x: number; y: number }, tol: number): CropHit | null {
  const pts = handlePoints(r);
  for (const h of ['nw', 'ne', 'se', 'sw'] as CropHandle[]) {
    if (Math.abs(p.x - pts[h].x) <= tol && Math.abs(p.y - pts[h].y) <= tol) return h;
  }
  const inY = p.y >= r.y - tol && p.y <= r.y + r.h + tol;
  const inX = p.x >= r.x - tol && p.x <= r.x + r.w + tol;
  if (inX && Math.abs(p.y - r.y) <= tol) return 'n';
  if (inX && Math.abs(p.y - (r.y + r.h)) <= tol) return 's';
  if (inY && Math.abs(p.x - r.x) <= tol) return 'w';
  if (inY && Math.abs(p.x - (r.x + r.w)) <= tol) return 'e';
  if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return 'move';
  return null;
}

export function cursorFor(h: CropHit | null): string {
  switch (h) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'move': return 'move';
    default: return 'crosshair';
  }
}

/** Keep the box inside the bounds by moving it (size is kept when it fits). */
export function moveWithin(r: CropRect, bounds: CropRect): CropRect {
  const w = Math.min(r.w, bounds.w);
  const h = Math.min(r.h, bounds.h);
  const x = Math.min(Math.max(r.x, bounds.x), bounds.x + bounds.w - w);
  const y = Math.min(Math.max(r.y, bounds.y), bounds.y + bounds.h - h);
  return { x, y, w, h };
}

/**
 * Resize from `start` by dragging handle `h` by (dx, dy). The opposite corner
 * (or edge) stays put. With a ratio, corner drags follow the dominant axis and
 * edge drags grow the other side symmetrically about the box centre. The
 * result is kept within `bounds` (shrinking about the anchor when needed) and
 * never smaller than MIN_CROP.
 */
export function resizeCrop(start: CropRect, h: CropHandle, dx: number, dy: number, ratio: number | null, bounds: CropRect | null): CropRect {
  const west = h.includes('w');
  const east = h.includes('e');
  const north = h.startsWith('n');
  const south = h.startsWith('s');
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  if (west) x0 += dx;
  if (east) x1 += dx;
  if (north) y0 += dy;
  if (south) y1 += dy;
  // dragging past the opposite side flips to a minimum box, not a negative one
  if (west) x0 = Math.min(x0, x1 - MIN_CROP);
  if (east) x1 = Math.max(x1, x0 + MIN_CROP);
  if (north) y0 = Math.min(y0, y1 - MIN_CROP);
  if (south) y1 = Math.max(y1, y0 + MIN_CROP);
  if (bounds) {
    x0 = Math.max(x0, bounds.x);
    y0 = Math.max(y0, bounds.y);
    x1 = Math.min(x1, bounds.x + bounds.w);
    y1 = Math.min(y1, bounds.y + bounds.h);
  }
  let w = x1 - x0;
  let hh = y1 - y0;
  if (!ratio) return { x: x0, y: y0, w, h: hh };

  const corner = (west || east) && (north || south);
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  // anchor point that must stay fixed, and the room available from it
  const ax = west ? start.x + start.w : east ? start.x : cx;
  const ay = north ? start.y + start.h : south ? start.y : cy;
  if (corner) {
    // follow whichever axis moved further relative to the ratio
    if (w / ratio > hh) hh = w / ratio;
    else w = hh * ratio;
  } else if (west || east) {
    hh = w / ratio;
  } else {
    w = hh * ratio;
  }
  // available room from the anchor in each direction
  if (bounds) {
    const roomX = west ? ax - bounds.x : east ? bounds.x + bounds.w - ax : 2 * Math.min(ax - bounds.x, bounds.x + bounds.w - ax);
    const roomY = north ? ay - bounds.y : south ? bounds.y + bounds.h - ay : 2 * Math.min(ay - bounds.y, bounds.y + bounds.h - ay);
    const k = Math.min(1, roomX / w, roomY / hh);
    w *= k;
    hh *= k;
  }
  w = Math.max(w, MIN_CROP);
  hh = Math.max(hh, MIN_CROP / ratio);
  const x = west ? ax - w : east ? ax : ax - w / 2;
  const y = north ? ay - hh : south ? ay : ay - hh / 2;
  return { x, y, w, h: hh };
}

/** A new box drawn by dragging from a to b (ratio-locked when given), clamped to bounds. */
export function rectFromDrag(a: { x: number; y: number }, b: { x: number; y: number }, ratio: number | null, bounds: CropRect | null): CropRect {
  const start: CropRect = { x: a.x, y: a.y, w: 0, h: 0 };
  const handle = ((b.y < a.y ? 'n' : 's') + (b.x < a.x ? 'w' : 'e')) as CropHandle;
  // resize a zero box anchored at a; MIN_CROP keeps it valid
  return resizeCrop(start, handle, b.x - a.x, b.y - a.y, ratio, bounds);
}

/** Largest box of `ratio` that fits inside `r`, centred on it (used when a preset is picked). */
export function fitRatio(r: CropRect, ratio: number | null): CropRect {
  if (!ratio) return r;
  let w = r.w;
  let h = w / ratio;
  if (h > r.h) {
    h = r.h;
    w = h * ratio;
  }
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/**
 * Set the box size from W/H fields. With a ratio, the edited dimension wins and
 * the other follows. The box keeps its centre, then is moved/clamped into bounds.
 */
export function setCropSize(r: CropRect, size: { w?: number; h?: number }, ratio: number | null, bounds: CropRect): CropRect {
  let w = size.w ?? r.w;
  let h = size.h ?? r.h;
  if (ratio) {
    if (size.w !== undefined) h = w / ratio;
    else if (size.h !== undefined) w = h * ratio;
  }
  // fit inside bounds keeping the ratio when there is one
  const k = Math.min(1, bounds.w / w, bounds.h / h);
  if (ratio) {
    w *= k;
    h *= k;
  } else {
    w = Math.min(w, bounds.w);
    h = Math.min(h, bounds.h);
  }
  w = Math.max(MIN_CROP, w);
  h = Math.max(MIN_CROP, h);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return moveWithin({ x: cx - w / 2, y: cy - h / 2, w, h }, bounds);
}

/** Whole-pixel crop rectangle (what is committed). */
export function roundCrop(r: CropRect): CropRect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, w: Math.max(1, Math.round(r.x + r.w) - x), h: Math.max(1, Math.round(r.y + r.h) - y) };
}

/** True when the box covers the whole canvas (nothing to crop). */
export function isFullCrop(r: CropRect, docW: number, docH: number): boolean {
  const q = roundCrop(r);
  return q.x === 0 && q.y === 0 && q.w === Math.round(docW) && q.h === Math.round(docH);
}
