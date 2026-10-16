/**
 * Renderer glue for the on-device QuvSelect model (onnxruntime-web, WASM, CPU, fully offline).
 * The model and the WASM binary are bundled by Vite as local assets: nothing is fetched from the network.
 */
import type { invert } from '../../core/geometry';
import { findNode } from '../../core/document';
import { transformPath } from '../../core/path';
import type { PathCommand, RasterNode } from '../../core/types';
import { maskToPath } from '../../core/ml/maskToPath';
import { analysisSize, analysisTransform } from '../../core/ml/coords';
import { upsampleMatte } from '../../core/ml/tensor';
import { selectObject, selectSubject, type SegmentationBackend, type SelectionClick, type SelectionResult } from '../../core/ml/selectSubject';
import type { Editor } from '../state/editor';
import { createCanvas, ctx2d } from './assets';
import { worldToPixelMatrix } from './pixelOps';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { pickModel } from '../../core/ml/models';

/**
 * Bundled models (local files, never fetched at runtime). QuvSelect v1 is a CI-downloaded release asset
 * (scripts/fetch-ml-models.mjs, ml/models/manifest.json); when a build does not have it, the committed v0
 * model is used. import.meta.glob keeps the build working either way.
 */
const MODEL_URLS = import.meta.glob('../../../ml/models/quvselect*.onnx', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const MODEL = pickModel(MODEL_URLS);

/** Longest side the image is analysed at (the model itself runs at 320 px; this bounds pre/post cost). */
const ANALYSIS_MAX_SIDE = 1024;

type Ort = typeof import('onnxruntime-web/wasm');
let backendPromise: Promise<SegmentationBackend | null> | null = null;

/** Lazily create the ONNX backend once; resolves to null (=> fallback) if it cannot load. */
export function getSegmentationBackend(): Promise<SegmentationBackend | null> {
  if (!backendPromise) {
    backendPromise = (async () => {
      try {
        const ort: Ort = await import('onnxruntime-web/wasm');
        ort.env.wasm.wasmPaths = { wasm: wasmUrl };
        ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
        ort.env.wasm.proxy = false;
        if (!MODEL) throw new Error('no bundled QuvSelect model');
        const session = await ort.InferenceSession.create(MODEL.url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
        const backend: SegmentationBackend = {
          name: `${MODEL.id}-onnx-wasm`,
          inputSize: MODEL.inputSize,
          focusPasses: MODEL.focusPasses,
          async run(input, size) {
            const t = new ort.Tensor('float32', input, [1, 6, size, size]);
            const out = await session.run({ input: t });
            return out.logits.data as Float32Array;
          },
        };
        console.info(`[ml] backend ${backend.name} (input ${MODEL.inputSize} px, ${ort.env.wasm.numThreads} thread(s))`);
        return backend;
      } catch (e) {
        console.warn('[ml] ONNX backend unavailable, using fallback:', e);
        return null;
      }
    })();
  }
  return backendPromise;
}

interface RasterView {
  node: RasterNode;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** analysis pixel -> world */
  toWorld: ReturnType<typeof invert>;
  /** world -> analysis pixel */
  toPixel: ReturnType<typeof invert>;
}

/** Rendered pixels of a raster layer (adjustments applied), downscaled for analysis. */
export function rasterView(ed: Editor, node: RasterNode): RasterView | null {
  const doc = ed.doc;
  if (!doc || !findNode(doc, node.id)) return null;
  const src = ed.assets.rendered(node.assetId, node.adjustments, false) ?? ed.assets.get(node.assetId);
  const m = worldToPixelMatrix(doc, node.id);
  if (!src || !m) return null;
  const { width, height } = analysisSize(src.width, src.height, ANALYSIS_MAX_SIDE);
  const c = createCanvas(width, height);
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // antialiased downscale, closer to the PIL resize the model was trained on
  ctx.drawImage(src, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  // world -> node units (m) -> analysis pixels; see core/ml/coords.ts for the full click chain
  const { toPixel, toWorld } = analysisTransform(m, node.w, node.h, width, height);
  return { node, width, height, data, toPixel, toWorld };
}

export function resultToWorldPath(view: RasterView, r: SelectionResult): PathCommand[] | null {
  const d = maskToPath(r.binary, view.width, view.height, { epsilon: 0.6, minArea: 6 });
  return d ? transformPath(d, view.toWorld) : null;
}

export async function runSelectSubject(view: RasterView): Promise<SelectionResult> {
  const backend = await getSegmentationBackend();
  const res = await selectSubject(view, { backend });
  lastSubject = { nodeId: view.node.id, assetId: view.node.assetId, result: res };
  return res;
}

/** The most recent Select Subject result, so Cut Out Subject can reuse its soft matte without re-running. */
let lastSubject: { nodeId: string; assetId: string; result: SelectionResult } | null = null;
export function cachedSubject(view: RasterView): SelectionResult | null {
  return lastSubject && lastSubject.nodeId === view.node.id && lastSubject.assetId === view.node.assetId && lastSubject.result.source === 'ml' ? lastSubject.result : null;
}

/**
 * Soft-edged cut-out: the layer's rendered pixels at full resolution with the soft alpha matte applied.
 * The matte is computed at analysis resolution (<= ANALYSIS_MAX_SIDE) and upsampled bilinearly.
 */
export function cutoutCanvas(ed: Editor, view: RasterView, res: SelectionResult): HTMLCanvasElement | null {
  const src = ed.assets.rendered(view.node.assetId, view.node.adjustments, false) ?? ed.assets.get(view.node.assetId);
  if (!src) return null;
  const W = src.width, H = src.height;
  const c = createCanvas(W, H);
  const ctx = ctx2d(c);
  ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const alpha = upsampleMatte(res.mask, W, H);
  for (let i = 0; i < alpha.length; i++) id.data[i * 4 + 3] = Math.round((id.data[i * 4 + 3] * alpha[i]) / 255);
  ctx.putImageData(id, 0, 0);
  return c;
}

export async function runSelectObject(view: RasterView, clicks: SelectionClick[], previous: SelectionResult | null): Promise<SelectionResult> {
  const backend = await getSegmentationBackend();
  return selectObject(view, clicks, { backend, previous: previous?.mask ?? null });
}
