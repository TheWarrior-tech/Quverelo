/**
 * Photo parity tools: Polygonal selection, Magic wand, the retouch brushes
 * (Clone, Healing, Spot healing, Dodge, Burn, Smudge) and Liquify.
 *
 * Brushes work in the layer's own pixel grid on a copy of its pixels, show the
 * stroke live (viewport.livePaint) and commit one undoable step on release.
 * They honour the pixel selection (with its feather), the layer lock, flow
 * and pen pressure.
 */
import { apply, type Point } from '../../core/geometry';
import { findNode } from '../../core/document';
import { updateNode } from '../../core/commands';
import { pointsToPath } from '../../core/path';
import { floodMask, type Pixels } from '../../core/pixels';
import { cloneDab, createSmudge, dodgeBurnDab, healDab, smudgeDab, spotHealDab, type Dab, type SmudgeState } from '../../core/retouch';
import { applyDab, createField, warp, type Field } from '../../core/liquify';
import type { Id, PathCommand, RasterNode, SceneNode } from '../../core/types';
import type { Editor, ToolId } from '../state/editor';
import { createCanvas, ctx2d } from './assets';
import { activeRaster, commitRasterCanvas } from './pixelOps';
import {
  combineSelection, layerPixelMatrix, layerSample, maskToWorldPath, pageSample, pixelScale, selectionCoverage, type SelectionMode,
} from './selectionPixels';
import type { Tool, ToolContext } from './tools';

const CROSS = 'crosshair';

// ---------------------------------------------------------------------------
// Pen pressure: fabric delivers mouse events, so read pressure from the
// pointer events that precede them.

let lastPressure = 1;
let testPressure: number | null = null;
if (typeof window !== 'undefined') {
  const track = (e: PointerEvent) => {
    lastPressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1;
  };
  window.addEventListener('pointerdown', track, { capture: true, passive: true });
  window.addEventListener('pointermove', track, { capture: true, passive: true });
}

/** Pen pressure 0..1 for the current stroke (1 for mouse and touch). */
export function penPressure(e?: MouseEvent): number {
  if (testPressure !== null) return testPressure;
  const pe = e as PointerEvent | undefined;
  if (pe && 'pointerType' in pe && pe.pointerType === 'pen' && pe.pressure > 0) return pe.pressure;
  return lastPressure;
}

/** Test hook: simulate pen pressure (e2e drives a mouse). */
export function setTestPressure(p: number | null): void {
  testPressure = p;
}

