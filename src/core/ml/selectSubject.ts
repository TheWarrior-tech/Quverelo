/**
 * Local, offline "Select Subject" and click-to-select-object.
 *
 * The heavy lifting is a pluggable `SegmentationBackend` (the app uses onnxruntime-web with the
 * QuvSelect model shipped in ml/models/; tests use fakes). If no backend is available or it fails,
 * deterministic non-ML fallbacks are used, so the commands always return something sensible.
 *
 * Everything here is pure TS (no DOM): the renderer supplies RGBA pixels and turns the resulting
 * mask into a pixel selection (see maskToPath.ts).
 */
import type { SelectionClick } from './clickMaps';
import { clickFallback, subjectFallback } from './fallback';
import { cropRect, type CropRect } from './coords';
import { refineWithPrior } from './refine';
import { refineMatte } from './matte';
import { binarize, buildInput, cleanMask, logitsToProb, MODEL_SIZE, probToMask, type MaskImage, type RgbaImage } from './tensor';

export type { SelectionClick } from './clickMaps';
export type { MaskImage, RgbaImage } from './tensor';

/** Runs the network: input [1,6,S,S] -> logits [1,1,S,S] (flattened). */
export interface SegmentationBackend {
  readonly name: string;
  /** model input size to run whole-image passes at (default MODEL_SIZE) */
  readonly inputSize?: number;
  /** whether Object Select should run the zoomed focus passes with this model (default true; see models.ts) */
  readonly focusPasses?: boolean;
  run(input: Float32Array, size: number): Promise<Float32Array>;
}

export interface SelectionResult {
  /** soft mask at image resolution (0..255) */
  mask: MaskImage;
  /** cleaned binary mask (0/1) at image resolution */
  binary: Uint8Array;
  source: 'ml' | 'fallback';
  /** backend error that caused a fallback, if any */
  error?: string;
  ms: number;
  /** Select Subject stage times in ms (model = input tensor + network + upsampling)  */
  stages?: { model: number; matte: number; clean: number };
}

export interface SelectOptions {
  backend?: SegmentationBackend | null;
  size?: number;
  /** probability threshold 0..1 (default 0.5) */
  threshold?: number;
  /** previous result, for iterative click refinement */
  previous?: MaskImage | null;
  /** click-to-select: re-run the model on zoomed crops around the coarse result (default true) */
  focus?: boolean;
  /** click-to-select: model input size for the zoomed crops (default FOCUS_SIZE) */
  focusSize?: number;
  /** click-to-select: snap the result to image edges with the GrabCut-style refine (default true) */
  refine?: boolean;
  /**
   * Select Subject: turn the network's low-resolution probability into a soft alpha matte at image
   * resolution with the colour-model edge refinement in matte.ts (hair, fur). Default true.
   */
  matte?: boolean;
  /** Select Subject: also run the horizontally flipped image and average (test-time augmentation). Default false. */
  flipTTA?: boolean;
}

/**
 * Click-to-select pipeline (critique 3, N0). One squash-resized pass over the whole image only
 * *localises* a small object: at 320 px the showcase cottage is ~22x16 model px and the
 * undertrained v0 network returns a blob the size of its click Gaussian (6x the house). So:
 *  1. coarse pass on the whole image (MODEL_SIZE) -> component at the click -> its bbox B;
 *  2. if B is small relative to the image, re-run on square crops of FOCUS_SCALES x B around it
 *     at FOCUS_SIZE (the 224-256 px the model was trained at) and average the probabilities
 *     (a pixel outside a crop gets a 0 vote from it), so the object fills the model's view;
 *  3. snap that prior to image edges (refine.ts: colour GMMs + contrast-sensitive min cut),
 *     then keep the component(s) under the positive clicks.
 */
