/**
 * Popover placement (DESIGN.md §8 "Popovers", critique 3 N6).
 *
 * A popover opens on its preferred side of the anchor, flips when that side has
 * no room, and never covers the rects it is told to keep clear of: the
 * inspector it was opened from and the selected object it is editing, so the
 * change stays visible live. Pure geometry so it can be unit-tested.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type Side = 'below' | 'above' | 'right' | 'left';

export interface Placement {
  left: number;
  top: number;
  side: Side;
  /** the placement had to overlap one of the avoid rects (nothing else fit) */
  overlaps: boolean;
}

const GAP_V = 6;
const GAP_H = 8;

export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Place a w×h popover for an anchor rect inside a view of `view` size.
 * `avoid` rects (selection, inspector) are kept clear when any candidate allows;
 * the anchor itself is always kept clear. Falls back to the preferred side.
 */
export function placePopover(
  anchor: Rect,
  w: number,
  h: number,
  view: { width: number; height: number },
  placement: Side,
  avoid: Rect[] = [],
  margin = 8,
): Placement {
  const clampX = (x: number) => Math.max(margin, Math.min(x, view.width - w - margin));
  const clampY = (y: number) => Math.max(margin, Math.min(y, view.height - h - margin));
  const vertical = placement === 'below' || placement === 'above';
  // beside-a-rect candidates keep the popover level with the anchor
  const besideTop = vertical ? anchor.bottom + GAP_V : anchor.top - GAP_H;
  const at = (side: Side, left: number, top: number) => ({ side, left, top });
  const anchorSides = {
    below: at('below', anchor.left, anchor.bottom + GAP_V),
    above: at('above', anchor.left, anchor.top - h - GAP_V),
    right: at('right', anchor.right + GAP_H, anchor.top - GAP_H),
    left: at('left', anchor.left - w - GAP_H, anchor.top - GAP_H),
  };
  const flip: Record<Side, Side> = { below: 'above', above: 'below', left: 'right', right: 'left' };
  const order: Side[] = [placement, flip[placement], ...(['below', 'above', 'left', 'right'] as Side[]).filter((s) => s !== placement && s !== flip[placement])];
  const cands: { side: Side; left: number; top: number }[] = order.map((s) => anchorSides[s]);
  for (const r of avoid) {
    cands.push(at('left', r.left - w - GAP_H, besideTop));
    cands.push(at('right', r.right + GAP_H, besideTop));
    cands.push(at('below', anchor.left, r.bottom + GAP_H));
    cands.push(at('above', anchor.left, r.top - h - GAP_H));
  }
  const keepClear = [anchor, ...avoid];
  const fits = (c: { left: number; top: number }) => c.left >= margin - 0.5 && c.top >= margin - 0.5 && c.left + w <= view.width - margin + 0.5 && c.top + h <= view.height - margin + 0.5;
  const rectOf = (c: { left: number; top: number }): Rect => ({ left: c.left, top: c.top, right: c.left + w, bottom: c.top + h });
  // the cross axis may always slide inside the window (a menu under a chip near the right edge)
  const slide = (c: { side: Side; left: number; top: number }) => (c.side === 'below' || c.side === 'above' ? { ...c, left: clampX(c.left) } : { ...c, top: clampY(c.top) });
  // 1) a candidate whose own side has room and that covers nothing
  for (const c0 of cands) {
    const c = slide(c0);
    if (fits(c) && !keepClear.some((r) => intersects(rectOf(c), r))) return { ...c, overlaps: false };
  }
  // 2) a candidate nudged inside the window that still covers nothing
  for (const c of cands) {
    const n = { ...c, left: clampX(c.left), top: clampY(c.top) };
    if (!keepClear.some((r) => intersects(rectOf(n), r))) return { ...n, overlaps: false };
  }
  // 3) nothing keeps everything clear: the preferred side, flipped if it has no room
  let p = slide(anchorSides[placement]);
  if (!fits(p) && fits(slide(anchorSides[flip[placement]]))) p = slide(anchorSides[flip[placement]]);
  return { side: p.side, left: clampX(p.left), top: clampY(p.top), overlaps: true };
}
