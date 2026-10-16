/**
 * Interactive tools. Each tool receives scene (document) coordinates from the
 * viewport and turns gestures into model commits.
 */
import { apply, invert, boundsOfPoints, type Point } from '../../core/geometry';
import type { GradientPaint } from '../../core/types';
import { hairline } from './hairline';
import { findNode, make, makeStroke, solid, NO_PAINT, worldMatrix, nodeToPath } from '../../core/document';
import { addNodes, indexAbove, addTextFrame, convertToCurves, updateNode, removeNodes } from '../../core/commands';
import {
  centrePath, ellipsePath, pathToString, pathToSubpaths, polygonPoints, pointsToPath, rectPath, starPoints,
  subpathsToPath, transformPath, translatePath, type Anchor, type Subpath,
} from '../../core/path';
import { booleanPaths } from '../../core/boolean';
import {
  bendSegment, breakAt, closeSubpath, deleteNodes, dragHandle, insertNode, joinSelected, moveNodes, nearestOnPath, nodeKind, nodesInRect,
  reversePath, setNodeKind, type NodeKind, type NodeRef,
} from '../../core/pathEdit';
import { addArtboard, artboardAt, reparentToArtboards } from '../../core/artboards';
import { gradientHandles, insertStop, isGradient, setGradientHandles } from '../../core/gradient';
import { shapeBox } from '../../core/vectorExpand';
import { getPaint, setPaint } from '../../core/paintAccess';
import { publishNodeEdit, setNodeActionHandler, type NodeAction } from '../state/nodeEdit';
import { toast } from '../state/bus';
import { floodMask } from '../../core/pixels';
import type { PathCommand, PathNode, SceneNode, RasterNode, QuvreloDocument } from '../../core/types';
import type { Editor, ToolId } from '../state/editor';
import type { Viewport } from './Viewport';
import { cloneCanvas, createCanvas, ctx2d, canvasToPixels } from './assets';
import {
  activeRaster, commitRasterCanvas, createPixelLayer, editRaster, makeDab, parseColor, selectionInPixels, toHex, worldToPixelMatrix,
} from './pixelOps';
import { drawPage, renderLocalBounds } from './draw';
import { runCommand } from '../state/commands';
import {
  CROP_HANDLES, cursorFor, handlePoints, hitCrop, moveWithin, rectFromDrag, resizeCrop, roundCrop, type CropHit, type CropRect,
} from '../../core/crop';
import { currentCrop, currentRatio, docBounds, setCropBox } from '../state/crop';
import { uiPaint } from '../state/uiPaint';
import { HANDLE_SIZE } from './controls';
import { objectSelectClick, objectSelectMarkers } from './objectSelect';

export interface ToolContext {
  viewport: Viewport;
  editor: Editor;
}

export interface Tool {
  cursor?: string;
  onDown?(p: Point, e: MouseEvent, target: SceneNode | null): void;
  onMove?(p: Point, e: MouseEvent): void;
  onUp?(p: Point, e: MouseEvent): void;
  onDblClick?(p: Point, e: MouseEvent, target: SceneNode | null): void;
  onKey?(e: KeyboardEvent): boolean;
  drawOverlay?(ctx: CanvasRenderingContext2D, zoom: number): void;
  /** Draw in screen space (CSS px, origin at the viewport's top-left). */
  drawScreenOverlay?(ctx: CanvasRenderingContext2D): void;
  deactivate?(): void;
}

const CROSS = 'crosshair';

function containerId(ed: Editor): string {
  return ed.activeContainer!.id;
}

function currentFill(ed: Editor) {
  return uiPaint(ed.ui, 'fill');
}

function currentStroke(ed: Editor, force = false) {
  if (ed.ui.strokeEnabled) return { ...makeStroke(ed.ui.strokeColor, ed.ui.toolOptions.strokeWidth), paint: uiPaint(ed.ui, 'stroke') };
  if (force) return makeStroke(ed.ui.strokeColor, ed.ui.toolOptions.strokeWidth);
  return makeStroke();
}

function addAndSelect(ed: Editor, node: SceneNode, label: string): void {
  // Photo: a shape becomes a vector layer directly above the active layer (Vector/Layout: on top)
  const at = ed.ui.studio === 'photo' ? indexAbove(ed.activeContainer?.nodes ?? [], ed.targetIds()) : undefined;
  const cid = containerId(ed);
  // Vector: drawn over an artboard, it goes onto that board
  ed.commit(label, (d) => {
    const added = addNodes(d, cid, [node], at);
    return ed.ui.studio === 'vector' && d.pages.some((p) => p.id === cid) ? reparentToArtboards(added, [node.id], cid) : added;
  });
  ed.select([node.id]);
}

// ---------------------------------------------------------------------------

class MoveTool implements Tool {
  cursor = 'default';
  constructor(private c: ToolContext) {}
  onDblClick(_p: Point, _e: MouseEvent, target: SceneNode | null) {
    if (!target) return;
    const { viewport, editor } = this.c;
    if (target.type === 'text' || target.type === 'textframe') viewport.textEdit.begin(target.id);
    else if (target.type === 'imageframe') {
      editor.select([target.id]);
      runCommand('file.place');
    } else if (['rect', 'ellipse', 'polygon', 'star', 'path'].includes(target.type)) {
      editor.select([target.id]);
      editor.setTool('node');
    }
  }
}

class HandTool implements Tool {
  cursor = 'grab';
}

class ZoomTool implements Tool {
  cursor = 'zoom-in';
  private start: Point | null = null;
  private cur: Point | null = null;
  constructor(private c: ToolContext) {}
  onDown(p: Point) {
    this.start = p;
    this.cur = p;
  }
  onMove(p: Point) {
    if (!this.start) return;
    this.cur = p;
    this.c.viewport.drawOverlay();
  }
  onUp(p: Point, e: MouseEvent) {
    const vp = this.c.viewport;
    const s = this.start;
    this.start = null;
    if (!s) return;
    const r = boundsOfPoints([s, p]);
    if (r.w * vp.canvas.getZoom() > 8 && r.h * vp.canvas.getZoom() > 8) vp.zoomToRect(r);
    else {
      const sp = vp.sceneToScreen(p.x, p.y);
      vp.zoomBy(e.altKey ? 1 / 1.6 : 1.6, sp);
    }
    vp.drawOverlay();
  }
  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (!this.start || !this.cur) return;
    const r = boundsOfPoints([this.start, this.cur]);
    ctx.strokeStyle = '#2fb8a6';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([4 / z, 3 / z]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
  }
}

/** Drag-to-create tool for shapes and frames. */
class ShapeTool implements Tool {
  cursor = CROSS;
  private start: Point | null = null;
  private cur: Point | null = null;
  private constrain = false;
  private fromCentre = false;
  constructor(private c: ToolContext, private kind: ToolId) {}

  private rect() {
    const s = this.start!;
    const p = this.cur!;
    let w = p.x - s.x;
    let h = p.y - s.y;
    if (this.constrain && this.kind !== 'line' && this.kind !== 'arrow') {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }
    if (this.fromCentre) return { x: s.x - Math.abs(w), y: s.y - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 };
    return { x: Math.min(s.x, s.x + w), y: Math.min(s.y, s.y + h), w: Math.abs(w), h: Math.abs(h) };
  }

