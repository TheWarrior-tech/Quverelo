/**
 * Asset store: immutable pixel buffers keyed by asset id. A pixel edit never
 * mutates an asset; it creates a new one, so history snapshots can reference
 * old ids for free undo.
 */
import { newId } from '../../core/ids';
import { applyAdjustments, type Pixels } from '../../core/pixels';
import type { Adjustment, AssetRef, Id } from '../../core/types';
import type { AssetBlob } from '../../core/serialization';

interface Entry {
  canvas: HTMLCanvasElement;
  mime: string;
  /** encoded bytes, if known (avoids re-encoding on save) */
  bytes: Uint8Array | null;
}

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

  /** Register a canvas as a new immutable asset. The canvas must not be mutated afterwards. */
  add(canvas: HTMLCanvasElement, mime = 'image/png', bytes: Uint8Array | null = null, id: Id = newId('a')): Id {
    this.entries.set(id, { canvas, mime, bytes });
    return id;
  }

  async addBytes(bytes: Uint8Array, mime: string, id?: Id): Promise<{ id: Id; width: number; height: number }> {
    const canvas = await bytesToCanvas(bytes, mime);
    const keepMime = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp' ? mime : 'image/png';
    const aid = this.add(canvas, keepMime, keepMime === mime ? bytes : null, id);
    return { id: aid, width: canvas.width, height: canvas.height };
  }

  ref(id: Id, name: string): AssetRef {
    const e = this.entries.get(id);
    return { id, name, mime: e?.mime ?? 'image/png', width: e?.canvas.width ?? 0, height: e?.canvas.height ?? 0 };
  }

  async blob(id: Id): Promise<AssetBlob | null> {
    const e = this.entries.get(id);
    if (!e) return null;
    if (!e.bytes) e.bytes = await canvasToBytes(e.canvas, e.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.95);
    if (e.mime !== 'image/jpeg' && e.mime !== 'image/png' && e.mime !== 'image/webp') e.mime = 'image/png';
    return { bytes: e.bytes, mime: e.mime };
  }

  dataUrl(id: Id): string | null {
    const e = this.entries.get(id);
    if (!e) return null;
    return e.canvas.toDataURL(e.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92);
  }

  /** Pixels of an asset with a non-destructive adjustment stack applied (cached). */
  rendered(id: Id, adjustments: Adjustment[], preview = false): HTMLCanvasElement | null {
    const base = this.get(id);
    if (!base) return null;
    const active = adjustments.filter((a) => a.enabled);
    if (!active.length) return base;
    const key = `${id}|${preview ? 'p' : 'f'}|${JSON.stringify(active.map((a) => [a.type, a.params, a.curves ?? null, a.stops ?? null]))}`;
    const hit = this.renderedCache.get(key);
    if (hit) return hit;
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
    this.renderedCache.set(key, out);
    this.renderedOrder.push(key);
    while (this.renderedOrder.length > 24) {
      const k = this.renderedOrder.shift()!;
      this.renderedCache.delete(k);
    }
    return out;
  }

  /** Drop assets not in the keep set (call with assets reachable from history). */
  gc(keep: Set<Id>): void {
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.entries.delete(id);
    for (const k of [...this.renderedCache.keys()]) if (!keep.has(k.split('|')[0])) this.renderedCache.delete(k);
    this.renderedOrder = this.renderedOrder.filter((k) => this.renderedCache.has(k));
  }

  clear(): void {
    this.entries.clear();
    this.renderedCache.clear();
    this.renderedOrder = [];
  }
}
