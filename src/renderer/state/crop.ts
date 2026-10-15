/**
 * Crop session state shared by the Crop tool (canvas) and the context bar:
 * the live box lives in editor.ui.crop, the preset/orientation/overlay in
 * tool options. Apply commits one undo step; Cancel resets the box and stays
 * in Crop (it never silently switches tools).
 */
import { cropDocument } from '../../core/commands';
import { fitRatio, isFullCrop, moveWithin, ratioValue, roundCrop, setCropSize, type CropOverlay, type CropRatioId, type CropRect } from '../../core/crop';
import { editor } from './editor';
import { toast } from './bus';

export function docBounds(): CropRect | null {
  const d = editor.doc;
  return d ? { x: 0, y: 0, w: d.settings.width, h: d.settings.height } : null;
}

/** The box the user sees: the live crop, clamped to the canvas, or the whole canvas. */
export function currentCrop(): CropRect | null {
  const b = docBounds();
  if (!b) return null;
  const c = editor.ui.crop;
  return c ? moveWithin(c, b) : b;
}

/** Locked aspect ratio (w/h) for the current preset, or null when free. */
export function currentRatio(): number | null {
  const d = editor.doc;
  if (!d) return null;
  const o = editor.ui.toolOptions;
  return ratioValue(o.cropRatio, d.settings.width, d.settings.height, o.cropPortrait);
}

export function setCropBox(r: CropRect): void {
  editor.setUi({ crop: r });
}

/** Pick a preset: the box becomes the largest box of that ratio inside the canvas, centred on the current box. */
export function setCropRatio(id: CropRatioId, portrait = editor.ui.toolOptions.cropPortrait): void {
  const d = editor.doc;
  const b = docBounds();
  if (!d || !b) return;
  // 'original' starts in the document's own orientation
  editor.setToolOptions({ cropRatio: id, cropPortrait: portrait });
  const ratio = ratioValue(id, d.settings.width, d.settings.height, portrait);
  if (!ratio) return;
  const cur = currentCrop() ?? b;
  // fit inside the canvas, then centre on the current box
  const fit = fitRatio(b, ratio);
  const cx = cur.x + cur.w / 2;
  const cy = cur.y + cur.h / 2;
  setCropBox(moveWithin({ ...fit, x: cx - fit.w / 2, y: cy - fit.h / 2 }, b));
}

/** Swap landscape/portrait for the current preset (or swap W and H when free). */
export function toggleCropOrientation(): void {
  const o = editor.ui.toolOptions;
  const b = docBounds();
  const cur = currentCrop();
  if (!b || !cur) return;
  if (o.cropRatio === 'free') {
    const r = setCropSize(cur, { w: cur.h, h: cur.w }, null, b);
    editor.setToolOptions({ cropPortrait: !o.cropPortrait });
    setCropBox(r);
    return;
  }
  setCropRatio(o.cropRatio, !o.cropPortrait);
}

export function setCropDimension(dim: 'w' | 'h', v: number): void {
  const b = docBounds();
  const cur = currentCrop();
  if (!b || !cur || !Number.isFinite(v) || v <= 0) return;
  setCropBox(setCropSize(cur, dim === 'w' ? { w: v } : { h: v }, currentRatio(), b));
}

export function setCropOverlay(v: CropOverlay): void {
  editor.setToolOptions({ cropOverlay: v });
}

/** Reset the box to the whole canvas (Esc / Cancel). Stays in the Crop tool. */
export function cancelCrop(): void {
  editor.setUi({ crop: null });
}

/** Commit the crop as one undo step. Returns false when there is nothing to crop. */
export function applyCrop(onApplied?: () => void): boolean {
  const d = editor.doc;
  const r = currentCrop();
  if (!d || !r) return false;
  if (isFullCrop(r, d.settings.width, d.settings.height)) {
    toast('Drag the handles to choose what to keep');
    return false;
  }
  const q = roundCrop(r);
  if (q.w < 2 || q.h < 2) return false;
  editor.commit('Crop', (doc) => cropDocument(doc, q));
  editor.setUi({ pixelSelection: null, crop: null });
  onApplied?.();
  return true;
}