  private lineEnd(): Point {
    const s = this.start!;
    const p = this.cur!;
    if (!this.constrain) return p;
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: s.x + Math.cos(ang) * len, y: s.y + Math.sin(ang) * len };
  }

  onDown(p: Point, e: MouseEvent, target: SceneNode | null) {
    if (this.kind === 'textframe' && target?.type === 'textframe') {
      this.c.viewport.textEdit.begin(target.id);
      return;
    }
    if (this.kind === 'imageframe' && target?.type === 'imageframe') {
      this.c.editor.select([target.id]);
      return;
    }
    this.start = p;
    this.cur = p;
    this.constrain = e.shiftKey;
    this.fromCentre = e.altKey;
  }
  onMove(p: Point, e: MouseEvent) {
    if (!this.start) return;
    this.cur = p;
    this.constrain = e.shiftKey;
    this.fromCentre = e.altKey;
    this.c.viewport.drawOverlay();
  }
  onUp(p: Point) {
    if (!this.start) return;
    this.cur = p;
    const ed = this.c.editor;
    const opts = ed.ui.toolOptions;
    let r = this.rect();
    const z = this.c.viewport.canvas.getZoom();
    const clicked = r.w * z < 4 && r.h * z < 4;
    const s = this.start;
    this.start = null;
    if (clicked && this.kind !== 'textframe' && this.kind !== 'imageframe') {
      this.c.viewport.drawOverlay();
      return;
    }
    if (clicked) r = { x: s.x, y: s.y, w: this.kind === 'textframe' ? 320 : 300, h: this.kind === 'textframe' ? 160 : 200 };
    const base = { x: r.x + r.w / 2, y: r.y + r.h / 2, w: Math.max(1, r.w), h: Math.max(1, r.h) };
    const fill = currentFill(ed);
    const stroke = currentStroke(ed);
    switch (this.kind) {
      case 'rect':
        addAndSelect(ed, make.rect({ ...base, radius: opts.cornerRadius, fill, stroke }), 'Rectangle');
        break;
      case 'rrect':
        addAndSelect(ed, make.rect({ ...base, name: 'Rounded Rectangle', radius: opts.roundRadius, fill, stroke }), 'Rounded rectangle');
        break;
      case 'ellipse':
        addAndSelect(ed, make.ellipse({ ...base, fill, stroke }), 'Ellipse');
        break;
      case 'polygon':
        addAndSelect(ed, make.polygon({ ...base, sides: opts.polygonSides, fill, stroke }), 'Polygon');
        break;
      case 'star':
        addAndSelect(ed, make.star({ ...base, points: opts.starPoints, innerRatio: opts.starInner, fill, stroke }), 'Star');
        break;
      case 'line':
      case 'arrow': {
        const e = this.lineEnd();
        const cx = (s.x + e.x) / 2;
        const cy = (s.y + e.y) / 2;
        // a line or arrow is all stroke: it takes the stroke chip's colour even
        // while new shapes get no stroke (it used to borrow the mid-grey fill,
        // which drew a faint arrow with a barely visible head)
        const color = ed.ui.strokeColor;
        const arrow = this.kind === 'arrow';
        addAndSelect(ed, make.path({
          name: arrow ? 'Arrow' : 'Line', x: cx, y: cy, d: [['M', s.x - cx, s.y - cy], ['L', e.x - cx, e.y - cy]],
          stroke: { ...makeStroke(color, Math.max(1, opts.strokeWidth)), cap: 'round', ...(arrow ? { endArrow: 'triangle' as const } : {}) },
        }), arrow ? 'Arrow' : 'Line');
        break;
      }
      case 'imageframe':
        addAndSelect(ed, make.imageframe({ ...base, fill: solid('#e8ecf2') }), 'Picture frame');
        break;
      case 'textframe': {
        let id = '';
        ed.commit('Text frame', (d) => {
          const res = addTextFrame(d, containerId(ed), base, '', { fontFamily: opts.fontFamily, fontSize: Math.max(8, Math.round(opts.fontSize / 3)) });
          id = res.id;
          return res.doc;
        });
        ed.select([id]);
        this.c.viewport.textEdit.begin(id);
        break;
      }
    }
    this.c.viewport.drawOverlay();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (!this.start || !this.cur) return;
    const r = this.rect();
    const opts = this.c.editor.ui.toolOptions;
    ctx.save();
    ctx.strokeStyle = '#2fb8a6';
    ctx.fillStyle = 'rgba(47,184,166,0.12)';
    ctx.lineWidth = 1.5 / z;
    let d: PathCommand[];
    switch (this.kind) {
      case 'ellipse': d = ellipsePath(r.w, r.h); break;
      case 'polygon': d = pointsToPath(polygonPoints(r.w, r.h, opts.polygonSides)); break;
      case 'star': d = pointsToPath(starPoints(r.w, r.h, opts.starPoints, opts.starInner)); break;
      case 'line':
      case 'arrow': {
        const e = this.lineEnd();
        ctx.beginPath();
        ctx.moveTo(this.start.x, this.start.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
        ctx.restore();
        return;
      }
      default: d = rectPath(r.w, r.h, this.kind === 'rect' ? opts.cornerRadius : this.kind === 'rrect' ? opts.roundRadius : 0);
    }
    const p = new Path2D(pathToString(translatePath(d, r.x + r.w / 2, r.y + r.h / 2)));
    ctx.fill(p);
    ctx.stroke(p);
    ctx.fillStyle = '#2fb8a6';
    ctx.font = `${11 / z}px Inter, sans-serif`;
    ctx.fillText(`${Math.round(r.w)} × ${Math.round(r.h)}`, r.x + r.w + 6 / z, r.y + r.h + 14 / z);
    ctx.restore();
  }
}

class TextTool implements Tool {
  cursor = 'text';
  constructor(private c: ToolContext) {}
  onDown(p: Point, _e: MouseEvent, target: SceneNode | null) {
    const { editor: ed, viewport } = this.c;
    if (target && (target.type === 'text' || target.type === 'textframe')) {
      viewport.textEdit.begin(target.id);
      return;
    }
    if (viewport.textEdit.active) {
      viewport.textEdit.end();
      return;
    }
    const opts = ed.ui.toolOptions;
    const node = make.text({
      x: p.x, y: p.y, text: '',
      style: { ...make.text().style, fontFamily: opts.fontFamily, fontSize: opts.fontSize, fill: solid(ed.ui.fillEnabled ? ed.ui.fillColor : '#1b1b1f') },
      name: 'Artistic Text',
    });
    ed.commit('Artistic text', (d) => addNodes(d, containerId(ed), [node]));
    viewport.textEdit.begin(node.id);
  }
}

// ---------------------------------------------------------------------------
// Pen & pencil

/** Snap the vector from `o` to `p` to the nearest 45°. */
function snap45(o: Point, p: Point): Point {
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: o.x + Math.cos(ang) * len, y: o.y + Math.sin(ang) * len };
}

/**
 * Pen tool: click for a sharp node, drag for a smooth one (Alt while dragging
 * makes a cusp: only the outgoing handle moves), Shift snaps to 45°. Click the
 * first node to close; Enter / Esc / double-click finishes an open curve.
 * Starting on an end node of the selected open curve continues that curve.
 */
class PenTool implements Tool {
  cursor = CROSS;
  private anchors: Anchor[] = [];
  private dragging = false;
  private mouse: Point | null = null;
  /** continuing an existing curve: its node id, the other subpaths and where ours sits */
  private cont: { id: string; others: Subpath[]; index: number } | null = null;
  constructor(private c: ToolContext) {}

