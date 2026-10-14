/**
 * Interactive tools. Each tool receives scene (document) coordinates from the
 * viewport and turns gestures into model commits.
 */
import { apply, invert, boundsOfPoints, type Point } from '../../core/geometry';
import { findNode, make, makeStroke, solid, NO_PAINT, worldMatrix, nodeToPath } from '../../core/document';
import { addNodes, addTextFrame, convertToCurves, cropDocument, updateNode, removeNodes } from '../../core/commands';
import {
  centrePath, ellipsePath, pathToString, pathToSubpaths, polygonPoints, pointsToPath, rectPath, starPoints,
  subpathsToPath, transformPath, translatePath, type Anchor, type Subpath,
} from '../../core/path';
import { booleanPaths } from '../../core/boolean';
import { floodMask } from '../../core/pixels';
import type { PathCommand, PathNode, SceneNode, RasterNode } from '../../core/types';
import type { Editor, ToolId } from '../state/editor';
import type { Viewport } from './Viewport';
import { cloneCanvas, createCanvas, ctx2d, canvasToPixels } from './assets';
import {
  activeRaster, commitRasterCanvas, createPixelLayer, editRaster, makeDab, parseColor, selectionInPixels, toHex, worldToPixelMatrix,
} from './pixelOps';
import { drawPage } from './draw';
import { runCommand } from '../state/commands';

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
  deactivate?(): void;
}

const CROSS = 'crosshair';

function containerId(ed: Editor): string {
  return ed.activeContainer!.id;
}

function currentFill(ed: Editor) {
  return ed.ui.fillEnabled ? solid(ed.ui.fillColor) : NO_PAINT;
}

function currentStroke(ed: Editor, force = false) {
  if (ed.ui.strokeEnabled || force) return makeStroke(ed.ui.strokeColor, ed.ui.toolOptions.strokeWidth);
  return makeStroke();
}

