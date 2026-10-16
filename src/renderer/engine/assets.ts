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

/** Above this many pixels an adjustment render is worth doing at screen resolution / in a worker. */
const BIG_PIXELS = 4_000_000;
/** Largest render the viewport does synchronously while a bigger one is in the worker. */
const SYNC_PIXELS = 1_000_000;
/** Memory budget for cached adjustment renders (pixels; 4 bytes each). */
const CACHE_PIXELS = 160_000_000;

/** Power-of-two render level (1, 1/2, 1/4…) that covers `need` output pixels per source pixel. */
export function renderLevel(need: number): number {
  if (!(need > 0) || need >= 0.75) return 1;
  return Math.max(1 / 64, 2 ** Math.ceil(Math.log2(need)));
}

const stackKey = (list: Adjustment[]) => JSON.stringify(list.map((a) => [a.type, a.params, a.curves ?? null]));

interface Rendered { px: Pixels | null; canvas: HTMLCanvasElement | null; pixels: number }

export class AssetStore {
  private entries = new Map<Id, Entry>();
  /** renders keyed by asset, level and adjustment-stack prefix; Map order = LRU order */
  private renderedCache = new Map<string, Rendered>();
  private cachedPixels = 0;
  private worker: Worker | null | undefined;
  private jobs = new Map<number, { key: string; resolve: (ok: boolean) => void }>();
  private inFlight = new Map<string, Promise<boolean>>();
  private jobSeq = 0;
  private listeners = new Set<() => void>();
  /** background renders finished in the worker / on the main thread (fallback); for tests and the bench */
  readonly stats = { worker: 0, fallback: 0 };

  has(id: Id): boolean {
    return this.entries.has(id);
  }

  get(id: Id): HTMLCanvasElement | null {
    return this.entries.get(id)?.canvas ?? null;
  }