  private tryContinue(p: Point): boolean {
    const ed = this.c.editor;
    const doc = ed.doc;
    const n = ed.selectedNodes()[0];
    if (!doc || !n || n.type !== 'path' || ed.selectedNodes().length !== 1) return false;
    const loc = findNode(doc, n.id)!;
    const subs = pathToSubpaths(transformPath(n.d, worldMatrix(loc)));
    const r = 8 / this.c.viewport.canvas.getZoom();
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      if (s.closed || s.anchors.length < 2) continue;
      const first = s.anchors[0];
      const last = s.anchors[s.anchors.length - 1];
      const atEnd = Math.hypot(p.x - last.x, p.y - last.y) < r;
      const atStart = Math.hypot(p.x - first.x, p.y - first.y) < r;
      if (!atEnd && !atStart) continue;
      this.anchors = (atEnd ? s : reversePath([s])[0]).anchors.map((a) => ({ ...a }));
      this.cont = { id: n.id, others: subs.filter((_, j) => j !== i), index: i };
      return true;
    }
    return false;
  }

  onDown(p: Point, e: MouseEvent) {
    if (!this.anchors.length && this.tryContinue(p)) {
      this.dragging = true;
      this.c.viewport.drawOverlay();
      return;
    }
    const first = this.anchors[0];
    const z = this.c.viewport.canvas.getZoom();
    if (first && this.anchors.length > 2 && Math.hypot(p.x - first.x, p.y - first.y) < 8 / z) {
      this.finish(true);
      return;
    }
    const prev = this.anchors[this.anchors.length - 1];
    const q = prev && e.shiftKey ? snap45(prev, p) : p;
    this.anchors.push({ x: q.x, y: q.y, inX: null, inY: null, outX: null, outY: null });
    this.dragging = true;
  }
  onMove(p: Point, e: MouseEvent) {
    this.mouse = p;
    if (this.dragging) {
      const a = this.anchors[this.anchors.length - 1];
      const q = e.shiftKey ? snap45(a, p) : p;
      if (Math.hypot(q.x - a.x, q.y - a.y) > 2) {
        a.outX = q.x;
        a.outY = q.y;
        // Alt: cusp, the incoming handle stays where it was
        if (!e.altKey) {
          a.inX = 2 * a.x - q.x;
          a.inY = 2 * a.y - q.y;
        }
      }
    }
    this.c.viewport.drawOverlay();
  }
  onUp() {
    this.dragging = false;
  }
  onDblClick() {
    // the double-click's second mousedown added a duplicate anchor
    if (this.anchors.length > 1) this.anchors.pop();
    this.finish(false);
  }
  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      this.finish(false);
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.anchors.pop();
      this.c.viewport.drawOverlay();
      return true;
    }
    return false;
  }
  finish(closed: boolean) {
    const ed = this.c.editor;
    if (this.cont && this.anchors.length >= 2) {
      const { id, others, index } = this.cont;
      const doc = ed.doc;
      const loc = doc ? findNode(doc, id) : null;
      if (doc && loc) {
        const mine: Subpath = { anchors: this.anchors, closed };
        const subs = [...others];
        subs.splice(index, 0, mine);
        const local = transformPath(subpathsToPath(subs), invert(worldMatrix(loc)));
        ed.commit('Pen', (d) => updateNode<PathNode>(d, id, { d: local, closed: subs.some((x) => x.closed) }));
      }
    } else if (this.anchors.length >= 2) {
      const d = subpathsToPath([{ anchors: this.anchors, closed }]);
      const c = centrePath(d);
      const node = make.path({
        x: c.cx, y: c.cy, d: c.d, closed,
        fill: closed ? currentFill(ed) : NO_PAINT,
        stroke: currentStroke(ed, true),
        name: closed ? 'Shape' : 'Curve',
      });
      addAndSelect(ed, node, 'Pen');
    }
    this.anchors = [];
    this.cont = null;
    this.c.viewport.drawOverlay();
  }
  deactivate() {
    if (this.anchors.length >= 2) this.finish(false);
    this.anchors = [];
    this.cont = null;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (!this.anchors.length) return;
    ctx.save();
    const d = subpathsToPath([{ anchors: this.anchors, closed: false }]);
    ctx.strokeStyle = '#2fb8a6';
    ctx.lineWidth = 1.5 / z;
    ctx.stroke(new Path2D(pathToString(d)));
    const last = this.anchors[this.anchors.length - 1];
    if (this.mouse && !this.dragging) {
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      if (last.outX !== null) ctx.quadraticCurveTo(last.outX, last.outY!, this.mouse.x, this.mouse.y);
      else ctx.lineTo(this.mouse.x, this.mouse.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawAnchors(ctx, this.anchors, z, -1);
    ctx.restore();
  }
}

function drawAnchors(ctx: CanvasRenderingContext2D, anchors: Anchor[], z: number, selected: number) {
  const s = 7 / z;
  anchors.forEach((a, i) => {
    ctx.strokeStyle = '#2fb8a6';
    ctx.lineWidth = 1 / z;
    for (const [hx, hy] of [[a.inX, a.inY], [a.outX, a.outY]]) {
      if (hx === null || hy === null) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(hx, hy, s / 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = i === selected ? '#2fb8a6' : '#ffffff';
    ctx.fillRect(a.x - s / 2, a.y - s / 2, s, s);
    ctx.strokeRect(a.x - s / 2, a.y - s / 2, s, s);
  });
}

class PencilTool implements Tool {
  cursor = CROSS;
  private pts: Point[] = [];
  constructor(private c: ToolContext) {}
  onDown(p: Point) {
    this.pts = [p];
  }
  onMove(p: Point) {
    if (!this.pts.length) return;
    this.pts.push(p);
    this.c.viewport.drawOverlay();
  }
  onUp() {
    const ed = this.c.editor;
    if (this.pts.length > 2) {
      const z = this.c.viewport.canvas.getZoom();
      const simple = simplify(this.pts, 1.5 / z);
      const d = smoothPath(simple);
      const c = centrePath(d);
      addAndSelect(ed, make.path({ x: c.cx, y: c.cy, d: c.d, stroke: { ...currentStroke(ed, true), cap: 'round', join: 'round' }, name: 'Pencil' }), 'Pencil');
    }
    this.pts = [];
    this.c.viewport.drawOverlay();
  }
  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (this.pts.length < 2) return;
    ctx.strokeStyle = this.c.editor.ui.strokeColor;
    ctx.lineWidth = Math.max(1 / z, this.c.editor.ui.toolOptions.strokeWidth);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.pts[0].x, this.pts[0].y);
    for (const p of this.pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplify(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const pa = pts[a];
    const pb = pts[b];
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pb.x - pa.x) * (pa.y - pts[i].y) - (pa.x - pts[i].x) * (pb.y - pa.y)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Catmull-Rom spline through points, as cubic beziers. */
export function smoothPath(pts: Point[]): PathCommand[] {
  const d: PathCommand[] = [['M', pts[0].x, pts[0].y]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d.push(['C', p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y]);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Node tool

type NodeHit = { sub: number; anchor: number; part: 'anchor' | 'in' | 'out' };

type NodeDrag =
  | { mode: 'handle'; hit: NodeHit; kind: NodeKind | 'free' }
  | { mode: 'nodes'; last: Point; start: Point }
  | { mode: 'segment'; sub: number; segment: number; t: number; start: Point; base: Subpath[] }
  | { mode: 'marquee'; start: Point; cur: Point; additive: boolean };

const refKey = (r: NodeRef) => `${r.sub}:${r.anchor}`;

/**
 * Node tool (Affinity Designer's): edit a path's nodes and handles.
 *  - click / Shift-click / drag a marquee to select nodes; drag them to move
 *  - drag a handle (Alt breaks a smooth node into a cusp)
 *  - click a segment to add a node there; drag a segment to bend it
 *  - double-click a node: sharp ↔ smooth; Delete removes nodes; arrows nudge
 *  - context bar / Layer menu: sharp, smooth, symmetric, break, join, close, reverse
 * Shapes (rectangle, ellipse, …) and compounds become curves on the first edit.
 */
class NodeTool implements Tool {
  cursor = 'default';
  private subs: Subpath[] | null = null; // in world coordinates
  private nodeId: string | null = null;
  private loadedDoc: unknown = null;
  private drag: NodeDrag | null = null;
  private selected: NodeRef[] = [];
  private moved = false;
  /** the document before a drag's live previews (undo returns to it) */
  private base: QuvreloDocument | null = null;
  constructor(private c: ToolContext) {
    this.load();
    setNodeActionHandler((a) => this.action(a));
  }

  private load() {
    const ed = this.c.editor;
    const doc = ed.doc;
    const sel = ed.selectedNodes();
    const n = sel[0];
    const prevId = this.nodeId;
    this.subs = null;
    this.nodeId = null;
    this.loadedDoc = doc;
    if (!doc || !n || sel.length !== 1) return this.publish();
    const editable = ['rect', 'ellipse', 'polygon', 'star', 'path'].includes(n.type) || (n.type === 'group' && !!n.compound);
    const d = editable ? nodeToPath(n) : null;
    if (!d) return this.publish();
    const loc = findNode(doc, n.id)!;
    this.nodeId = n.id;
    this.subs = pathToSubpaths(transformPath(d, worldMatrix(loc)));
    if (prevId !== n.id) this.selected = [];
    this.selected = this.selected.filter((r) => this.subs![r.sub]?.anchors[r.anchor]);
    this.publish();
  }

  private publish() {
    if (!this.subs) {
      publishNodeEdit(null);
      return;
    }
    const kinds = new Set(this.selected.map((r) => nodeKind(this.subs![r.sub].anchors[r.anchor])));
    publishNodeEdit({
      active: true,
      selected: this.selected.length,
      total: this.subs.reduce((n, s) => n + s.anchors.length, 0),
      kind: kinds.size === 0 ? null : kinds.size === 1 ? [...kinds][0] : 'mixed',
      openSubpaths: this.subs.filter((s) => !s.closed).length,
    });
  }

  private isSelected(r: NodeRef) {
    return this.selected.some((x) => x.sub === r.sub && x.anchor === r.anchor);
  }

  private tol() {
    return 7 / this.c.viewport.canvas.getZoom();
  }

  private hit(p: Point): NodeHit | null {
    if (!this.subs) return null;
    const r = this.tol();
    for (let s = 0; s < this.subs.length; s++) {
      const anchors = this.subs[s].anchors;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (Math.hypot(p.x - a.x, p.y - a.y) < r) return { sub: s, anchor: i, part: 'anchor' };
      }
    }
    for (let s = 0; s < this.subs.length; s++) {
      const anchors = this.subs[s].anchors;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (a.outX !== null && Math.hypot(p.x - a.outX, p.y - a.outY!) < r) return { sub: s, anchor: i, part: 'out' };
        if (a.inX !== null && Math.hypot(p.x - a.inX, p.y - a.inY!) < r) return { sub: s, anchor: i, part: 'in' };
      }
    }
    return null;
  }

  onDown(p: Point, e: MouseEvent, target: SceneNode | null) {
    if (this.loadedDoc !== this.c.editor.doc && !this.drag) this.load();
    const h = this.hit(p);
    this.moved = false;
    this.base = this.c.editor.doc;
    if (h && this.subs) {
      const ref = { sub: h.sub, anchor: h.anchor };
      if (h.part === 'anchor') {
        if (e.shiftKey) {
          this.selected = this.isSelected(ref) ? this.selected.filter((x) => refKey(x) !== refKey(ref)) : [...this.selected, ref];
        } else if (!this.isSelected(ref)) this.selected = [ref];
        this.drag = { mode: 'nodes', last: p, start: p };
      } else {
        const a = this.subs[h.sub].anchors[h.anchor];
        this.drag = { mode: 'handle', hit: h, kind: e.altKey ? 'free' : nodeKind(a) };
        if (!this.isSelected(ref)) this.selected = [ref];
      }
      this.publish();
      this.c.viewport.drawOverlay();
      return;
    }
    if (this.subs) {
      const near = nearestOnPath(this.subs, p);
      if (near && near.distance < this.tol()) {
        this.drag = { mode: 'segment', sub: near.sub, segment: near.segment, t: near.t, start: p, base: this.subs };
        return;
      }
    }
    if (target && target.id !== this.nodeId) {
      this.c.editor.select([target.id]);
      this.selected = [];
      this.load();
    } else if (this.subs) {
      this.drag = { mode: 'marquee', start: p, cur: p, additive: e.shiftKey };
      if (!e.shiftKey) this.selected = [];
    } else {
      this.c.editor.select([]);
      this.subs = null;
      this.nodeId = null;
      this.publish();
    }
    this.c.viewport.drawOverlay();
  }

  onMove(p: Point, e: MouseEvent) {
    const d = this.drag;
    if (!d || !this.subs) return;
    if (d.mode === 'marquee') {
      d.cur = p;
      this.c.viewport.drawOverlay();
      return;
    }
    if (d.mode === 'nodes') {
      let dx = p.x - d.last.x;
      let dy = p.y - d.last.y;
      if (e.shiftKey) {
        // constrain to the dominant axis from where the drag started
        const tx = p.x - d.start.x;
        const ty = p.y - d.start.y;
        if (Math.abs(tx) > Math.abs(ty)) dy = d.start.y - d.last.y;
        else dx = d.start.x - d.last.x;
      }
      if (!dx && !dy) return;
      this.subs = moveNodes(this.subs, this.selected, dx, dy);
      d.last = { x: d.last.x + dx, y: d.last.y + dy };
    } else if (d.mode === 'handle') {
      const list = this.subs[d.hit.sub].anchors;
      const kind = e.altKey ? 'free' : d.kind;
      if (kind === 'free') d.kind = 'free';
      this.subs = this.subs.map((s, i) => (i !== d.hit.sub ? s : { ...s, anchors: list.map((a, j) => (j === d.hit.anchor ? dragHandle(a, d.hit.part as 'in' | 'out', p, kind) : a)) }));
    } else if (d.mode === 'segment') {
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) < 2 / this.c.viewport.canvas.getZoom() && !this.moved) return;
      this.subs = bendSegment(d.base, d.sub, d.segment, d.t, p);
    }
    this.moved = true;
    this.apply(true);
  }

  onUp() {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.subs) return;
    if (d.mode === 'marquee') {
      const r = { x: Math.min(d.start.x, d.cur.x), y: Math.min(d.start.y, d.cur.y), w: Math.abs(d.cur.x - d.start.x), h: Math.abs(d.cur.y - d.start.y) };
      const inside = nodesInRect(this.subs, r);
      const keys = new Set(this.selected.map(refKey));
      this.selected = d.additive ? [...this.selected, ...inside.filter((x) => !keys.has(refKey(x)))] : inside;
      this.publish();
      this.c.viewport.drawOverlay();
      return;
    }
    if (d.mode === 'segment' && !this.moved) {
      const r = insertNode(this.subs, d.sub, d.segment, d.t);
      this.subs = r.subs;
      this.selected = [r.ref];
      this.apply(false, 'Add node');
      return;
    }
    if (this.moved) this.apply(false);
  }

  onDblClick(p: Point) {
    const h = this.hit(p);
    if (!h || h.part !== 'anchor' || !this.subs) return;
    const a = this.subs[h.sub].anchors[h.anchor];
    const ref = { sub: h.sub, anchor: h.anchor };
    this.selected = [ref];
    this.subs = setNodeKind(this.subs, [ref], a.inX !== null || a.outX !== null ? 'sharp' : 'smooth');
    this.apply(false, 'Convert node');
  }

  /** Context bar / menu actions. */
  action(a: NodeAction) {
    if (this.loadedDoc !== this.c.editor.doc) this.load();
    if (!this.subs) return;
    const all = this.subs.flatMap((s, si) => s.anchors.map((_, ai) => ({ sub: si, anchor: ai })));
    const target = this.selected.length ? this.selected : all;
    switch (a) {
      case 'select-all':
        this.selected = all;
        this.publish();
        this.c.viewport.drawOverlay();
        return;
      case 'sharp':
      case 'smooth':
      case 'symmetric':
        this.subs = setNodeKind(this.subs, target, a);
        return this.apply(false, 'Convert node');
      case 'break': {
        if (this.selected.length !== 1) {
          toast('Select one node to break the curve at');
          return;
        }
        const ref = this.selected[0];
        this.subs = breakAt(this.subs, ref);
        this.selected = [];
        return this.apply(false, 'Break curve');
      }
      case 'join':
        this.subs = joinSelected(this.subs, this.selected);
        this.selected = [];
        return this.apply(false, 'Join curves');
      case 'close':
        this.subs = this.subs.reduce((acc, s, i) => (s.closed ? acc : closeSubpath(acc, i)), this.subs);
        return this.apply(false, 'Close curve');
      case 'reverse':
        this.subs = reversePath(this.subs);
        this.selected = this.selected.map((r) => ({ sub: r.sub, anchor: this.subs![r.sub].anchors.length - 1 - r.anchor }));
        return this.apply(false, 'Reverse curve');
      case 'delete':
        return this.deleteSelected();
    }
  }

  private deleteSelected() {
    if (!this.subs || !this.selected.length) return;
    const left = deleteNodes(this.subs, this.selected);
    this.selected = [];
    if (!left.length && this.nodeId) {
      const id = this.nodeId;
      this.c.editor.commit('Delete', (d) => removeNodes(d, [id]));
      this.subs = null;
      this.nodeId = null;
      this.publish();
      this.c.viewport.drawOverlay();
      return;
    }
    this.subs = left;
    this.apply(false, 'Delete node');
  }

  onKey(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.length && this.subs) {
      this.deleteSelected();
      return true;
    }
    if (e.key.startsWith('Arrow') && this.selected.length && this.subs) {
      const k = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -k : e.key === 'ArrowRight' ? k : 0;
      const dy = e.key === 'ArrowUp' ? -k : e.key === 'ArrowDown' ? k : 0;
      this.subs = moveNodes(this.subs, this.selected, dx, dy);
      this.apply(false, 'Nudge nodes', 'node-nudge');
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && this.subs) {
      this.action('select-all');
      return true;
    }
    if (e.key === 'Escape') {
      if (this.selected.length) {
        this.selected = [];
        this.publish();
        this.c.viewport.drawOverlay();
        return true;
      }
      this.c.editor.setTool('move');
      return true;
    }
    return false;
  }

  deactivate() {
    setNodeActionHandler(null);
    publishNodeEdit(null);
  }

  /** Write world-space anchors back to the node (preview while dragging). */
  private apply(preview: boolean, label = 'Edit nodes', merge?: string) {
    const ed = this.c.editor;
    const doc = ed.doc;
    if (!doc || !this.subs || !this.nodeId) return;
    const loc = findNode(doc, this.nodeId);
    if (!loc) return;
    const id = this.nodeId;
    const local = transformPath(subpathsToPath(this.subs), invert(worldMatrix(loc)));
    const closed = this.subs.some((s) => s.closed);
    const update = (d0: typeof doc) => {
      let d1 = d0;
      if (findNode(d0, id)?.node.type !== 'path') d1 = convertToCurves(d1, id);
      return updateNode<PathNode>(d1, id, { d: local, closed });
    };
    if (preview) ed.preview(update);
    else {
      // a drag previewed in place: put the pre-drag document back so the edit is one undo step
      if (this.moved && this.base && this.base !== ed.doc) ed.history?.replace(this.base);
      this.base = null;
      ed.commit(label, update, merge);
    }
    this.loadedDoc = ed.doc;
    this.publish();
    this.c.viewport.drawOverlay();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (!this.drag && (!this.subs || this.loadedDoc !== this.c.editor.doc)) this.load();
    if (!this.subs) return;
    ctx.save();
    ctx.strokeStyle = '#2fb8a6';
    ctx.lineWidth = 1 / z;
    ctx.stroke(new Path2D(pathToString(subpathsToPath(this.subs))));
    const sel = new Set(this.selected.map(refKey));
    this.subs.forEach((s, si) => drawNodeAnchors(ctx, s.anchors, z, (i) => sel.has(`${si}:${i}`), s.closed));
    const d = this.drag;
    if (d?.mode === 'marquee') {
      ctx.setLineDash([4 / z, 3 / z]);
      ctx.fillStyle = 'rgba(47,184,166,0.08)';
      const x = Math.min(d.start.x, d.cur.x);
      const y = Math.min(d.start.y, d.cur.y);
      ctx.fillRect(x, y, Math.abs(d.cur.x - d.start.x), Math.abs(d.cur.y - d.start.y));
      ctx.strokeRect(x, y, Math.abs(d.cur.x - d.start.x), Math.abs(d.cur.y - d.start.y));
    }
    ctx.restore();
  }
}

