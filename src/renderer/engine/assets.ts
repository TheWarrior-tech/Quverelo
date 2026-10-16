/**
 * Asset store: immutable pixel buffers keyed by asset id. A pixel edit never
 * mutates an asset; it creates a new one, so history snapshots can reference
 * old ids for free undo.
 */
import { newId } from '../../core/ids';
import { applyAdjustments, type Pixels } from '../../core/pixels';
import type { Adjustment, AssetRef, Id } from '../../core/types';
import type { AssetBlob } from '../../core/serialization';
import { applyAdjustments16, merge16, resize16, to16, to8, type Pixels16 } from '../../core/pixels16';
import { decodePng16, encodePng16, pngBitDepth } from '../../core/png16';
import { decodeDng, isDng, type DngInfo } from '../../core/raw/dng';
import type { RawTarget } from '../../core/raw/rawColour';

/** Mime type of Adobe DNG raw files (developed to 16-bit pixels on import). */
export const DNG_MIME = 'image/x-adobe-dng';

interface Entry {
  canvas: HTMLCanvasElement;
  mime: string;
  /** encoded bytes, if known (avoids re-encoding on save) */
  bytes: Uint8Array | null;
  /**
   * 16 bits per channel original (16-bit PNG, developed DNG, or an edit of
   * one). `canvas` is then its 8-bit rounding for the screen; saving writes a
   * 16-bit PNG and 16-bit documents adjust and export from this.
   */
  hi?: Pixels16;
}

/** Where a canvas was cloned from, so an edit of a 16-bit asset can keep its 16 bits (see AssetStore.add). */
const cloneSource = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** Full-resolution 16-bit renders behind rendered() canvases (16-bit documents). */
const renderedHi = new WeakMap<HTMLCanvasElement, Pixels16>();

const PREVIEW_MAX = 1600;

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: false })!;
}

