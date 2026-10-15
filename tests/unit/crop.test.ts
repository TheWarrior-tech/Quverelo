import { describe, expect, it } from 'vitest';
import {
  CROP_RATIOS, MIN_CROP, cursorFor, fitRatio, hitCrop, isFullCrop, moveWithin, ratioValue, rectFromDrag, resizeCrop, roundCrop, setCropSize,
  type CropRect,
} from '../../src/core/crop';

const DOC: CropRect = { x: 0, y: 0, w: 1000, h: 600 };
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('crop ratios', () => {
  it('offers the required presets', () => {
    const ids = CROP_RATIOS.map((r) => r.id);
    for (const id of ['free', 'original', '1:1', '4:3', '16:9']) expect(ids).toContain(id);
  });
  it('resolves preset values, landscape by default, flipped for portrait', () => {
    expect(ratioValue('free', 1000, 600)).toBeNull();
    close(ratioValue('original', 1000, 600)!, 1000 / 600);
    close(ratioValue('original', 1000, 600, true)!, 600 / 1000);
    expect(ratioValue('1:1', 1000, 600)).toBe(1);
    close(ratioValue('4:3', 1000, 600)!, 4 / 3);
    close(ratioValue('16:9', 1000, 600, true)!, 9 / 16);
  });
});

describe('hitCrop', () => {
  const r: CropRect = { x: 100, y: 100, w: 400, h: 200 };
  it('finds corners before edges, edges along their length, and the interior', () => {
    expect(hitCrop(r, { x: 101, y: 99 }, 5)).toBe('nw');
    expect(hitCrop(r, { x: 500, y: 300 }, 5)).toBe('se');
    expect(hitCrop(r, { x: 300, y: 98 }, 5)).toBe('n');
    expect(hitCrop(r, { x: 150, y: 302 }, 5)).toBe('s');
    expect(hitCrop(r, { x: 503, y: 250 }, 5)).toBe('e');
    expect(hitCrop(r, { x: 97, y: 120 }, 5)).toBe('w');
    expect(hitCrop(r, { x: 300, y: 200 }, 5)).toBe('move');
    expect(hitCrop(r, { x: 20, y: 20 }, 5)).toBeNull();
  });
  it('maps hits to resize cursors', () => {
    expect(cursorFor('nw')).toBe('nwse-resize');
    expect(cursorFor('ne')).toBe('nesw-resize');
    expect(cursorFor('n')).toBe('ns-resize');
    expect(cursorFor('w')).toBe('ew-resize');
    expect(cursorFor('move')).toBe('move');
    expect(cursorFor(null)).toBe('crosshair');
  });
});

describe('resizeCrop', () => {
  const r: CropRect = { x: 100, y: 100, w: 400, h: 200 };
  it('free corner drag keeps the opposite corner fixed', () => {
    const n = resizeCrop(r, 'nw', 50, 30, null, DOC);
    expect(n).toEqual({ x: 150, y: 130, w: 350, h: 170 });
    const s = resizeCrop(r, 'se', -100, 50, null, DOC);
    expect(s).toEqual({ x: 100, y: 100, w: 300, h: 250 });
  });
  it('edge drags move one side only', () => {
    expect(resizeCrop(r, 'e', 60, 999, null, DOC)).toEqual({ x: 100, y: 100, w: 460, h: 200 });
    expect(resizeCrop(r, 'n', 999, -40, null, DOC)).toEqual({ x: 100, y: 60, w: 400, h: 240 });
  });
  it('clamps to the canvas and never inverts', () => {
    const big = resizeCrop(r, 'se', 5000, 5000, null, DOC);
    expect(big.x + big.w).toBe(1000);
    expect(big.y + big.h).toBe(600);
    const flipped = resizeCrop(r, 'e', -5000, 0, null, DOC);
    expect(flipped.w).toBe(MIN_CROP);
    expect(flipped.x).toBe(100);
  });
  it('locked ratio: corner keeps the anchor and the ratio', () => {
    const n = resizeCrop(r, 'se', 100, 0, 2, DOC);
    expect(n.x).toBe(100);
    expect(n.y).toBe(100);
    close(n.w / n.h, 2);
    expect(n.w).toBe(500);
  });
  it('locked ratio: edge drag grows the other side about the centre', () => {
    const n = resizeCrop(r, 'e', 100, 0, 2, DOC); // 500 wide -> 250 high, centred on y=200
    close(n.w, 500);
    close(n.h, 250);
    close(n.y + n.h / 2, 200);
  });
  it('locked ratio stays inside the canvas', () => {
    const n = resizeCrop(r, 'se', 5000, 5000, 16 / 9, DOC);
    close(n.w / n.h, 16 / 9, 1e-6);
    expect(n.x + n.w).toBeLessThanOrEqual(1000 + 1e-9);
    expect(n.y + n.h).toBeLessThanOrEqual(600 + 1e-9);
    expect(n.x).toBe(100);
    expect(n.y).toBe(100);
  });
});

describe('box helpers', () => {
  it('rectFromDrag works in every direction and respects a ratio', () => {
    expect(rectFromDrag({ x: 300, y: 300 }, { x: 100, y: 200 }, null, DOC)).toEqual({ x: 100, y: 200, w: 200, h: 100 });
    const sq = rectFromDrag({ x: 100, y: 100 }, { x: 400, y: 200 }, 1, DOC);
    close(sq.w, sq.h);
    expect(sq.x).toBe(100);
  });
  it('fitRatio returns the largest centred box of a ratio', () => {
    const f = fitRatio(DOC, 1);
    expect(f).toEqual({ x: 200, y: 0, w: 600, h: 600 });
    expect(fitRatio(DOC, null)).toBe(DOC);
  });
  it('moveWithin keeps the box on the canvas', () => {
    expect(moveWithin({ x: -50, y: 550, w: 200, h: 100 }, DOC)).toEqual({ x: 0, y: 500, w: 200, h: 100 });
  });
  it('setCropSize: edited dimension wins under a ratio; keeps the centre; fits the canvas', () => {
    const r = { x: 400, y: 200, w: 200, h: 200 };
    const a = setCropSize(r, { w: 300 }, 1.5, DOC);
    close(a.w, 300);
    close(a.h, 200);
    close(a.x + a.w / 2, 500);
    const b = setCropSize(r, { w: 5000 }, null, DOC);
    expect(b.w).toBe(1000);
    expect(b.x).toBe(0);
  });
  it('roundCrop snaps to whole pixels and isFullCrop detects a no-op', () => {
    expect(roundCrop({ x: 10.4, y: 0.6, w: 100.2, h: 50.5 })).toEqual({ x: 10, y: 1, w: 101, h: 50 });
    expect(isFullCrop({ x: 0.2, y: 0, w: 999.9, h: 600 }, 1000, 600)).toBe(true);
    expect(isFullCrop({ x: 10, y: 0, w: 990, h: 600 }, 1000, 600)).toBe(false);
  });
});
