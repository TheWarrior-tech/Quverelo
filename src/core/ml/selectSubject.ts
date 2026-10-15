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
import { binarize, buildInput, cleanMask, logitsToMask, MODEL_SIZE, type MaskImage, type RgbaImage } from './tensor';

export type { SelectionClick } from './clickMaps';
export type { MaskImage, RgbaImage } from './tensor';

/** Runs the network: input [1,6,S,S] -> logits [1,1,S,S] (flattened). */
export interface SegmentationBackend {
  readonly name: string;
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
}

export interface SelectOptions {
  backend?: SegmentationBackend | null;
  size?: number;
  /** probability threshold 0..1 (default 0.5) */
  threshold?: number;
  /** previous result, for iterative click refinement */
  previous?: MaskImage | null;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

async function segment(img: RgbaImage, clicks: SelectionClick[], opts: SelectOptions): Promise<SelectionResult> {
  const t0 = now();
  const thr = Math.round((opts.threshold ?? 0.5) * 255);
  const size = opts.size ?? MODEL_SIZE;
  let error: string | undefined;
  if (opts.backend) {
    try {
      const input = buildInput(img, clicks, opts.previous ?? null, size);
      const logits = await opts.backend.run(input, size);
      if (logits.length !== size * size) throw new Error(`unexpected output length ${logits.length}`);
      const mask = logitsToMask(logits, size, img.width, img.height);
      const binary = cleanMask(binarize(mask, thr), img.width, img.height, clicks);
      return { mask, binary, source: 'ml', ms: now() - t0 };
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