export const FOCUS_SIZE = 256;
export const FOCUS_SCALES = [0.5, 0.75, 1, 1.25] as const;
/** skip zooming when the coarse result already spans this fraction of the image's longer side */
export const FOCUS_MAX_FRAC = 0.75;
/** keep the edge-refined mask only if it retains at least this share of the model's region */
export const REFINE_MIN_KEEP = 0.25;
/** above this long side the soft matte solves its colour model at half resolution (fast guided filter, see matte.ts) */
export const MATTE_FAST_FROM = 640;
export const matteSubsample = (w: number, h: number) => (Math.max(w, h) > MATTE_FAST_FROM ? 2 : 1);

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Crop an RGBA image (rect assumed inside the image). */
function cropImage(img: RgbaImage, r: CropRect): RgbaImage {
  const out = new Uint8ClampedArray(r.side * r.side * 4);
  for (let y = 0; y < r.side; y++) {
    const s = ((y + r.y) * img.width + r.x) * 4;
    out.set(img.data.subarray(s, s + r.side * 4), y * r.side * 4);
  }
  return { width: r.side, height: r.side, data: out };
}

function cropMask(m: MaskImage, r: CropRect): MaskImage {
  const out = new Uint8Array(r.side * r.side);
  for (let y = 0; y < r.side; y++) out.set(m.data.subarray((y + r.y) * m.width + r.x, (y + r.y) * m.width + r.x + r.side), y * r.side);
  return { width: r.side, height: r.side, data: out };
}

function flipImage(img: RgbaImage): RgbaImage {
  const { width: W, height: H } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, d = (y * W + (W - 1 - x)) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3];
    }
  return { width: W, height: H, data: out };
}

/** Run the network on `img` and return the probability at img resolution. */
async function predict(backend: SegmentationBackend, img: RgbaImage, clicks: SelectionClick[], prev: MaskImage | null, size: number): Promise<Float32Array> {
  const input = buildInput(img, clicks, prev, size);
  const logits = await backend.run(input, size);
  if (logits.length !== size * size) throw new Error(`unexpected output length ${logits.length}`);
  return logitsToProb(logits, size, img.width, img.height);
}

/** bbox of a 0/1 mask plus the positive clicks; null when both are empty. */
function bboxOf(bin: Uint8Array, w: number, h: number, clicks: SelectionClick[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  for (const c of clicks) {
    if (!c.positive) continue;
    x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y);
  }
  if (!(x1 >= x0)) return null;
  return { x0, y0, x1: Math.min(w - 1, x1), y1: Math.min(h - 1, y1) };
}

/**
 * Focus crops: one square per FOCUS_SCALES entry, sized from the coarse bbox and centred on the
 * centroid of the positive clicks (the coarse blob is often off-centre; the click is where the
 * user pointed). null entries mean "use the whole image"; null overall means "no zoom needed".
 */
export function focusCrops(b: { x0: number; y0: number; x1: number; y1: number }, W: number, H: number, clicks: SelectionClick[]): (CropRect | null)[] | null {
  const span = Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  if (span >= FOCUS_MAX_FRAC * Math.max(W, H)) return null;
  const minSide = Math.max(32, Math.round(0.06 * Math.max(W, H)));
  const pos = clicks.filter((c) => c.positive);
  const cx = pos.length ? pos.reduce((a, c) => a + c.x, 0) / pos.length : (b.x0 + b.x1 + 1) / 2;
  const cy = pos.length ? pos.reduce((a, c) => a + c.y, 0) / pos.length : (b.y0 + b.y1 + 1) / 2;
  return FOCUS_SCALES.map((f) => cropRect(cx, cy, Math.max(minSide, span * f), W, H));
}