  /** Called when a background (worker) render lands, so views can redraw. */
  onRendered(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Background renders still running (used by the bench and tests). */
  pendingRenders(): number {
    return this.inFlight.size;
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

  /**
   * Pixels of an asset with a non-destructive adjustment stack applied (cached).
   *  - `false`: full resolution (export, SVG, thumbnails of the work file);
   *  - `true`: a fast preview at most PREVIEW_MAX px (while dragging a slider);
   *  - a number: the output pixels per source pixel the view needs. Big images
   *    render synchronously at a small level and the level the view needs is
   *    made in a worker; onRendered fires when it lands.
   * Each prefix of the stack is cached, so adding a step only computes that step.
   */
  rendered(id: Id, adjustments: Adjustment[], preview: boolean | number = false): HTMLCanvasElement | null {
    const base = this.get(id);
    if (!base) return null;
    const active = adjustments.filter((a) => a.enabled);
    if (!active.length) return base;
    const px = base.width * base.height;
    if (preview === true) {
      const level = Math.min(1, PREVIEW_MAX / Math.max(base.width, base.height));
      return this.renderSync(id, base, active, level, true);
    }
    if (preview === false || px <= BIG_PIXELS) return this.renderSync(id, base, active, 1);
    const want = renderLevel(preview);
    const wantKey = this.key(id, want, active);
    const hit = this.touch(wantKey);
    if (hit) return this.canvasOf(hit);
    // the largest level we are willing to do on the main thread
    let sync = want;
    while (sync > 1 / 64 && px * sync * sync > SYNC_PIXELS) sync /= 2;
    if (sync < want) {
      // anything already made between sync and want is better than a fresh small render
      for (let l = want / 2; l > sync; l /= 2) {
        const better = this.touch(this.key(id, l, active));
        if (better) { void this.renderInWorker(id, base, active, want); return this.canvasOf(better); }
      }
      void this.renderInWorker(id, base, active, want);
    }
    return this.renderSync(id, base, active, sync);
  }

  /** Make the full-resolution renders a document needs (export) without blocking the UI. */
  async prepareFull(nodes: { assetId: Id; adjustments: Adjustment[] }[]): Promise<void> {
    await Promise.all(nodes.map((n) => {
      const base = this.get(n.assetId);
      const active = n.adjustments.filter((a) => a.enabled);
      if (!base || !active.length || base.width * base.height <= BIG_PIXELS) return Promise.resolve(true);
      return this.renderInWorker(n.assetId, base, active, 1);
    }));
  }

  private key(id: Id, level: number, list: Adjustment[], tag = ''): string {
    return `${id}|${level}${tag}|${stackKey(list)}`;
  }

  private touch(key: string): Rendered | null {
    const r = this.renderedCache.get(key);
    if (!r) return null;
    this.renderedCache.delete(key);
    this.renderedCache.set(key, r);
    return r;
  }

  private remember(key: string, r: Rendered) {
    const old = this.renderedCache.get(key);
    if (old) this.cachedPixels -= old.pixels;
    this.renderedCache.delete(key);
    this.renderedCache.set(key, r);
    this.cachedPixels += r.pixels;
    for (const [k, v] of this.renderedCache) {
      if (this.cachedPixels <= CACHE_PIXELS || this.renderedCache.size <= 1) break;
      if (k === key) continue;
      this.renderedCache.delete(k);
      this.cachedPixels -= v.pixels;
    }
  }

  private canvasOf(r: Rendered): HTMLCanvasElement {
    if (!r.canvas) {
      r.canvas = pixelsToCanvas(r.px!);
      r.pixels *= 2;
      this.cachedPixels += r.px!.width * r.px!.height;
    }
    return r.canvas;
  }

  private scaled(base: HTMLCanvasElement, level: number): HTMLCanvasElement {
    if (level >= 1) return base;
    const c = createCanvas(base.width * level, base.height * level);
    const x = ctx2d(c);
    x.imageSmoothingQuality = 'medium';
    x.drawImage(base, 0, 0, c.width, c.height);
    return c;
  }

  /** Longest cached prefix of the stack at this level: [steps done, pixels]. */
  private bestPrefix(id: Id, base: HTMLCanvasElement, active: Adjustment[], level: number, tag: string): [number, Pixels] {
    for (let n = active.length - 1; n >= 1; n--) {
      const r = this.touch(this.key(id, level, active.slice(0, n), tag));
      if (r) return [n, r.px ?? canvasToPixels(r.canvas!)];
    }
    return [0, canvasToPixels(this.scaled(base, level))];
  }

  private renderSync(id: Id, base: HTMLCanvasElement, active: Adjustment[], level: number, preview = false): HTMLCanvasElement {
    const tag = preview ? 'p' : '';
    const key = this.key(id, level, active, tag);
    const hit = this.touch(key);
    if (hit) return this.canvasOf(hit);
    let [done, cur] = this.bestPrefix(id, base, active, level, tag);
    for (let i = done; i < active.length; i++) {
      cur = applyAdjustments(cur, [active[i]], level);
      done = i + 1;
      // keep intermediate steps so the next added/edited step starts from here
      if (done < active.length) this.remember(this.key(id, level, active.slice(0, done), tag), { px: cur, canvas: null, pixels: cur.width * cur.height });
    }
    const canvas = pixelsToCanvas(cur);
    this.remember(key, { px: cur, canvas, pixels: 2 * cur.width * cur.height });
    return canvas;
  }

  private getWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    try {
      this.worker = new Worker(new URL('./adjustWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ job: number; width?: number; height?: number; buf?: ArrayBuffer; error?: string }>) => {
        const j = this.jobs.get(e.data.job);
        if (!j) return;
        this.jobs.delete(e.data.job);
        if (e.data.error || !e.data.buf) { j.resolve(false); return; }
        const px: Pixels = { width: e.data.width!, height: e.data.height!, data: new Uint8ClampedArray(e.data.buf) };
        this.remember(j.key, { px, canvas: null, pixels: px.width * px.height });
        j.resolve(true);
      };
      this.worker.onerror = () => {
        // no worker (e.g. blocked by policy): finish every queued job on the main thread instead
        this.worker?.terminate();
        this.worker = null;
        for (const j of this.jobs.values()) j.resolve(false);
        this.jobs.clear();
      };
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  private renderInWorker(id: Id, base: HTMLCanvasElement, active: Adjustment[], level: number): Promise<boolean> {
    const key = this.key(id, level, active);
    if (this.renderedCache.has(key)) return Promise.resolve(true);
    const running = this.inFlight.get(key);
    if (running) return running;
    const p = new Promise<boolean>((resolve) => {
      const [done, start] = this.bestPrefix(id, base, active, level, '');
      const w = this.getWorker();
      const finish = (ok: boolean) => {
        if (!ok) this.renderSync(id, base, active, level); // fall back to the main thread
        this.stats[ok ? 'worker' : 'fallback']++;
        this.inFlight.delete(key);
        resolve(true);
        for (const fn of this.listeners) fn();
      };
      if (!w) { setTimeout(() => finish(false), 0); return; }
      const job = ++this.jobSeq;
      this.jobs.set(job, { key, resolve: finish });
      // a cached prefix is shared: send a copy; a fresh read of the canvas can be transferred
      const buf = (done > 0 ? start.data.slice() : start.data).buffer as ArrayBuffer;
      w.postMessage({ job, width: start.width, height: start.height, buf, list: active.slice(done), scale: level }, [buf]);
    });
    this.inFlight.set(key, p);
    return p;
  }

  /** Drop assets not in the keep set (call with assets reachable from history). */
  gc(keep: Set<Id>): void {
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.entries.delete(id);
    for (const [k, v] of [...this.renderedCache]) {
      if (keep.has(k.split('|')[0])) continue;
      this.renderedCache.delete(k);
      this.cachedPixels -= v.pixels;
    }
  }

  clear(): void {
    this.entries.clear();
    this.renderedCache.clear();
    this.cachedPixels = 0;
  }
}
