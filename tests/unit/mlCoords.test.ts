/**
 * Object Select coordinate mapping (critique 3, N0): document -> layer -> analysis pixel ->
 * [focus crop] -> model grid, plus upsampling order and the edge refine. See src/core/ml/coords.ts.
 */
import { describe, expect, it } from 'vitest';
import { apply, invert, multiply, rotate, scale, translate } from '../../src/core/geometry';
import { analysisSize, analysisTransform, cropRect, imageToModel } from '../../src/core/ml/coords';
import { encodeClicks } from '../../src/core/ml/clickMaps';
import { logitsToProb } from '../../src/core/ml/tensor';
import { focusCrops, selectObject, type SegmentationBackend } from '../../src/core/ml/selectSubject';
import { minCut, refineWithPrior } from '../../src/core/ml/refine';

/** world -> node units for a raster node, built exactly like engine/pixelOps.ts worldToPixelMatrix */
function worldToNode(world: ReturnType<typeof translate>, w: number, h: number) {
  return multiply(translate(w / 2, h / 2), invert(world));
}

describe('document -> layer -> analysis pixel', () => {
  it('caps the longest side at 1024 and never enlarges', () => {
    expect(analysisSize(1264, 848, 1024)).toEqual({ width: 1024, height: 687 });
    expect(analysisSize(640, 480, 1024)).toEqual({ width: 640, height: 480 });
    expect(analysisSize(500, 3000, 1024)).toEqual({ width: 171, height: 1024 });
  });

  it('maps the showcase click (photo placed 1:1 at the origin) to the same photo pixel, scaled', () => {
    // the photo opens as a 1264x848 node centred at (632, 424): world = photo pixels
    const m = worldToNode(translate(632, 424), 1264, 848);
    const { width, height } = analysisSize(1264, 848, 1024);
    const { toPixel, toWorld } = analysisTransform(m, 1264, 848, width, height);
    const q = apply(toPixel, { x: 1005, y: 492 });
    expect(q.x).toBeCloseTo((1005 * 1024) / 1264, 6);
    expect(q.y).toBeCloseTo((492 * 687) / 848, 6);
    const back = apply(toWorld, q);
    expect(back.x).toBeCloseTo(1005, 6);
    expect(back.y).toBeCloseTo(492, 6);
  });

  it('follows a moved, scaled and rotated layer (non-uniform analysis scale on x and y)', () => {
    // node 800x400 (source pixels), drawn at 50 % and rotated 90 degrees, centred at (300, 200)
    const world = multiply(translate(300, 200), multiply(rotate(90), scale(0.5, 0.5)));
    const m = worldToNode(world, 800, 400);
    const { toPixel } = analysisTransform(m, 800, 400, 400, 200);
    // node centre -> analysis centre
    const c = apply(toPixel, { x: 300, y: 200 });
    expect(c.x).toBeCloseTo(200, 6);
    expect(c.y).toBeCloseTo(100, 6);
    // the node's top-left corner (local (-400,-200) scaled 0.5 then rotated 90) -> analysis (0, 0)
    const tl = apply(world, { x: -400, y: -200 });
    const p = apply(toPixel, tl);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe('analysis pixel -> model grid (squash resize, no letterbox)', () => {
  it('uses align_corners=False centres and scales x and y independently', () => {
    // centre of a non-square image is the centre of the square grid: no letterbox offset
    const c = imageToModel(511.5, 343, 1024, 687, 320); // pixel centres 512, 343.5 = image centre
    expect(c.x).toBeCloseTo(159.5, 6);
    expect(c.y).toBeCloseTo(159.5, 6);
    // pixel (0,0) covers [0,1): its centre maps to grid -0.5 + 0.5*S/W
    const o = imageToModel(0, 0, 1024, 687, 320);
    expect(o.x).toBeCloseTo((0.5 * 320) / 1024 - 0.5, 6);
    expect(o.y).toBeCloseTo((0.5 * 320) / 687 - 0.5, 6);
    // the last pixel lands symmetrically at the far edge
    const e = imageToModel(1023, 686, 1024, 687, 320);
    expect(e.x).toBeCloseTo(319 - o.x, 6);
    expect(e.y).toBeCloseTo(319 - o.y, 6);
  });

  it('the positive click map peaks at the mapped click on a non-square image', () => {
    const click = { x: 1005 * (1024 / 1264), y: 492 * (687 / 848) };
    const map = encodeClicks(320, 320, [click], 1024, 687);
    let best = 0;
    for (let i = 1; i < map.length; i++) if (map[i] > map[best]) best = i;
    const g = imageToModel(click.x, click.y, 1024, 687, 320);
    expect(Math.abs((best % 320) - g.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(Math.floor(best / 320) - g.y)).toBeLessThanOrEqual(0.5);
  });
});

describe('focus crops', () => {
  it('keeps square crops inside the image (shifted, never padded) and gives up when too big', () => {
    expect(cropRect(10, 10, 100, 1024, 687)).toEqual({ x: 0, y: 0, side: 100 });
    expect(cropRect(1020, 680, 100, 1024, 687)).toEqual({ x: 924, y: 587, side: 100 });
    expect(cropRect(500, 300, 100, 1024, 687)).toEqual({ x: 450, y: 250, side: 100 });
    expect(cropRect(500, 300, 700, 1024, 687)).toBeNull();
  });

  it('zooms on small coarse results, centred on the click, and not on large ones', () => {
    const click = { x: 814, y: 399, positive: true };
    const crops = focusCrops({ x0: 700, y0: 300, x1: 900, y1: 480 }, 1024, 687, [click])!;
    expect(crops).toHaveLength(4);
    for (const r of crops) {
      expect(r).not.toBeNull();
      expect(click.x).toBeGreaterThanOrEqual(r!.x);
      expect(click.x).toBeLessThan(r!.x + r!.side);
      expect(click.y).toBeGreaterThanOrEqual(r!.y);
      expect(click.y).toBeLessThan(r!.y + r!.side);
    }
    expect(focusCrops({ x0: 0, y0: 0, x1: 900, y1: 600 }, 1024, 687, [click])).toBeNull();
  });

  it('every model pass sees the click where it is: the selection is centred on the click', async () => {
    // fake model: a disc (radius 8 % of the grid) around the strongest positive-click cell
    const backend: SegmentationBackend = {
      name: 'disc',
      run: async (input, size) => {
        const n = size * size;
        let best = 0;
        for (let i = 1; i < n; i++) if (input[3 * n + i] > input[3 * n + best]) best = i;
        const bx = best % size, by = Math.floor(best / size);
        const out = new Float32Array(n);
        const r = 0.08 * size;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = (x - bx) ** 2 + (y - by) ** 2 <= r * r ? 8 : -8;
        return out;
      },
    };
    const W = 400, H = 300;
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(128) };
    const click = { x: 317.3, y: 71.8, positive: true };
    const res = await selectObject(img, [click], { backend, refine: false });
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < res.binary.length; i++) if (res.binary[i]) { sx += i % W; sy += Math.floor(i / W); n++; }
    expect(n).toBeGreaterThan(0);
    expect(Math.abs(sx / n + 0.5 - click.x)).toBeLessThan(1.5);
    expect(Math.abs(sy / n + 0.5 - click.y)).toBeLessThan(1.5);
  });
});

describe('upsampling order', () => {
  it('upsamples logits bilinearly, then applies the sigmoid (threshold after upsampling)', () => {
    // 2x2 logits, left column -4, right column +12, upsampled to 8 px wide. Output px 3 samples
    // the source at 0.875: logit 0.625*-4 + 0.375*12 = +2 -> inside. Upsampling probabilities
    // instead would give 0.625*sigmoid(-4) + 0.375*sigmoid(12) = 0.39 -> outside (a shrunken mask).
    const logits = new Float32Array([-4, 12, -4, 12]);
    const p = logitsToProb(logits, 2, 8, 2);
    expect(p[2]).toBeLessThan(0.5);
    expect(p[3]).toBeGreaterThan(0.5);
    expect(p[7]).toBeGreaterThan(0.99);
  });
});

describe('edge refine (GrabCut-style)', () => {
  it('min cut separates two cliques joined by a weak edge', () => {
    const capS = new Float64Array([10, 0, 0, 0]);
    const capT = new Float64Array([0, 0, 0, 10]);
    const eu = new Int32Array([0, 1, 2]);
    const ev = new Int32Array([1, 2, 3]);
    const ew = new Float64Array([5, 0.5, 5]);
    expect(Array.from(minCut(4, capS, capT, eu, ev, ew))).toEqual([1, 1, 0, 0]);
  });

  it('snaps an oversized blob prior to the object edges', () => {
    const W = 160, H = 120;
    const data = new Uint8ClampedArray(W * H * 4);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 40;
    const gt = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const inside = x >= 70 && x < 100 && y >= 50 && y < 72; // a white "house" on grass
        gt[i] = inside ? 1 : 0;
        const base = inside ? [235, 235, 240] : [70, 130, 50];
        for (let c = 0; c < 3; c++) data[i * 4 + c] = base[c] + rnd();
        data[i * 4 + 3] = 255;
      }
    // blob prior: a soft disc 3x the house area around it, like the v0 model's output
    const prior = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) prior[y * W + x] = 1 / (1 + Math.exp(((Math.hypot(x - 85, y - 61) - 30) / 4)));
    const r = refineWithPrior({ width: W, height: H, data }, prior, [{ x: 85, y: 61, positive: true }])!;
    let inter = 0, union = 0, blob = 0;
    for (let i = 0; i < gt.length; i++) {
      if (r.binary[i] && gt[i]) inter++;
      if (r.binary[i] || gt[i]) union++;
      if (prior[i] >= 0.5) blob++;
    }
    expect(blob).toBeGreaterThan(3 * 30 * 22);
    expect(inter / union).toBeGreaterThan(0.9);
  });
});