export function drawBrushCursor(ctx: CanvasRenderingContext2D, p: Point, size: number, z: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1 / z;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2 + 1 / z, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Replace a layer's pixel mask with a new immutable asset. */
export function commitMaskCanvas(ed: Editor, nodeId: Id, canvas: HTMLCanvasElement, label: string): void {
  const assetId = ed.assets.add(canvas, 'image/png');
  ed.commit(label, (d) => {
    const loc = findNode(d, nodeId);
    const pm = loc?.node.pixelMask;
    if (!loc || !pm) return d;
    const withAsset = { ...d, assets: { ...d.assets, [assetId]: ed.assets.ref(assetId, `${loc.node.name} mask`) } };
    return updateNode(withAsset, nodeId, { pixelMask: { ...pm, assetId } } as Partial<SceneNode>);
  });
}

function selectionModeFor(e: MouseEvent, base: SelectionMode): SelectionMode {
  return e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : base;
}

/** Put an outline into the selection with a mode; a new selection starts sharp. */
export function setSelection(ed: Editor, d: PathCommand[] | null, mode: SelectionMode): void {
  const next = combineSelection(ed.ui.pixelSelection, d, mode);
  ed.setUi({ pixelSelection: next, pixelSelectionFeather: mode === 'new' ? 0 : ed.ui.pixelSelectionFeather });
}

// ---------------------------------------------------------------------------
// Polygonal selection

export class PolygonLassoTool implements Tool {
  cursor = CROSS;
  private pts: Point[] = [];
  private hover: Point | null = null;
  private mode: SelectionMode = 'new';
  constructor(private c: ToolContext) {}

  private closeTol(): number {
    return 6 / this.c.viewport.canvas.getZoom();
  }

  onDown(p: Point, e: MouseEvent) {
    if (!this.pts.length) this.mode = selectionModeFor(e, this.c.editor.ui.toolOptions.selectionMode);
    else if (this.pts.length >= 3 && Math.hypot(p.x - this.pts[0].x, p.y - this.pts[0].y) <= this.closeTol()) {
      this.finish();
      return;
    }
    const last = this.pts[this.pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) this.pts.push(p);
    this.c.viewport.drawOverlay();
  }

  onMove(p: Point) {
    this.hover = p;
    if (this.pts.length) this.c.viewport.drawOverlay();
  }

  onDblClick() {
    this.finish();
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.pts.length) return false;
    if (e.key === 'Enter') {
      this.finish();
      return true;
    }
    if (e.key === 'Escape') {
      this.pts = [];
      this.c.viewport.drawOverlay();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.pts.pop();
      this.c.viewport.drawOverlay();
      return true;
    }
    return false;
  }

  /** Close the polygon and make it the selection (or combine with it). */
  finish() {
    const pts = this.pts;
    this.pts = [];
    if (pts.length >= 3) setSelection(this.c.editor, pointsToPath(pts), this.mode);
    this.c.viewport.drawOverlay();
  }

  deactivate() {
    this.pts = [];
  }

  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (!this.pts.length) return;
    const pts = this.hover ? [...this.pts, this.hover] : this.pts;
    ctx.save();
    ctx.lineWidth = 1 / z;
    for (const [style, dash] of [['rgba(0,0,0,0.7)', [] as number[]], ['#ffffff', [3 / z, 3 / z]]] as const) {
      ctx.strokeStyle = style;
      ctx.setLineDash(dash as number[]);
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
    }
    // the start point: click it to close
    const r = 4 / z;
    ctx.setLineDash([]);
    ctx.fillStyle = this.c.viewport.overlayColors.handle;
    ctx.fillRect(this.pts[0].x - r, this.pts[0].y - r, 2 * r, 2 * r);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Magic wand

export function magicWandSelect(ed: Editor, p: Point, mode: SelectionMode): boolean {
  const o = ed.ui.toolOptions;
  const r = activeRaster(ed);
  const view = o.wandAllLayers || !r ? pageSample(ed) : layerSample(ed, r);
  if (!view) return false;
  const q = apply(view.toPixel, p);
  const x = Math.floor(q.x);
  const y = Math.floor(q.y);
  if (x < 0 || y < 0 || x >= view.width || y >= view.height) return false;
  const px: Pixels = { width: view.width, height: view.height, data: view.data };
  const mask = floodMask(px, x, y, o.wandTolerance, o.wandContiguous);
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  const d = maskToWorldPath(mask, view);
  setSelection(ed, d, mode);
  ed.setUi({ status: `Magic wand: ${n.toLocaleString('en-GB')} px at tolerance ${Math.round(o.wandTolerance)}` });
  return !!d;
}

export class MagicWandTool implements Tool {
  cursor = CROSS;
  constructor(private c: ToolContext) {}
  onDown(p: Point, e: MouseEvent) {
    const ed = this.c.editor;
    magicWandSelect(ed, p, selectionModeFor(e, ed.ui.toolOptions.selectionMode));
    this.c.viewport.drawOverlay();
  }
}

// ---------------------------------------------------------------------------
// Retouch brushes

type RetouchKind = Extract<ToolId, 'clone' | 'heal' | 'spot-heal' | 'dodge' | 'burn' | 'smudge'>;

const RETOUCH_LABEL: Record<RetouchKind, string> = {
  clone: 'Clone', heal: 'Heal', 'spot-heal': 'Spot heal', dodge: 'Dodge', burn: 'Burn', smudge: 'Smudge',
};

/** Clone / heal offset kept between strokes while "aligned" is on (per source). */
let alignedOffset: { key: string; ox: number; oy: number } | null = null;

export class RetouchTool implements Tool {
  cursor = CROSS;
  private node: RasterNode | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private img: ImageData | null = null;
  private work: Pixels | null = null;
  private src: Pixels | null = null;
  private sel: Uint8ClampedArray | null = null;
  private toPx: ((p: Point) => Point) | null = null;
  private pxScale = 1;
  private last: Point | null = null;
  private offset = { ox: 0, oy: 0 };
  private smudge: SmudgeState | null = null;
  private mouse: Point | null = null;
  private dirty = false;
  constructor(private c: ToolContext, private kind: RetouchKind) {}

  private size(): number {
    return this.c.editor.ui.toolOptions.retouchSize;
  }

  onDown(p: Point, e: MouseEvent) {
    const ed = this.c.editor;
    const needsSource = this.kind === 'clone' || this.kind === 'heal';
    if (needsSource && e.altKey) {
      ed.setUi({ cloneSource: { x: p.x, y: p.y }, status: 'Source set · drag to paint from it' });
      alignedOffset = null;
      this.c.viewport.drawOverlay();
      return;
    }
    const r = activeRaster(ed);
    if (!r) return ed.setUi({ status: `Select a pixel layer to ${RETOUCH_LABEL[this.kind].toLowerCase()}` });
    if (r.locked) return ed.setUi({ status: `${r.name} is locked` });
    if (needsSource && !ed.ui.cloneSource) return ed.setUi({ status: 'Alt-click to set a source point first' });
    const doc = ed.doc!;
    const base = ed.assets.get(r.assetId);
    if (!base) return;
    const m = layerPixelMatrix(doc, r, base.width, base.height);
    if (!m) return;
    this.node = r;
    this.canvas = createCanvas(base.width, base.height);
    const ctx = ctx2d(this.canvas);
    ctx.drawImage(base, 0, 0);
    this.img = ctx.getImageData(0, 0, base.width, base.height);
    this.work = { width: base.width, height: base.height, data: this.img.data };
    this.src = { width: base.width, height: base.height, data: new Uint8ClampedArray(this.img.data) };
    this.sel = selectionCoverage(ed.ui.pixelSelection, ed.ui.pixelSelectionFeather, m, base.width, base.height);
    this.toPx = (q) => apply(m, q);
    this.pxScale = pixelScale(m);
    const start = this.toPx(p);
    if (needsSource) {
      const s = this.toPx(ed.ui.cloneSource!);
      const key = `${r.id}:${ed.ui.cloneSource!.x}:${ed.ui.cloneSource!.y}`;
      if (ed.ui.toolOptions.cloneAligned && alignedOffset?.key === key) this.offset = { ox: alignedOffset.ox, oy: alignedOffset.oy };
      else {
        this.offset = { ox: s.x - start.x, oy: s.y - start.y };
        alignedOffset = { key, ...this.offset };
      }
    }
    this.smudge = this.kind === 'smudge' ? createSmudge((this.size() * this.pxScale) / 2) : null;
    this.c.viewport.livePaint = { nodeId: r.id, canvas: this.canvas };
    this.last = start;
    this.dab(start);
    this.flush();
  }

  private dab(pt: Point) {
    const o = this.c.editor.ui.toolOptions;
    const pr = penPressure();
    const dab: Dab = {
      x: pt.x,
      y: pt.y,
      r: Math.max(0.5, ((this.size() * this.pxScale) / 2) * (o.pressureSize ? Math.max(0.05, pr) : 1)),
      hardness: o.brushHardness,
      alpha: Math.max(0.01, o.brushFlow * o.brushOpacity * (o.pressureFlow ? pr : 1)),
    };
    const w = this.work!;
    switch (this.kind) {
      case 'clone': cloneDab(w, this.src!, dab, this.offset.ox, this.offset.oy, this.sel); break;
      case 'heal': healDab(w, this.src!, dab, this.offset.ox, this.offset.oy, this.sel); break;
      case 'spot-heal': spotHealDab(w, dab, this.sel); break;
      case 'dodge': dodgeBurnDab(w, dab, false, o.toneRange, o.toneExposure * 0.25, this.sel); break;
      case 'burn': dodgeBurnDab(w, dab, true, o.toneRange, o.toneExposure * 0.25, this.sel); break;
      case 'smudge': smudgeDab(w, this.smudge!, dab, o.smudgeStrength, this.sel); break;
    }
    this.dirty = true;
  }

  private flush() {
    if (!this.canvas || !this.img) return;
    ctx2d(this.canvas).putImageData(this.img, 0, 0);
    this.c.viewport.render();
  }

  onMove(p: Point) {
    this.mouse = p;
    if (!this.toPx || !this.last) {
      this.c.viewport.drawOverlay();
      return;
    }
    const q = this.toPx(p);
    const dist = Math.hypot(q.x - this.last.x, q.y - this.last.y);
    const spacing = Math.max(1, this.size() * this.pxScale * (this.kind === 'smudge' ? 0.08 : 0.2));
    if (dist < spacing) return;
    const steps = Math.floor(dist / spacing);
    for (let i = 1; i <= steps; i++) {
      const t = (i * spacing) / dist;
      this.dab({ x: this.last.x + (q.x - this.last.x) * t, y: this.last.y + (q.y - this.last.y) * t });
    }
    const t = (steps * spacing) / dist;
    this.last = { x: this.last.x + (q.x - this.last.x) * t, y: this.last.y + (q.y - this.last.y) * t };
    this.flush();
  }

  onUp() {
    const ed = this.c.editor;
    if (this.node && this.canvas && this.dirty) {
      this.flush();
      this.c.viewport.livePaint = null;
      commitRasterCanvas(ed, this.node.id, this.canvas, RETOUCH_LABEL[this.kind]);
    }
    this.c.viewport.livePaint = null;
    this.node = null;
    this.canvas = null;
    this.img = null;
    this.work = this.src = null;
    this.sel = null;
    this.toPx = null;
    this.last = null;
    this.smudge = null;
    this.dirty = false;
  }

  deactivate() {
    this.c.viewport.livePaint = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    const ed = this.c.editor;
    if (this.mouse) drawBrushCursor(ctx, this.mouse, this.size(), z);
    const s = ed.ui.cloneSource;
    if ((this.kind === 'clone' || this.kind === 'heal') && s) {
      // source crosshair (follows the brush while painting)
      let at = s;
 if (this.last && this.toPx && this.mouse) {
        at = { x: this.mouse.x + this.offset.ox / this.pxScale, y: this.mouse.y + this.offset.oy / this.pxScale };
      }
      const k = 7 / z;
      ctx.save();
      ctx.lineWidth = 1.5 / z;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.moveTo(at.x - k, at.y);
      ctx.lineTo(at.x + k, at.y);
      ctx.moveTo(at.x, at.y - k);
      ctx.lineTo(at.x, at.y + k);
      ctx.stroke();
      ctx.lineWidth = 1 / z;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Liquify (modal on the active pixel layer: Apply / Cancel in the context bar)

interface LiquifySession {
  nodeId: Id;
  src: Pixels;
  field: Field;
  canvas: HTMLCanvasElement;
  img: ImageData;
  out: Pixels;
  dirty: boolean;
}

let session: LiquifySession | null = null;
let sessionViewport: ToolContext['viewport'] | null = null;

export function liquifyActive(): boolean {
  return !!session?.dirty;
}

function startSession(c: ToolContext, r: RasterNode): LiquifySession | null {
  const base = c.editor.assets.get(r.assetId);
  if (!base) return null;
  const canvas = createCanvas(base.width, base.height);
  const ctx = ctx2d(canvas);
  ctx.drawImage(base, 0, 0);
  const img = ctx.getImageData(0, 0, base.width, base.height);
  const src: Pixels = { width: base.width, height: base.height, data: new Uint8ClampedArray(img.data) };
  sessionViewport = c.viewport;
  return { nodeId: r.id, src, field: createField(base.width, base.height), canvas, img, out: { width: base.width, height: base.height, data: img.data }, dirty: false };
}

/** Bake the warp into the layer (one undo step). */
export function applyLiquify(ed: Editor): boolean {
  const s = session;
  session = null;
  if (sessionViewport) sessionViewport.livePaint = null;
  if (!s || !s.dirty) return false;
  ctx2d(s.canvas).putImageData(s.img, 0, 0);
  commitRasterCanvas(ed, s.nodeId, s.canvas, 'Liquify');
  return true;
}

/** Throw the warp away. */
export function cancelLiquify(): void {
  session = null;
  if (sessionViewport) {
    sessionViewport.livePaint = null;
    sessionViewport.render();
  }
}

export class LiquifyTool implements Tool {
  cursor = CROSS;
  private last: Point | null = null;
  private toPx: ((p: Point) => Point) | null = null;
  private pxScale = 1;
  private mouse: Point | null = null;
  constructor(private c: ToolContext) {}

  onDown(p: Point) {
    const ed = this.c.editor;
    const r = activeRaster(ed);
    if (!r) return ed.setUi({ status: 'Select a pixel layer to liquify' });
    if (r.locked) return ed.setUi({ status: `${r.name} is locked` });
    if (!session || session.nodeId !== r.id) {
      if (session?.dirty) applyLiquify(ed);
      session = startSession(this.c, r);
    }
    if (!session) return;
    const m = layerPixelMatrix(ed.doc!, r, session.src.width, session.src.height);
    if (!m) return;
    this.toPx = (q) => apply(m, q);
    this.pxScale = pixelScale(m);
    this.last = this.toPx(p);
    this.c.viewport.livePaint = { nodeId: r.id, canvas: session.canvas };
    if (ed.ui.toolOptions.liquifyMode !== 'push') this.dab(this.last, 0, 0);
  }

  private dab(q: Point, vx: number, vy: number) {
    const s = session!;
    const o = this.c.editor.ui.toolOptions;
    const radius = ((o.liquifySize * this.pxScale) / 2) * (o.pressureSize ? Math.max(0.1, penPressure()) : 1);
    applyDab(s.field, o.liquifyMode, { x: q.x, y: q.y, radius, strength: o.liquifyStrength, vx, vy });
    const rect = { x: q.x - radius - Math.abs(vx) - 2, y: q.y - radius - Math.abs(vy) - 2, w: 2 * radius + 2 * Math.abs(vx) + 4, h: 2 * radius + 2 * Math.abs(vy) + 4 };
    warp(s.src, s.field, s.out, rect);
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    ctx2d(s.canvas).putImageData(s.img, 0, 0, x, y, Math.ceil(rect.w) + 1, Math.ceil(rect.h) + 1);
    s.dirty = true;
    this.c.viewport.render();
  }

  onMove(p: Point) {
    this.mouse = p;
    if (!this.toPx || !this.last || !session) {
      this.c.viewport.drawOverlay();
      return;
    }
    const q = this.toPx(p);
    const o = this.c.editor.ui.toolOptions;
    const radius = (o.liquifySize * this.pxScale) / 2;
    const spacing = Math.max(1, radius * 0.15);
    const dist = Math.hypot(q.x - this.last.x, q.y - this.last.y);
    if (dist < spacing) {
      this.c.viewport.drawOverlay();
      return;
    }
    const steps = Math.ceil(dist / spacing);
    const vx = (q.x - this.last.x) / steps;
    const vy = (q.y - this.last.y) / steps;
    for (let i = 1; i <= steps; i++) {
      const at = { x: this.last.x + vx * i, y: this.last.y + vy * i };
      this.dab(at, o.liquifyMode === 'push' ? vx : 0, o.liquifyMode === 'push' ? vy : 0);
    }
    this.last = q;
  }

  onUp() {
    this.last = null;
    this.toPx = null;
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Enter') {
      applyLiquify(this.c.editor);
      return true;
    }
    if (e.key === 'Escape' && session) {
      cancelLiquify();
      return true;
    }
    return false;
  }

  deactivate() {
    // leaving the tool keeps the work (Affinity applies when leaving the persona)
    if (session?.dirty) applyLiquify(this.c.editor);
    else cancelLiquify();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (this.mouse) drawBrushCursor(ctx, this.mouse, this.c.editor.ui.toolOptions.liquifySize, z);
  }
}

