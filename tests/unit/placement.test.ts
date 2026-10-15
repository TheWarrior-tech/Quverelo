import { describe, expect, it } from 'vitest';
import { intersects, placePopover, type Rect } from '../../src/renderer/ui/controls/placement';

const view = { width: 1440, height: 873 };
const W = 248;
const H = 360;
const rectOf = (p: { left: number; top: number }): Rect => ({ left: p.left, top: p.top, right: p.left + W, bottom: p.top + H });
const inspector: Rect = { left: 1152, top: 44, right: 1440, bottom: 849 };

describe('popover placement (critique 3 N6)', () => {
  it('keeps the old behaviour with nothing to avoid: below the anchor, sliding inside the window', () => {
    const p = placePopover({ left: 1400, top: 50, right: 1420, bottom: 70 }, W, H, view, 'below');
    expect(p.side).toBe('below');
    expect(p.top).toBe(76);
    expect(p.left).toBe(1440 - W - 8);
  });

  it('flips above when there is no room below', () => {
    const p = placePopover({ left: 400, top: 800, right: 420, bottom: 820 }, W, H, view, 'below');
    expect(p.side).toBe('above');
    expect(p.top + H).toBeLessThanOrEqual(800);
  });

  it('opens an inspector chip to the left of the panel, never over it', () => {
    const chip = { left: 1220, top: 300, right: 1240, bottom: 320 };
    const anchor = { left: inspector.left, top: chip.top, right: inspector.left, bottom: chip.bottom };
    const p = placePopover(anchor, W, H, view, 'left', [inspector]);
    expect(p.overlaps).toBe(false);
    expect(rectOf(p).right).toBeLessThanOrEqual(inspector.left);
    expect(intersects(rectOf(p), inspector)).toBe(false);
  });

  it('moves an inspector popover off the selection when the selection sits beside the inspector', () => {
    const sel = { left: 860, top: 200, right: 1100, bottom: 520 };
    const anchor = { left: inspector.left, top: 300, right: inspector.left, bottom: 320 };
    const p = placePopover(anchor, W, H, view, 'left', [inspector, sel]);
    expect(p.overlaps).toBe(false);
    expect(intersects(rectOf(p), sel)).toBe(false);
    expect(intersects(rectOf(p), inspector)).toBe(false);
  });

  it('places a context-bar popover beside the selection instead of on top of it', () => {
    const chip = { left: 420, top: 52, right: 452, bottom: 76 };
    const sel = { left: 380, top: 120, right: 640, bottom: 400 };
    const p = placePopover(chip, W, H, view, 'below', [inspector, sel]);
    expect(p.overlaps).toBe(false);
    expect(intersects(rectOf(p), sel)).toBe(false);
    expect(intersects(rectOf(p), inspector)).toBe(false);
    expect(intersects(rectOf(p), chip)).toBe(false);
  });

  it('places a selection-toolbar popover below the toolbar when that clears the selection, above when the toolbar flipped', () => {
    const sel = { left: 500, top: 200, right: 700, bottom: 360 };
    const below = placePopover({ left: 560, top: 376, right: 580, bottom: 396 }, W, H, view, 'below', [inspector, sel]);
    expect(below.side).toBe('below');
    expect(intersects(rectOf(below), sel)).toBe(false);
    // toolbar flipped above a selection that fills the lower canvas
    const sel2 = { left: 300, top: 300, right: 900, bottom: 840 };
    const above = placePopover({ left: 560, top: 252, right: 580, bottom: 272 }, W, H, view, 'below', [inspector, sel2]);
    expect(above.overlaps).toBe(false);
    expect(intersects(rectOf(above), sel2)).toBe(false);
  });

  it('falls back to the preferred side when nothing keeps everything clear', () => {
    const huge = { left: 0, top: 0, right: 1440, bottom: 873 };
    const p = placePopover({ left: 420, top: 52, right: 452, bottom: 76 }, W, H, view, 'below', [huge]);
    expect(p.overlaps).toBe(true);
    expect(p.side).toBe('below');
  });
});
