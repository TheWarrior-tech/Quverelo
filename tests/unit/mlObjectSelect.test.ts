/**
 * Accuracy regression for Object Select on the showcase photo (critique 3, N0).
 *
 * The review frame clicks the cottage in tests/fixtures/sample-photo.jpg at document point
 * (1005, 492) (tests/e2e/review-captures.spec.ts). Before the fix that click selected a blob of
 * hillside about 6x the house (IoU 0.11 against the reference below).
 *
 * Reference mask: a hand-traced polygon of the cottage (walls, roof and both chimneys; the dark
 * lean-to on the right and the shadow are excluded), in full-resolution pixels of the 1264x848
 * fixture, traced on a 6x zoom of the photo. It is rasterised at the analysis size the app uses.
 *
 * Thresholds (from critique 3, N0 fix step 3):
 *   - IoU >= 0.80 against the reference, for the review click and for six other clicks spread
 *     over the walls and roof (the fix measured 0.93-0.94 on all seven);
 *   - selected area <= 1.5x the area of the reference bounding box;
 *   - the selection's bounding box stays within 8 analysis px of the reference bounding box.
 *
 * Runs the shipped ONNX model with onnxruntime-web (WASM, CPU) through the same TS pipeline
 * the app uses (selectObject, with the focus-pass setting the app uses for that model, src/core/ml/models.ts);
 * skipped if the model file is missing.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-web';
import jpeg from 'jpeg-js';
import { analysisSize } from '../../src/core/ml/coords';
import { resizePlane } from '../../src/core/ml/tensor';
import { selectObject, type SegmentationBackend } from '../../src/core/ml/selectSubject';
import { MODEL_PREFERENCE } from '../../src/core/ml/models';

/** every bundled model that is present: v0 (committed) and v1 (release asset, ml/models/manifest.json) */
const MODELS = [
  { name: 'QuvSelect v1', path: resolve(__dirname, '../../ml/models/quvselect_v1.onnx'), focusPasses: MODEL_PREFERENCE.find((m) => m.id === 'quvselect-v1')!.focusPasses },
  { name: 'QuvSelect v0', path: resolve(__dirname, '../../ml/models/quvselect.onnx'), focusPasses: MODEL_PREFERENCE.find((m) => m.id === 'quvselect-v0')!.focusPasses },
];
const PHOTO = resolve(__dirname, '../fixtures/sample-photo.jpg');

/** Hand-traced cottage outline, full-resolution pixels of sample-photo.jpg (1264x848). */
export const COTTAGE_POLYGON: [number, number][] = [
  [964.2, 490], [981.7, 470], [981.7, 460.8], [985.8, 456.7], [990, 456.7], [992.5, 460.8], [992.5, 466.7],
  [1019.2, 469.2], [1020, 465], [1023.3, 459.2], [1026.7, 459.2], [1030, 465.8], [1030.8, 475.8],
  [1050, 495], [1050.8, 517.5], [1001.7, 521.7], [965, 511.7],
];
/** the review capture's click, in document = photo pixels */
const REVIEW_CLICK = { x: 1005, y: 492 };
const OTHER_CLICKS = [[1020, 500], [985, 500], [1040, 505], [1000, 478], [1035, 490], [975, 505]];

export const IOU_MIN = 0.8;
export const AREA_MAX_BBOX_FACTOR = 1.5;

/** Decode the fixture and downscale it to the analysis size (as rasterView does with drawImage). */
function loadAnalysisImage() {
  const raw = jpeg.decode(readFileSync(PHOTO), { useTArray: true, formatAsRGBA: true });
  const { width, height } = analysisSize(raw.width, raw.height, 1024);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let c = 0; c < 3; c++) {
    const plane = new Float32Array(raw.width * raw.height);
    for (let i = 0; i < plane.length; i++) plane[i] = raw.data[i * 4 + c];
    const r = resizePlane(plane, raw.width, raw.height, width, height);
    for (let i = 0; i < r.length; i++) data[i * 4 + c] = r[i];
  }
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = 255;
  return { img: { width, height, data }, k: width / raw.width, srcW: raw.width, srcH: raw.height };
}