async function clickSegment(backend: SegmentationBackend, img: RgbaImage, clicks: SelectionClick[], opts: SelectOptions, thr: number): Promise<{ prob: Float32Array; binary: Uint8Array }> {
  const { width: W, height: H } = img;
  const size = opts.size ?? backend.inputSize ?? MODEL_SIZE;
  const prev = opts.previous ?? null;
  // 1. coarse
  let prob = await predict(backend, img, clicks, prev, size);
  const coarse = cleanMask(binarizeProb(prob, thr), W, H, clicks);
  // 2. focus
  const b = (opts.focus ?? backend.focusPasses ?? true) === false ? null : bboxOf(coarse, W, H, clicks);
  const crops = b ? focusCrops(b, W, H, clicks) : null;
  if (crops) {
    const fs = opts.focusSize ?? FOCUS_SIZE;
    const sum = new Float32Array(W * H);
    for (const r of crops) {
      if (!r) {
        const p = await predict(backend, img, clicks, prev, fs);
        for (let i = 0; i < p.length; i++) sum[i] += p[i];
        continue;
      }
      const cl = clicks.map((c) => ({ ...c, x: c.x - r.x, y: c.y - r.y }));
      const p = await predict(backend, cropImage(img, r), cl, prev ? cropMask(prev, r) : null, fs);
      for (let y = 0; y < r.side; y++) {
        const row = (y + r.y) * W + r.x;
        for (let x = 0; x < r.side; x++) sum[row + x] += p[y * r.side + x];
      }
    }
    for (let i = 0; i < sum.length; i++) sum[i] /= crops.length;
    prob = sum;
  }
  // 3. edge refine. The cut can only trust colour where the object differs from its
  // surroundings; in "stuff" (water, sky, grass) it collapses to the click disk. When it keeps
  // less than REFINE_MIN_KEEP of the model's region, the model's region is the better answer.
  const seed = cleanMask(binarizeProb(prob, thr), W, H, clicks);
  let bin = seed;
  if (opts.refine !== false) {
    const r = refineWithPrior(img, prob, clicks, { seedThreshold: thr / 255 });
    if (r) {
      const refined = cleanMask(r.binary, W, H, clicks);
      if (count(refined) >= REFINE_MIN_KEEP * count(seed)) bin = refined;
    }
  }
  return { prob, binary: bin };
}

const count = (m: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
};

function binarizeProb(prob: Float32Array, thr: number): Uint8Array {
  const t = thr / 255;
  const out = new Uint8Array(prob.length);
  for (let i = 0; i < prob.length; i++) out[i] = prob[i] >= t ? 1 : 0;
  return out;
}

async function segment(img: RgbaImage, clicks: SelectionClick[], opts: SelectOptions): Promise<SelectionResult> {
  const t0 = now();
  const thr = Math.round((opts.threshold ?? 0.5) * 255);
  const size = opts.size ?? opts.backend?.inputSize ?? MODEL_SIZE;
  let error: string | undefined;
  if (opts.backend) {
    try {
      if (clicks.some((c) => c.positive)) {
        const { prob, binary } = await clickSegment(opts.backend, img, clicks, opts, thr);
        // the soft mask (fed back as the previous mask on the next click) is the final selection,
        // feathered by the prior inside it
        const mask = probToMask(prob, img.width, img.height);
        for (let i = 0; i < binary.length; i++) mask.data[i] = binary[i] ? Math.max(128, mask.data[i]) : Math.min(127, mask.data[i]);
        return { mask, binary, source: 'ml', ms: now() - t0 };
      }
      const prob = await predict(opts.backend, img, clicks, opts.previous ?? null, size);
      if (opts.flipTTA) {
        const f = await predict(opts.backend, flipImage(img), [], null, size);
        const W = img.width;
        for (let y = 0; y < img.height; y++) for (let x = 0; x < W; x++) prob[y * W + x] = 0.5 * (prob[y * W + x] + f[y * W + (W - 1 - x)]);
      }
      const t1 = now();
      const mask = opts.matte === false ? probToMask(prob, img.width, img.height) : refineMatte(img, prob, { modelScale: Math.max(img.width, img.height) / size, subsample: matteSubsample(img.width, img.height) });
      const t2 = now();
      const binary = cleanMask(binarize(mask, thr), img.width, img.height, clicks);
      return { mask, binary, source: 'ml', ms: now() - t0, stages: { model: t1 - t0, matte: t2 - t1, clean: now() - t2 } };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const mask = clicks.length ? clickFallback(img, clicks) : subjectFallback(img);
  const binary = cleanMask(binarize(mask, 128), img.width, img.height, clicks);
  return { mask, binary, source: 'fallback', error, ms: now() - t0 };
}

/** Select the main subject(s) of the image. */
export function selectSubject(img: RgbaImage, opts: SelectOptions = {}): Promise<SelectionResult> {
  return segment(img, [], { ...opts, previous: null });
}

/** Select the object under the given clicks (positive = add, negative = exclude). */
export function selectObject(img: RgbaImage, clicks: SelectionClick[], opts: SelectOptions = {}): Promise<SelectionResult> {
  if (!clicks.some((c) => c.positive)) return selectSubject(img, opts);
  return segment(img, clicks, opts);
}