/** Node tool anchors: selected nodes filled; smooth nodes round, sharp square; path start marked. */
function drawNodeAnchors(ctx: CanvasRenderingContext2D, anchors: Anchor[], z: number, isSel: (i: number) => boolean, closed: boolean) {
  const s = 7 / z;
  anchors.forEach((a, i) => {
    ctx.strokeStyle = '#2fb8a6';
    ctx.lineWidth = 1 / z;
    for (const [hx, hy] of [[a.inX, a.inY], [a.outX, a.outY]]) {
      if (hx === null || hy === null) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(hx, hy, s / 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = isSel(i) ? '#2fb8a6' : '#ffffff';
    ctx.lineWidth = (i === 0 && !closed ? 2 : 1) / z;
    if (nodeKind(a) === 'sharp') {
      ctx.fillRect(a.x - s / 2, a.y - s / 2, s, s);
      ctx.strokeRect(a.x - s / 2, a.y - s / 2, s, s);
    } else {
      ctx.beginPath();
      ctx.arc(a.x, a.y, s / 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
}

// ---------------------------------------------------------------------------
// Gradient tool

type GradHit = { part: 'start' | 'end' } | { part: 'stop'; index: number };

/**
 * Gradient tool (Affinity's G): drag across the selected object to lay a
 * gradient (linear, radial or conical, from the context bar) on its fill or
 * stroke. Drag the end handles to move it, drag a stop along the ramp to
 * re-position it, double-click the ramp to add a stop (in the colour already
 * there), Delete removes the selected stop. Stop colours are edited in the
 * colour popover of the inspector or context bar.
 */
class GradientTool implements Tool {
  cursor = CROSS;
  private drag: { hit: GradHit | 'new'; start: Point } | null = null;
  private stop = -1;
  constructor(private c: ToolContext) {}

  private target() {
    const ed = this.c.editor;
    const doc = ed.doc;
    const sel = ed.selectedNodes();
    if (!doc || sel.length !== 1) return null;
    const n = sel[0];
    const slot = ed.ui.toolOptions.gradientTarget;
    const paint = getPaint(n, slot);
    if (!paint) return null;
    const loc = findNode(doc, n.id)!;
    const m = worldMatrix(loc);
    const box = n.type === 'text' ? renderLocalBounds(n) : n.type === 'group' ? renderLocalBounds(n) : shapeBox(n);
    return { n, slot, paint, m, inv: invert(m), box };
  }

  private handlesWorld(t: NonNullable<ReturnType<GradientTool['target']>>) {
    if (!isGradient(t.paint)) return null;
    const h = gradientHandles(t.paint, t.box);
    const s = apply(t.m, h.start);
    const e = apply(t.m, h.end);
    const stops = t.paint.stops.map((st) => ({ x: s.x + (e.x - s.x) * st.offset, y: s.y + (e.y - s.y) * st.offset, color: st.color }));
    return { s, e, stops };
  }

  private hit(p: Point): GradHit | null {
    const t = this.target();
    if (!t) return null;
    const h = this.handlesWorld(t);
    if (!h) return null;
    const r = 8 / this.c.viewport.canvas.getZoom();
    for (let i = 0; i < h.stops.length; i++) {
      if (Math.hypot(p.x - h.stops[i].x, p.y - h.stops[i].y) < r && h.stops.length > 0 && (i !== 0 || Math.hypot(p.x - h.s.x, p.y - h.s.y) > r / 3)) {
        // the end stops sit on the handles: the handles win unless the pointer is clearly on the stop
        if ((i === 0 && Math.hypot(p.x - h.s.x, p.y - h.s.y) < r) || (i === h.stops.length - 1 && Math.hypot(p.x - h.e.x, p.y - h.e.y) < r)) continue;
        return { part: 'stop', index: i };
      }
    }
    if (Math.hypot(p.x - h.s.x, p.y - h.s.y) < r) return { part: 'start' };
    if (Math.hypot(p.x - h.e.x, p.y - h.e.y) < r) return { part: 'end' };
    return null;
  }

  onDown(p: Point, _e: MouseEvent, target: SceneNode | null) {
    const ed = this.c.editor;
    const h = this.hit(p);
    if (h) {
      if (h.part === 'stop') this.stop = h.index;
      this.drag = { hit: h, start: p };
      this.base = ed.doc;
      this.c.viewport.drawOverlay();
      return;
    }
    const sel = ed.selectedNodes();
    if (target && (sel.length !== 1 || sel[0].id !== target.id)) {
      ed.select([target.id]);
      this.stop = -1;
    }
    if (!this.target()) {
      if (!target) ed.select([]);
      this.c.viewport.drawOverlay();
      return;
    }
    this.drag = { hit: 'new', start: p };
    this.base = ed.doc;
  }

  onMove(p: Point, e: MouseEvent) {
    const d = this.drag;
    const t = this.target();
    if (!d || !t) return;
    const ed = this.c.editor;
    let q = p;
    if (e.shiftKey && d.hit !== 'new' && d.hit.part !== 'stop') {
      const h = this.handlesWorld(t)!;
      q = snap45(d.hit.part === 'end' ? h.s : h.e, p);
    } else if (e.shiftKey && d.hit === 'new') q = snap45(d.start, p);
    const local = apply(t.inv, q);
    let paint = t.paint;
    if (d.hit === 'new') {
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) < 3 / this.c.viewport.canvas.getZoom()) return;
      const type = ed.ui.toolOptions.gradientType;
      const stops = isGradient(paint) ? paint.stops : [{ offset: 0, color: paint.type === 'solid' ? paint.color : ed.ui.fillColor }, { offset: 1, color: '#ffffff' }];
      const base = type === 'linear' ? { type, stops, angle: 0 } : type === 'radial' ? { type, stops } : { type, stops, angle: 0 };
      paint = setGradientHandles(base as never, t.box, apply(t.inv, d.start), local);
    } else if (isGradient(paint)) {
      const hw = gradientHandles(paint, t.box);
      if (d.hit.part === 'start') paint = setGradientHandles(paint, t.box, local, hw.end);
      else if (d.hit.part === 'end') paint = setGradientHandles(paint, t.box, hw.start, local);
      else {
        // project on the handle line so stops move along the ramp whatever the type
        const off = projectOnHandles(paint, t.box, local);
        const i = (d.hit as { index: number }).index;
        paint = { ...paint, stops: paint.stops.map((st, j) => (j === i ? { ...st, offset: Math.round(off * 1000) / 1000 } : st)) };
      }
    }
    const id = t.n.id;
    const slot = t.slot;
    ed.preview((doc) => updateNode(doc, id, (n: SceneNode) => setPaint(n, slot, paint)));
    this.moved = true;
    this.c.viewport.drawOverlay();
  }
  private moved = false;
  /** the document before a drag's previews, so undo returns to it */
  private base: QuvreloDocument | null = null;

  onUp() {
    if (this.drag && this.moved) {
      // the drag previewed without history: record the result as one undo step
      const t = this.target();
      if (t) {
        const paint = t.paint;
        const id = t.n.id;
        const slot = t.slot;
        this.c.editor.history?.replace(this.base ?? this.c.editor.doc!);
        this.c.editor.commit('Gradient', (d) => updateNode(d, id, (n: SceneNode) => setPaint(n, slot, paint)));
      }
    }
    this.base = null;
    this.drag = null;
    this.moved = false;
    this.c.viewport.drawOverlay();
  }

  onDblClick(p: Point) {
    const t = this.target();
    if (!t || !isGradient(t.paint)) return;
    const local = apply(t.inv, p);
    const pos = projectOnHandles(t.paint, t.box, local);
    const { paint, index } = insertStop(t.paint, Math.round(pos * 1000) / 1000);
    this.stop = index;
    const id = t.n.id;
    const slot = t.slot;
    this.c.editor.commit('Add gradient stop', (d) => updateNode(d, id, (n: SceneNode) => setPaint(n, slot, paint)));
    this.c.viewport.drawOverlay();
  }

  onKey(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.stop >= 0) {
      const t = this.target();
      if (!t || !isGradient(t.paint) || t.paint.stops.length <= 2) return true;
      const i = this.stop;
      const paint = { ...t.paint, stops: t.paint.stops.filter((_, j) => j !== i) };
      this.stop = -1;
      const id = t.n.id;
      const slot = t.slot;
      this.c.editor.commit('Remove gradient stop', (d) => updateNode(d, id, (n: SceneNode) => setPaint(n, slot, paint)));
      return true;
    }
    if (e.key === 'Escape') {
      this.c.editor.setTool('move');
      return true;
    }
    return false;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    const t = this.target();
    if (!t) return;
    const h = this.handlesWorld(t);
    if (!h) return;
    ctx.save();
    ctx.lineWidth = 1.5 / z;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(h.s.x, h.s.y);
    ctx.lineTo(h.e.x, h.e.y);
    ctx.stroke();
    ctx.strokeStyle = '#2fb8a6';
    ctx.setLineDash([4 / z, 3 / z]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (t.paint.type === 'radial' || t.paint.type === 'conical') {
      ctx.beginPath();
      ctx.arc(h.s.x, h.s.y, Math.hypot(h.e.x - h.s.x, h.e.y - h.s.y), 0, Math.PI * 2);
      ctx.setLineDash([2 / z, 4 / z]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const [pt, r] of [[h.s, 6], [h.e, 5]] as const) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r / z, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5 / z;
      ctx.strokeStyle = '#2fb8a6';
      ctx.stroke();
    }
    const sz = 9 / z;
    h.stops.forEach((st, i) => {
      ctx.fillStyle = st.color;
      ctx.strokeStyle = i === this.stop ? '#2fb8a6' : '#ffffff';
      ctx.lineWidth = (i === this.stop ? 2.5 : 1.5) / z;
      ctx.fillRect(st.x - sz / 2, st.y - sz / 2, sz, sz);
      ctx.strokeRect(st.x - sz / 2, st.y - sz / 2, sz, sz);
    });
    ctx.restore();
  }
}

/** Position (0..1) of a local point projected on a gradient's handle line (where the stops are drawn). */
function projectOnHandles(p: GradientPaint, box: { x: number; y: number; w: number; h: number }, pt: Point): number {
  const h = gradientHandles(p, box);
  const dx = h.end.x - h.start.x;
  const dy = h.end.y - h.start.y;
  return Math.min(1, Math.max(0, ((pt.x - h.start.x) * dx + (pt.y - h.start.y) * dy) / (dx * dx + dy * dy || 1)));
}

// ---------------------------------------------------------------------------
// Artboard tool

/**
 * Artboard tool: drag to draw a board; click a board to select it. With
 * objects selected, "Insert artboard" in the context bar wraps them in a board.
 */
class ArtboardTool implements Tool {
  cursor = CROSS;
  private start: Point | null = null;
  private cur: Point | null = null;
  constructor(private c: ToolContext) {}
  onDown(p: Point, _e: MouseEvent, target: SceneNode | null) {
    const ed = this.c.editor;
    const pid = ed.activeContainer?.id;
    const doc = ed.doc;
    if (doc && pid) {
      const ab = artboardAt(doc, pid, p);
      if (ab && (!target || target.id === ab.id)) {
        ed.select([ab.id]);
        return;
      }
    }
    this.start = p;
    this.cur = p;
  }
  onMove(p: Point, e: MouseEvent) {
    if (!this.start) return;
    this.cur = p;
    if (e.shiftKey) {
      const s = Math.max(Math.abs(p.x - this.start.x), Math.abs(p.y - this.start.y));
      this.cur = { x: this.start.x + Math.sign(p.x - this.start.x || 1) * s, y: this.start.y + Math.sign(p.y - this.start.y || 1) * s };
    }
    this.c.viewport.drawOverlay();
  }
  onUp() {
    const s = this.start;
    const e = this.cur;
    this.start = this.cur = null;
    const ed = this.c.editor;
    const pid = ed.activeContainer?.id;
    if (!s || !e || !pid || !ed.doc?.pages.some((p) => p.id === pid)) return;
    const r = { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y), w: Math.abs(e.x - s.x), h: Math.abs(e.y - s.y) };
    if (r.w * this.c.viewport.canvas.getZoom() < 6 || r.h * this.c.viewport.canvas.getZoom() < 6) {
      this.c.viewport.drawOverlay();
      return;
    }
    let id = '';
    ed.commit('Artboard', (d) => {
      const out = addArtboard(d, pid, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
      id = out.id;
      return out.doc;
    });
    ed.select([id]);
    this.c.viewport.drawOverlay();
  }
  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (!this.start || !this.cur) return;
    const x = Math.min(this.start.x, this.cur.x);
    const y = Math.min(this.start.y, this.cur.y);
    const w = Math.abs(this.cur.x - this.start.x);
    const h = Math.abs(this.cur.y - this.start.y);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#2fb8a6';
    ctx.lineWidth = 1.5 / z;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#2fb8a6';
    ctx.font = `${11 / z}px Inter, sans-serif`;
    ctx.fillText(`${Math.round(w)} × ${Math.round(h)}`, x + w + 6 / z, y + h + 14 / z);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Pixel selection tools

class MarqueeTool implements Tool {
  cursor = CROSS;
  private start: Point | null = null;
  private pts: Point[] = [];
  private mode: 'new' | 'add' | 'subtract' | 'intersect' = 'new';
  constructor(private c: ToolContext, private shape: 'rect' | 'ellipse' | 'lasso') {}
  onDown(p: Point, e: MouseEvent) {
    this.start = p;
    this.pts = [p];
    const base = this.c.editor.ui.toolOptions.selectionMode;
    this.mode = e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : base;
  }
  onMove(p: Point, e: MouseEvent) {
    if (!this.start) return;
    if (this.shape === 'lasso') this.pts.push(p);
    else {
      let q = p;
      if (e.shiftKey && this.mode === 'new') {
        const m = Math.max(Math.abs(p.x - this.start.x), Math.abs(p.y - this.start.y));
        q = { x: this.start.x + Math.sign(p.x - this.start.x || 1) * m, y: this.start.y + Math.sign(p.y - this.start.y || 1) * m };
      }
      this.pts = [this.start, q];
    }
    this.c.viewport.drawOverlay();
  }
  private path(): PathCommand[] | null {
    if (this.shape === 'lasso') {
      if (this.pts.length < 3) return null;
      return pointsToPath(simplify(this.pts, 0.5));
    }
    if (this.pts.length < 2) return null;
    const r = boundsOfPoints(this.pts);
    if (r.w < 1 || r.h < 1) return null;
    const d = this.shape === 'rect' ? rectPath(r.w, r.h) : ellipsePath(r.w, r.h);
    return translatePath(d, r.x + r.w / 2, r.y + r.h / 2);
  }
  onUp() {
    const ed = this.c.editor;
    const d = this.path();
    this.start = null;
    this.pts = [];
    if (!d) {
      if (this.mode === 'new') ed.setUi({ pixelSelection: null });
      this.c.viewport.drawOverlay();
      return;
    }
    const cur = ed.ui.pixelSelection;
    let next: PathCommand[] | null = d;
    if (cur && this.mode !== 'new') {
      const op = this.mode === 'add' ? 'add' : this.mode === 'subtract' ? 'subtract' : 'intersect';
      next = booleanPaths([cur, d], op)[0] ?? null;
    }
    ed.setUi({ pixelSelection: next });
    this.c.viewport.drawOverlay();
  }
  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    const d = this.path();
    if (!d) return;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([3 / z, 3 / z]);
    ctx.stroke(new Path2D(pathToString(d)));
    ctx.restore();
  }
}

/**
 * Crop: an adjustable box over the canvas. Drag a handle (8: corners + edges)
 * to resize, drag inside to move, drag outside to draw a new box. Shift locks
 * the current proportions; a ratio preset (context bar) locks them too.
 * Enter or double-click applies, Esc resets the box and stays in Crop.
 * The box lives in editor.ui.crop so the context bar's W/H fields stay in sync.
 */
class CropTool implements Tool {
  cursor = CROSS;
  private drag: { hit: CropHit | 'new'; start: Point; box: CropRect; ratio: number | null } | null = null;
  constructor(private c: ToolContext) {}

  private tol(): number {
    return (HANDLE_SIZE + 3) / this.c.viewport.canvas.getZoom();
  }

  private setCursor(cur: string) {
    const fc = this.c.viewport.canvas;
    fc.defaultCursor = cur;
    fc.setCursor(cur);
  }

  onDown(p: Point, e: MouseEvent) {
    const box = currentCrop();
    if (!box) return;
    const hit = hitCrop(box, p, this.tol());
    let ratio = currentRatio();
    if (!ratio && e.shiftKey && box.w > 0 && box.h > 0) ratio = box.w / box.h;
    this.drag = { hit: hit ?? 'new', start: p, box, ratio };
  }

  onMove(p: Point, e: MouseEvent) {
    const d = this.drag;
    if (!d) {
      const box = currentCrop();
      this.setCursor(cursorFor(box ? hitCrop(box, p, this.tol()) : null));
      return;
    }
    const bounds = docBounds();
    let ratio = d.ratio;
    // Shift during a free drag locks to the proportions the box had at mouse-down
    if (!currentRatio()) ratio = e.shiftKey ? d.box.w / d.box.h : null;
    let next: CropRect;
    if (d.hit === 'move') {
      next = bounds ? moveWithin({ ...d.box, x: d.box.x + p.x - d.start.x, y: d.box.y + p.y - d.start.y }, bounds) : d.box;
    } else if (d.hit === 'new') {
      const z = this.c.viewport.canvas.getZoom();
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * z < 3) return;
      next = rectFromDrag(d.start, p, currentRatio() ?? (e.shiftKey ? 1 : null), bounds);
    } else {
      next = resizeCrop(d.box, d.hit, p.x - d.start.x, p.y - d.start.y, ratio, bounds);
    }
    setCropBox(next);
    this.c.viewport.drawOverlay();
  }

  onUp() {
    this.drag = null;
    this.c.viewport.drawOverlay();
  }

  onDblClick(p: Point) {
    const box = currentCrop();
    if (box && hitCrop(box, p, this.tol())) void runCommand('crop.apply');
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      void runCommand('crop.apply');
      return true;
    }
    if (e.key === 'Escape') {
      void runCommand('crop.cancel');
      return true;
    }
    return false;
  }

  deactivate() {
    this.drag = null;
  }

  /** Shade outside the box and the composition guides, in document space. */
  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    const r = currentCrop();
    if (!r) return;
    ctx.save();
    ctx.fillStyle = this.drag ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.58)';
    const p = new Path2D();
    // shade the image outside the box only; the pasteboard stays untouched
    const page = docBounds() ?? { x: -1e5, y: -1e5, w: 2e5, h: 2e5 };
    p.rect(page.x, page.y, page.w, page.h);
    p.rect(r.x, r.y, r.w, r.h);
    ctx.fill(p, 'evenodd');
    const overlay = this.c.editor.ui.toolOptions.cropOverlay;
    const n = overlay === 'thirds' ? 3 : overlay === 'grid' ? 6 : 0;
    if (n) {
      ctx.lineWidth = 1 / z;
      // a dark under-stroke keeps the guides legible on bright photos
      for (const [style, off] of [['rgba(0,0,0,0.28)', 1 / z], [this.drag ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.45)', 0]] as const) {
        ctx.strokeStyle = style;
        ctx.beginPath();
        for (let i = 1; i < n; i++) {
          const x = r.x + (r.w * i) / n + off;
          const y = r.y + (r.h * i) / n + off;
          ctx.moveTo(x, r.y);
          ctx.lineTo(x, r.y + r.h);
          ctx.moveTo(r.x, y);
          ctx.lineTo(r.x + r.w, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Frame, 8 handles and the live W x H pill, in screen space so they never scale with zoom. */
  drawScreenOverlay(ctx: CanvasRenderingContext2D) {
    const r = currentCrop();
    if (!r) return;
    const vp = this.c.viewport;
    const a = vp.sceneToScreen(r.x, r.y);
    const b = vp.sceneToScreen(r.x + r.w, r.y + r.h);
    // whole device pixels at any display scale (a 1px line at 150 % would blur)
    const hl = hairline();
    const crisp = hl.line;
    const x0 = crisp(a.x);
    const y0 = crisp(a.y);
    const x1 = crisp(b.x);
    const y1 = crisp(b.y);
    const one = hl.width;
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = one;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeRect(x0 - one, y0 - one, x1 - x0 + 2 * one, y1 - y0 + 2 * one);
    const oc = vp.overlayColors;
    ctx.strokeStyle = oc.ring;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // One handle vocabulary in every theme (critique 3, N10): L-brackets at the corners and
    // 12x3 bars mid-edge, all in the theme's canvas-handle colour over a 1 px ring, so they
    // read on any photo and turn yellow-on-black in high contrast like every other handle.
    const ov = vp.overlayColors;
    const L = Math.min(16, (x1 - x0) / 3, (y1 - y0) / 3);
    const BAR = 12;
    const pts = handlePoints({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
    const shapes = new Path2D();
    for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) {
      shapes.moveTo(cx - sx * one, cy + sy * L);
      shapes.lineTo(cx - sx * one, cy - sy * one);
      shapes.lineTo(cx + sx * L, cy - sy * one);
    }
    for (const h of CROP_HANDLES) {
      if (h.length === 2) continue; // corners are the brackets
      if ((h === 'n' || h === 's') && x1 - x0 < BAR * 3) continue;
      if ((h === 'e' || h === 'w') && y1 - y0 < BAR * 3) continue;
      const q = pts[h];
      const horiz = h === 'n' || h === 's';
      const cx = horiz ? Math.round(q.x) : crisp(q.x);
      const cy = horiz ? crisp(q.y) : Math.round(q.y);
      if (horiz) {
        shapes.moveTo(cx - BAR / 2, cy);
        shapes.lineTo(cx + BAR / 2, cy);
      } else {
        shapes.moveTo(cx, cy - BAR / 2);
        shapes.lineTo(cx, cy + BAR / 2);
      }
    }
    ctx.lineCap = 'square';
    const core = hl.stroke(3);
    ctx.lineWidth = core + 2 * one;
    ctx.strokeStyle = ov.ring;
    ctx.stroke(shapes);
    ctx.lineWidth = core;
    ctx.strokeStyle = ov.handle;
    ctx.stroke(shapes);
    ctx.lineCap = 'butt';
    if (this.drag) {
      const q = roundCrop(r);
      const label = `${q.w} × ${q.h}`;
      ctx.font = '500 11px Inter, sans-serif';
      (ctx as CanvasRenderingContext2D & { fontVariantNumeric?: string }).fontVariantNumeric = 'tabular-nums';
      const tw = ctx.measureText(label).width + 12;
      const cx = (x0 + x1) / 2;
      const by = Math.min(y1 + 10, vp.canvas.getHeight() - 24);
      ctx.fillStyle = vp.overlayColors.handle;
      ctx.beginPath();
      ctx.roundRect(Math.round(cx - tw / 2), Math.round(by), Math.round(tw), 18, 4);
      ctx.fill();
      ctx.fillStyle = oc.ring === '#000000' ? '#000000' : '#06231e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, Math.round(cx), Math.round(by) + 9.5);
    }
    ctx.restore();
  }
}

/**
 * Object Select (W): click an object in a photo and the on-device model selects
 * it. Click again to add to the selection, Alt-click to take a part away. Each
 * click refines the previous result (runSelectObject with the last mask).
 * While the model runs a small "Selecting" chip sits by the pointer.
 */
class ObjectSelectTool implements Tool {
  cursor = CROSS;
  private chip: HTMLElement | null = null;
  constructor(private c: ToolContext) {}

  onDown(p: Point, e: MouseEvent) {
    const vp = this.c.viewport;
    const sp = vp.sceneToScreen(p.x, p.y);
    void objectSelectClick(this.c.editor, p, !e.altKey, {
      onStart: () => this.showChip(sp.x, sp.y),
      onEnd: () => this.hideChip(),
      redraw: () => vp.drawOverlay(),
    });
  }

  private showChip(x: number, y: number) {
    this.hideChip();
    const el = document.createElement('div');
    el.className = 'ml-chip';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="ml-spinner" aria-hidden="true"></span><span>Selecting…</span>';
    el.style.left = `${Math.round(x + 14)}px`;
    el.style.top = `${Math.round(y + 14)}px`;
    this.c.viewport.host.appendChild(el);
    this.chip = el;
  }

  private hideChip() {
    this.chip?.remove();
    this.chip = null;
  }

  deactivate() {
    this.hideChip();
  }

  /** Click markers (theme canvas-handle colour = include, coral = exclude) for the current refinement. */
  drawScreenOverlay(ctx: CanvasRenderingContext2D) {
    const ed = this.c.editor;
    const marks = objectSelectMarkers(ed);
    if (!marks.length) return;
    const vp = this.c.viewport;
    const ov = vp.overlayColors; // yellow on a black ring in high contrast (critique 3, N10)
    ctx.save();
    for (const m of marks) {
      const q = vp.sceneToScreen(m.x, m.y);
      ctx.beginPath();
      ctx.arc(Math.round(q.x) + 0.5, Math.round(q.y) + 0.5, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = m.positive ? ov.handle : '#ff6b4a';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ov.ring;
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Painting

class BrushTool implements Tool {
  cursor = CROSS;
  private nodeId: string | null = null;
  private base: HTMLCanvasElement | null = null;
  private work: HTMLCanvasElement | null = null;
  private stroke: HTMLCanvasElement | null = null;
  private toPx: ((p: Point) => Point) | null = null;
  private last: Point | null = null;
  private dab: HTMLCanvasElement | null = null;
  private clip: Path2D | null = null;
  private pxScale = 1;
  private mouse: Point | null = null;
  constructor(private c: ToolContext, private erase: boolean) {}

  private size() {
    const o = this.c.editor.ui.toolOptions;
    return this.erase ? o.eraserSize : o.brushSize;
  }

  onDown(p: Point) {
    const ed = this.c.editor;
    let r = activeRaster(ed);
    if (!r) {
      if (this.erase) {
        ed.setUi({ status: 'Select a pixel layer to erase' });
        return;
      }
      r = createPixelLayer(ed);
      if (!r) return;
    }
    const doc = ed.doc!;
    const base = ed.assets.get(r.assetId);
    const m = worldToPixelMatrix(doc, r.id);
    if (!base || !m) return;
    this.nodeId = r.id;
    this.base = base;
    this.work = cloneCanvas(base);
    this.stroke = createCanvas(base.width, base.height);
    const sx = base.width / r.w;
    const sy = base.height / r.h;
    this.toPx = (q: Point) => {
      const a = apply(m, q);
      return { x: a.x * sx, y: a.y * sy };
    };
    // pixel size of one document unit along the layer (for brush diameter)
    const a = this.toPx({ x: 0, y: 0 });
    const b = this.toPx({ x: 1, y: 0 });
    this.pxScale = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const o = ed.ui.toolOptions;
    this.dab = makeDab(this.size() * this.pxScale, o.brushHardness, this.erase ? '#000000' : ed.ui.fillColor);
    const selPath = selectionInPixels(doc, r.id, ed.ui.pixelSelection);
    this.clip = selPath;
    this.c.viewport.livePaint = { nodeId: r.id, canvas: this.work };
    this.last = this.toPx(p);
    this.stamp(this.last);
    this.composite();
  }

  private stamp(pt: Point) {
    const ctx = ctx2d(this.stroke!);
    const d = this.dab!;
    ctx.drawImage(d, pt.x - d.width / 2, pt.y - d.height / 2);
  }

  private composite() {
    const w = this.work!;
    const ctx = ctx2d(w);
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.base!, 0, 0);
    ctx.restore();
    ctx.save();
    if (this.clip) ctx.clip(this.clip, 'evenodd');
    ctx.globalAlpha = this.c.editor.ui.toolOptions.brushOpacity;
    ctx.globalCompositeOperation = this.erase ? 'destination-out' : 'source-over';
    ctx.drawImage(this.stroke!, 0, 0);
    ctx.restore();
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
    const spacing = Math.max(1, this.size() * this.pxScale * 0.12);
    if (dist < spacing) return;
    const steps = Math.floor(dist / spacing);
    for (let i = 1; i <= steps; i++) {
      const t = (i * spacing) / dist;
      this.stamp({ x: this.last.x + (q.x - this.last.x) * t, y: this.last.y + (q.y - this.last.y) * t });
    }
    const t = (steps * spacing) / dist;
    this.last = { x: this.last.x + (q.x - this.last.x) * t, y: this.last.y + (q.y - this.last.y) * t };
    this.composite();
  }

  onUp() {
    if (this.nodeId && this.work) {
      const ed = this.c.editor;
      const id = this.nodeId;
      const work = this.work;
      this.c.viewport.livePaint = null;
      commitRasterCanvas(ed, id, work, this.erase ? 'Erase' : 'Brush stroke');
    }
    this.nodeId = null;
    this.base = this.work = this.stroke = null;
    this.toPx = null;
    this.last = null;
  }

  deactivate() {
    this.c.viewport.livePaint = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (!this.mouse) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    ctx.arc(this.mouse.x, this.mouse.y, this.size() / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(this.mouse.x, this.mouse.y, this.size() / 2 + 1 / z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

class FillTool implements Tool {
  cursor = 'cell';
  constructor(private c: ToolContext) {}
  onDown(p: Point, _e: MouseEvent, target: SceneNode | null) {
    const ed = this.c.editor;
    const color = ed.ui.fillColor;
    const r = activeRaster(ed);
    if (r) {
      const doc = ed.doc!;
      const tol = ed.ui.toolOptions.fillTolerance;
      editRaster(ed, r.id, 'Fill', (ctx, canvas, toPixel) => {
        const q = apply(toPixel, p);
        const x = Math.floor(q.x);
        const y = Math.floor(q.y);
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
        const px = canvasToPixels(canvas);
        const mask = floodMask(px, x, y, tol);
        const col = parseColor(color);
        const sel = selectionInPixels(doc, r.id, ed.ui.pixelSelection);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let selMask: Uint8ClampedArray | null = null;
        if (sel) {
          const mc = createCanvas(canvas.width, canvas.height);
          const mctx = ctx2d(mc);
          mctx.fill(sel, 'evenodd');
          selMask = mctx.getImageData(0, 0, canvas.width, canvas.height).data;
        }
        for (let i = 0; i < mask.length; i++) {
          if (!mask[i]) continue;
          if (selMask && selMask[i * 4 + 3] < 128) continue;
          img.data[i * 4] = col.r;
          img.data[i * 4 + 1] = col.g;
          img.data[i * 4 + 2] = col.b;
          img.data[i * 4 + 3] = Math.round(col.a * 255);
        }
        ctx.putImageData(img, 0, 0);
      });
      return;
    }
    if (target && 'fill' in target) {
      ed.commit('Fill', (d) => updateNode(d, target.id, { fill: solid(color) } as Partial<SceneNode>));
    } else if (target && target.type === 'text') {
      ed.commit('Fill', (d) => updateNode(d, target.id, { style: { ...target.style, fill: solid(color) } } as Partial<SceneNode>));
    }
  }
}

class EyedropperTool implements Tool {
  cursor = 'copy';
  constructor(private c: ToolContext) {}
  onDown(p: Point, e: MouseEvent) {
    const ed = this.c.editor;
    const doc = ed.doc;
    if (!doc) return;
    const idx = Math.max(0, ed.activePageIndex);
    const c = createCanvas(1, 1);
    const ctx = ctx2d(c);
    ctx.translate(-p.x, -p.y);
    drawPage(ctx, doc, idx, { doc, assets: ed.assets, editor: false, preview: false, zoom: 1 });
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const hex = toHex(d[0], d[1], d[2]);
    if (e.shiftKey) ed.setUi({ strokeColor: hex, strokeEnabled: true });
    else ed.setUi({ fillColor: hex, fillEnabled: true });
    ed.setUi({ status: `Picked ${hex}` });
  }
}

export function createTool(id: ToolId, c: ToolContext): Tool {
  switch (id) {
    case 'move': return new MoveTool(c);
    case 'hand': return new HandTool();
    case 'zoom': return new ZoomTool(c);
    case 'rect': case 'rrect': case 'ellipse': case 'polygon': case 'star': case 'line': case 'arrow': case 'textframe': case 'imageframe':
      return new ShapeTool(c, id);
    case 'text': return new TextTool(c);
    case 'pen': return new PenTool(c);
    case 'pencil': return new PencilTool(c);
    case 'node': return new NodeTool(c);
    case 'marquee-rect': return new MarqueeTool(c, 'rect');
    case 'marquee-ellipse': return new MarqueeTool(c, 'ellipse');
    case 'lasso': return new MarqueeTool(c, 'lasso');
    case 'object-select': return new ObjectSelectTool(c);
    case 'crop': return new CropTool(c);
    case 'brush': return new BrushTool(c, false);
    case 'eraser': return new BrushTool(c, true);
    case 'fill': return new FillTool(c);
    case 'eyedropper': return new EyedropperTool(c);
    case 'gradient': return new GradientTool(c);
    case 'artboard': return new ArtboardTool(c);
    default: return new MoveTool(c);
  }
}

export type { RasterNode };