function rasterise(poly: [number, number][], k: number, w: number, h: number): Uint8Array {
  const p = poly.map(([x, y]) => [x * k, y * k]);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i], [xj, yj] = p[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      out[y * w + x] = inside ? 1 : 0;
    }
  return out;
}

function stats(m: Uint8Array, ref: Uint8Array, w: number) {
  let inter = 0, union = 0, area = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < m.length; i++) {
    if (m[i]) {
      area++;
      const x = i % w, y = (i / w) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (m[i] && ref[i]) inter++;
    if (m[i] || ref[i]) union++;
  }
  return { iou: union ? inter / union : 0, area, bbox: { x0, y0, x1, y1 } };
}

for (const { name, path: MODEL, focusPasses } of MODELS)
describe.skipIf(!existsSync(MODEL))(`Object Select accuracy on the showcase photo (${name})`, () => {
  it('a click on the cottage selects the cottage tightly (IoU >= 0.8, area <= 1.5x its bbox)', async () => {
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ['wasm'] });
    const backend: SegmentationBackend = {
      name: 'test-ort-web',
      focusPasses, // as the app configures this model (src/core/ml/models.ts)
      run: async (x, size) => (await session.run({ input: new ort.Tensor('float32', x, [1, 6, size, size]) })).logits.data as Float32Array,
    };
    const { img, k } = loadAnalysisImage();
    const ref = rasterise(COTTAGE_POLYGON, k, img.width, img.height);
    const rs = stats(ref, ref, img.width);
    const refBboxArea = (rs.bbox.x1 - rs.bbox.x0 + 1) * (rs.bbox.y1 - rs.bbox.y0 + 1);

    const clicks = [[REVIEW_CLICK.x, REVIEW_CLICK.y], ...OTHER_CLICKS];
    const ious: number[] = [];
    for (const [x, y] of clicks) {
      const res = await selectObject(img, [{ x: x * k, y: y * k, positive: true }], { backend });
      expect(res.source).toBe('ml');
      const s = stats(res.binary, ref, img.width);
      ious.push(s.iou);
      expect(s.iou, `IoU for click (${x}, ${y})`).toBeGreaterThanOrEqual(IOU_MIN);
      expect(s.area, `area for click (${x}, ${y})`).toBeLessThanOrEqual(AREA_MAX_BBOX_FACTOR * refBboxArea);
      expect(s.bbox.x0).toBeGreaterThanOrEqual(rs.bbox.x0 - 8);
      expect(s.bbox.y0).toBeGreaterThanOrEqual(rs.bbox.y0 - 8);
      expect(s.bbox.x1).toBeLessThanOrEqual(rs.bbox.x1 + 8);
      expect(s.bbox.y1).toBeLessThanOrEqual(rs.bbox.y1 + 8);
    }
    // eslint-disable-next-line no-console
    console.info(`[objsel] ${name} cottage IoU per click: ${ious.map((v) => v.toFixed(3)).join(' ')}`);
  }, 60_000);

  it('documents the old single-pass behaviour (no zoom, no edge refine) (logged, not asserted: the model may improve)', async () => {
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ['wasm'] });
    const backend: SegmentationBackend = {
      name: 'test-ort-web',
      run: async (x, size) => (await session.run({ input: new ort.Tensor('float32', x, [1, 6, size, size]) })).logits.data as Float32Array,
    };
    const { img, k } = loadAnalysisImage();
    const ref = rasterise(COTTAGE_POLYGON, k, img.width, img.height);
    const res = await selectObject(img, [{ x: REVIEW_CLICK.x * k, y: REVIEW_CLICK.y * k, positive: true }], { backend, focus: false, refine: false });
    const s = stats(res.binary, ref, img.width);
    // eslint-disable-next-line no-console
    console.info(`[objsel] ${name} single-pass IoU ${s.iou.toFixed(3)}, area ${(s.area / stats(ref, ref, img.width).area).toFixed(1)}x the cottage`);
    expect(res.source).toBe('ml');
  }, 60_000);
});