export function canvasToPixels(c: HTMLCanvasElement): Pixels {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

export function pixelsToCanvas(p: Pixels): HTMLCanvasElement {
  const c = createCanvas(p.width, p.height);
  const img = new ImageData(new Uint8ClampedArray(p.data), p.width, p.height);
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  cloneSource.set(c, src);
  return c;
}

export async function canvasToBytes(c: HTMLCanvasElement, mime = 'image/png', quality = 0.92): Promise<Uint8Array> {
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), mime, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function bytesToCanvas(bytes: Uint8Array, mime: string): Promise<HTMLCanvasElement> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const bmp = await createImageBitmap(blob);
  const c = createCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

export class AssetStore {
  private entries = new Map<Id, Entry>();
  private renderedCache = new Map<string, HTMLCanvasElement>();
  private renderedOrder: string[] = [];

  has(id: Id): boolean {
    return this.entries.has(id);
  }

  get(id: Id): HTMLCanvasElement | null {
    return this.entries.get(id)?.canvas ?? null;
  }

  /** The asset's 16-bit original, if it has one. */
  hi(id: Id): Pixels16 | null {
    return this.entries.get(id)?.hi ?? null;
  }

  /** Bits per channel the asset keeps (16 for 16-bit PNG / DNG originals and their edits). */
  bitDepth(id: Id): 8 | 16 {
    return this.entries.get(id)?.hi ? 16 : 8;
  }

  /**
   * Register a canvas as a new immutable asset. The canvas must not be mutated afterwards.
   * When the canvas is an edited clone of a 16-bit asset (or of a 16-bit render),
   * the untouched pixels keep their 16-bit values (merge16).
   */
  add(canvas: HTMLCanvasElement, mime = 'image/png', bytes: Uint8Array | null = null, id: Id = newId('a'), hi?: Pixels16): Id {
    let high = hi;
    if (!high) {
      const src = cloneSource.get(canvas);
      const srcHi = src ? renderedHi.get(src) ?? this.hiOfCanvas(src) : null;
      if (srcHi) high = merge16(srcHi, canvasToPixels(canvas)) ?? undefined;
    }
    this.entries.set(id, { canvas, mime, bytes, hi: high });
    return id;
  }

  /** Register 16-bit pixels as a new asset (the 8-bit canvas is derived for the screen). */
  add16(p: Pixels16, bytes: Uint8Array | null = null, id: Id = newId('a')): Id {
    return this.add(pixelsToCanvas(to8(p)), 'image/png', bytes, id, p);
  }

  private hiOfCanvas(c: HTMLCanvasElement): Pixels16 | null {
    for (const e of this.entries.values()) if (e.canvas === c) return e.hi ?? null;
    return null;
  }

  /**
   * Decode and register an image file. 16-bit PNGs keep their 16 bits; DNG raw
   * files are developed (demosaic, white balance, colour matrix) to 16-bit
   * pixels in `rawTarget` (the document's RGB space).
   */
  async addBytes(bytes: Uint8Array, mime: string, id?: Id, opts: { rawTarget?: RawTarget } = {}): Promise<{ id: Id; width: number; height: number; bitDepth: 8 | 16; raw?: DngInfo }> {
    if (mime === DNG_MIME || (mime !== 'image/png' && mime !== 'image/jpeg' && isDng(bytes))) {
      const { image, info } = decodeDng(bytes, { target: opts.rawTarget });
      const aid = this.add16(image, null, id);
      return { id: aid, width: image.width, height: image.height, bitDepth: 16, raw: info };
    }
    if (mime === 'image/png' && pngBitDepth(bytes) === 16) {
      const p = decodePng16(bytes);
      const aid = this.add16(p, bytes, id);
      return { id: aid, width: p.width, height: p.height, bitDepth: 16 };
    }
    const canvas = await bytesToCanvas(bytes, mime);
    const keepMime = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp' ? mime : 'image/png';
    const aid = this.add(canvas, keepMime, keepMime === mime ? bytes : null, id);
    return { id: aid, width: canvas.width, height: canvas.height, bitDepth: 8 };
  }

  ref(id: Id, name: string): AssetRef {
    const e = this.entries.get(id);
    return { id, name, mime: e?.mime ?? 'image/png', width: e?.canvas.width ?? 0, height: e?.canvas.height ?? 0 };
  }

  async blob(id: Id): Promise<AssetBlob | null> {
    const e = this.entries.get(id);
    if (!e) return null;
    if (!e.bytes && e.hi) {
      e.bytes = encodePng16(e.hi);
      e.mime = 'image/png';
    }
    if (!e.bytes) e.bytes = await canvasToBytes(e.canvas, e.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.95);
    if (e.mime !== 'image/jpeg' && e.mime !== 'image/png' && e.mime !== 'image/webp') e.mime = 'image/png';
    return { bytes: e.bytes, mime: e.mime };
  }

  dataUrl(id: Id): string | null {
    const e = this.entries.get(id);
    if (!e) return null;
    return e.canvas.toDataURL(e.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92);
  }

  /**
   * Pixels of an asset with a non-destructive adjustment stack applied (cached).
   * `depth16` (16-bit documents) runs the stack at 16 bits per channel from
   * the 16-bit original (or the widened 8-bit pixels) and rounds once at the
   * end for the screen, so strong stacks do not band.
   */
  rendered(id: Id, adjustments: Adjustment[], preview = false, depth16 = false): HTMLCanvasElement | null {
    const base = this.get(id);
    if (!base) return null;
    const active = adjustments.filter((a) => a.enabled);
    if (!active.length) return base;
    const key = `${id}|${preview ? 'p' : 'f'}${depth16 ? '16' : ''}|${JSON.stringify(active.map((a) => [a.type, a.params, a.curves ?? null]))}`;
    const hit = this.renderedCache.get(key);
    if (hit) return hit;
    if (depth16) {
      const out = this.renderedPixels16(id, active, preview);
      if (!out) return null;
      const c = pixelsToCanvas(to8(out.pixels));
      if (!preview) renderedHi.set(c, out.pixels);
      this.remember(key, c);
      return c;
    }
    let src = base;
    let scale = 1;
    if (preview && Math.max(base.width, base.height) > PREVIEW_MAX) {
      scale = PREVIEW_MAX / Math.max(base.width, base.height);
      src = createCanvas(base.width * scale, base.height * scale);
      const c = ctx2d(src);
      c.imageSmoothingQuality = 'medium';
      c.drawImage(base, 0, 0, src.width, src.height);
    }
    const out = pixelsToCanvas(applyAdjustments(canvasToPixels(src), active, scale));
    this.remember(key, out);
    return out;
  }

  private remember(key: string, c: HTMLCanvasElement): void {
    this.renderedCache.set(key, c);
    this.renderedOrder.push(key);
    while (this.renderedOrder.length > 24) {
      const k = this.renderedOrder.shift()!;
      this.renderedCache.delete(k);
    }
  }

  private hiCache = new Map<string, Pixels16>();

  /** 16-bit pixels of an asset (original, or widened 8-bit) with the stack applied at 16 bits. */
  renderedPixels16(id: Id, adjustments: Adjustment[], preview = false): { pixels: Pixels16; scale: number } | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const active = adjustments.filter((a) => a.enabled);
    const key = `${id}|${preview ? 'p' : 'f'}|${JSON.stringify(active.map((a) => [a.type, a.params, a.curves ?? null]))}`;
    let src = e.hi ?? to16(canvasToPixels(e.canvas));
    let scale = 1;
    if (preview && Math.max(src.width, src.height) > PREVIEW_MAX) {
      scale = PREVIEW_MAX / Math.max(src.width, src.height);
      src = resize16(src, Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)));
    }
    if (!active.length) return { pixels: src, scale };
    const hit = this.hiCache.get(key);
    if (hit) return { pixels: hit, scale };
    const out = applyAdjustments16(src, active, scale);
    this.hiCache.set(key, out);
    while (this.hiCache.size > 4) this.hiCache.delete(this.hiCache.keys().next().value!);
    return { pixels: out, scale };
  }

  /** Drop assets not in the keep set (call with assets reachable from history). */
  gc(keep: Set<Id>): void {
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.entries.delete(id);
    for (const k of [...this.renderedCache.keys()]) if (!keep.has(k.split('|')[0])) this.renderedCache.delete(k);
    this.renderedOrder = this.renderedOrder.filter((k) => this.renderedCache.has(k));
    for (const k of [...this.hiCache.keys()]) if (!keep.has(k.split('|')[0])) this.hiCache.delete(k);
  }

  clear(): void {
    this.entries.clear();
    this.renderedCache.clear();
    this.renderedOrder = [];
    this.hiCache.clear();
  }
}