function addAndSelect(ed: Editor, node: SceneNode, label: string): void {
  ed.commit(label, (d) => addNodes(d, containerId(ed), [node]));
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
    if (this.constrain && this.kind !== 'line') {
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
      case 'ellipse':
        addAndSelect(ed, make.ellipse({ ...base, fill, stroke }), 'Ellipse');
        break;
      case 'polygon':
        addAndSelect(ed, make.polygon({ ...base, sides: opts.polygonSides, fill, stroke }), 'Polygon');
        break;
      case 'star':
        addAndSelect(ed, make.star({ ...base, points: opts.starPoints, innerRatio: opts.starInner, fill, stroke }), 'Star');
        break;
      case 'line': {
        const e = this.lineEnd();
        const cx = (s.x + e.x) / 2;
        const cy = (s.y + e.y) / 2;
        const color = ed.ui.strokeEnabled ? ed.ui.strokeColor : ed.ui.fillColor;
        addAndSelect(ed, make.path({
          name: 'Line', x: cx, y: cy, d: [['M', s.x - cx, s.y - cy], ['L', e.x - cx, e.y - cy]],
          stroke: { ...makeStroke(color, Math.max(1, opts.strokeWidth)), cap: 'round' },
        }), 'Line');
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
      case 'line': {
        const e = this.lineEnd();
        ctx.beginPath();
        ctx.moveTo(this.start.x, this.start.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
        ctx.restore();
        return;
      }
      default: d = rectPath(r.w, r.h, this.kind === 'rect' ? opts.cornerRadius : 0);
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

class PenTool implements Tool {
  cursor = CROSS;
  private anchors: Anchor[] = [];
  private dragging = false;
  private mouse: Point | null = null;
  constructor(private c: ToolContext) {}

  onDown(p: Point) {
    const first = this.anchors[0];
    const z = this.c.viewport.canvas.getZoom();
    if (first && this.anchors.length > 2 && Math.hypot(p.x - first.x, p.y - first.y) < 8 / z) {
      this.finish(true);
      return;
    }
    this.anchors.push({ x: p.x, y: p.y, inX: null, inY: null, outX: null, outY: null });
    this.dragging = true;
  }
  onMove(p: Point) {
    this.mouse = p;
    if (this.dragging) {
      const a = this.anchors[this.anchors.length - 1];
      if (Math.hypot(p.x - a.x, p.y - a.y) > 2) {
        a.outX = p.x;
        a.outY = p.y;
        a.inX = 2 * a.x - p.x;
        a.inY = 2 * a.y - p.y;
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
    if (this.anchors.length >= 2) {
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
    this.c.viewport.drawOverlay();
  }
  deactivate() {
    if (this.anchors.length >= 2) this.finish(false);
    this.anchors = [];
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

class NodeTool implements Tool {
  cursor = 'default';
  private subs: Subpath[] | null = null; // in world coordinates
  private nodeId: string | null = null;
  private drag: NodeHit | null = null;
  private selected: { sub: number; anchor: number } | null = null;
  private moved = false;
  constructor(private c: ToolContext) {
    this.load();
  }

  private load() {
    const ed = this.c.editor;
    const doc = ed.doc;
    const sel = ed.selectedNodes();
    const n = sel[0];
    this.subs = null;
    this.nodeId = null;
    if (!doc || !n || sel.length !== 1) return;
    const d = nodeToPath(n);
    if (!d || !['rect', 'ellipse', 'polygon', 'star', 'path'].includes(n.type)) return;
    const loc = findNode(doc, n.id)!;
    this.nodeId = n.id;
    this.subs = pathToSubpaths(transformPath(d, worldMatrix(loc)));
  }

  private hit(p: Point): NodeHit | null {
    if (!this.subs) return null;
    const r = 7 / this.c.viewport.canvas.getZoom();
    for (let s = 0; s < this.subs.length; s++) {
      const anchors = this.subs[s].anchors;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (a.outX !== null && Math.hypot(p.x - a.outX, p.y - a.outY!) < r) return { sub: s, anchor: i, part: 'out' };
        if (a.inX !== null && Math.hypot(p.x - a.inX, p.y - a.inY!) < r) return { sub: s, anchor: i, part: 'in' };
        if (Math.hypot(p.x - a.x, p.y - a.y) < r) return { sub: s, anchor: i, part: 'anchor' };
      }
    }
    return null;
  }

  onDown(p: Point, _e: MouseEvent, target: SceneNode | null) {
    const h = this.hit(p);
    if (h) {
      this.drag = h;
      this.selected = { sub: h.sub, anchor: h.anchor };
      this.moved = false;
      this.c.viewport.drawOverlay();
      return;
    }
    if (target) {
      this.c.editor.select([target.id]);
      this.load();
    } else {
      this.c.editor.select([]);
      this.subs = null;
      this.nodeId = null;
    }
    this.selected = null;
    this.c.viewport.drawOverlay();
  }

  onMove(p: Point, e: MouseEvent) {
    if (!this.drag || !this.subs) return;
    this.moved = true;
    const a = this.subs[this.drag.sub].anchors[this.drag.anchor];
    if (this.drag.part === 'anchor') {
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      a.x = p.x;
      a.y = p.y;
      if (a.inX !== null) {
        a.inX += dx;
        a.inY! += dy;
      }
      if (a.outX !== null) {
        a.outX += dx;
        a.outY! += dy;
      }
    } else {
      const key = this.drag.part;
      if (key === 'out') {
        a.outX = p.x;
        a.outY = p.y;
        if (!e.altKey && a.inX !== null) {
          const len = Math.hypot(a.inX - a.x, a.inY! - a.y);
          const ang = Math.atan2(p.y - a.y, p.x - a.x) + Math.PI;
          a.inX = a.x + Math.cos(ang) * len;
          a.inY = a.y + Math.sin(ang) * len;
        }
      } else {
        a.inX = p.x;
        a.inY = p.y;
        if (!e.altKey && a.outX !== null) {
          const len = Math.hypot(a.outX - a.x, a.outY! - a.y);
          const ang = Math.atan2(p.y - a.y, p.x - a.x) + Math.PI;
          a.outX = a.x + Math.cos(ang) * len;
          a.outY = a.y + Math.sin(ang) * len;
        }
      }
    }
    this.apply(true);
  }

  onUp() {
    if (this.drag && this.moved) this.apply(false);
    this.drag = null;
  }

  onDblClick(p: Point) {
    const h = this.hit(p);
    if (!h || !this.subs) return;
    const a = this.subs[h.sub].anchors[h.anchor];
    if (a.inX !== null || a.outX !== null) {
      a.inX = a.inY = a.outX = a.outY = null;
    } else {
      // make smooth: handles along neighbour direction
      const list = this.subs[h.sub].anchors;
      const prev = list[(h.anchor - 1 + list.length) % list.length];
      const next = list[(h.anchor + 1) % list.length];
      const dx = (next.x - prev.x) / 6;
      const dy = (next.y - prev.y) / 6;
      a.inX = a.x - dx;
      a.inY = a.y - dy;
      a.outX = a.x + dx;
      a.outY = a.y + dy;
    }
    this.apply(false);
  }

  onKey(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && this.subs) {
      const sp = this.subs[this.selected.sub];
      if (sp.anchors.length > 2) {
        sp.anchors.splice(this.selected.anchor, 1);
        this.selected = null;
        this.apply(false);
      } else if (this.nodeId) {
        const id = this.nodeId;
        this.c.editor.commit('Delete', (d) => removeNodes(d, [id]));
        this.subs = null;
      }
      return true;
    }
    if (e.key === 'Escape') {
      this.c.editor.setTool('move');
      return true;
    }
    return false;
  }

  /** Write world-space anchors back to the node (preview while dragging). */
  private apply(preview: boolean) {
    const ed = this.c.editor;
    const doc = ed.doc;
    if (!doc || !this.subs || !this.nodeId) return;
    const loc = findNode(doc, this.nodeId);
    if (!loc) return;
    const id = this.nodeId;
    const local = transformPath(subpathsToPath(this.subs), invert(worldMatrix(loc)));
    const update = (d0: typeof doc) => {
      let d1 = d0;
      if (loc.node.type !== 'path') d1 = convertToCurves(d1, id);
      return updateNode<PathNode>(d1, id, { d: local, closed: this.subs!.some((s) => s.closed) });
    };
    if (preview) ed.preview(update);
    else ed.commit('Edit nodes', update);
    this.c.viewport.drawOverlay();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    if (!this.subs) {
      this.load();
      if (!this.subs) return;
    }
    ctx.save();
    ctx.strokeStyle = '#2fb8a6';
    ctx.lineWidth = 1 / z;
    ctx.stroke(new Path2D(pathToString(subpathsToPath(this.subs))));
    this.subs.forEach((s, si) => drawAnchors(ctx, s.anchors, z, this.selected?.sub === si ? this.selected.anchor : -1));
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

class CropTool implements Tool {
  cursor = CROSS;
  private start: Point | null = null;
  private rect: { x: number; y: number; w: number; h: number } | null = null;
  constructor(private c: ToolContext) {
    const doc = c.editor.doc;
    if (doc) this.rect = { x: 0, y: 0, w: doc.settings.width, h: doc.settings.height };
  }
  onDown(p: Point) {
    this.start = p;
  }
  onMove(p: Point) {
    if (!this.start) return;
    this.rect = boundsOfPoints([this.start, p]);
    this.c.viewport.drawOverlay();
  }
  onUp() {
    this.start = null;
  }
  onDblClick() {
    this.apply();
  }
  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.apply();
      return true;
    }
    if (e.key === 'Escape') {
      this.c.editor.setTool('move');
      return true;
    }
    return false;
  }
  apply() {
    const r = this.rect;
    const ed = this.c.editor;
    const doc = ed.doc;
    if (!r || !doc || r.w < 2 || r.h < 2) return;
    ed.commit('Crop', (d) => cropDocument(d, r));
    ed.setUi({ pixelSelection: null });
    this.rect = { x: 0, y: 0, w: Math.round(r.w), h: Math.round(r.h) };
    this.c.viewport.zoomToFit();
    ed.setTool('move');
  }
  drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    const r = this.rect;
    if (!r) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const p = new Path2D();
    p.rect(-1e5, -1e5, 2e5, 2e5);
    p.rect(r.x, r.y, r.w, r.h);
    ctx.fill(p, 'evenodd');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / z;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1 / z;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(r.x + (r.w * i) / 3, r.y);
      ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
      ctx.moveTo(r.x, r.y + (r.h * i) / 3);
      ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.font = `${12 / z}px Inter, sans-serif`;
    ctx.fillText(`${Math.round(r.w)} × ${Math.round(r.h)} — Enter to crop`, r.x, r.y - 6 / z);
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
    case 'rect': case 'ellipse': case 'polygon': case 'star': case 'line': case 'textframe': case 'imageframe':
      return new ShapeTool(c, id);
    case 'text': return new TextTool(c);
    case 'pen': return new PenTool(c);
    case 'pencil': return new PencilTool(c);
    case 'node': return new NodeTool(c);
    case 'marquee-rect': return new MarqueeTool(c, 'rect');
    case 'marquee-ellipse': return new MarqueeTool(c, 'ellipse');
    case 'lasso': return new MarqueeTool(c, 'lasso');
    case 'crop': return new CropTool(c);
    case 'brush': return new BrushTool(c, false);
    case 'eraser': return new BrushTool(c, true);
    case 'fill': return new FillTool(c);
    case 'eyedropper': return new EyedropperTool(c);
    default: return new MoveTool(c);
  }
}

export type { RasterNode };
