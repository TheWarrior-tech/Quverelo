/**
 * The editing viewport: a fabric canvas that mirrors the active page/master of
 * the shared document model, plus an overlay canvas for guides, selections and
 * tool feedback. All edits go back through the Editor as undoable commits.
 */
import { ActiveSelection, Canvas, Point, type FabricObject, type TPointerEventInfo } from 'fabric';
import { decompose, multiply, scale as scaleM, type Matrix, type Rect } from '../../core/geometry';
import { findNode, getContainer } from '../../core/document';
import { transformPath, pathToString } from '../../core/path';
import { updateNode, updateNodes } from '../../core/commands';
import type { QuvreloDocument, Id, SceneNode } from '../../core/types';
import type { Editor } from '../state/editor';
import { NodeObject, RESIZE_TYPES } from './NodeObject';
import { renderBounds, type DrawEnv } from './draw';
import { createTool, type Tool, type ToolContext } from './tools';
import { TextEditOverlay } from './textEdit';

class QuvreloCanvas extends Canvas {
  pageW = 100;
  pageH = 100;
  bleed = 0;
  pageBg: string | null = '#ffffff';
  pasteboard = '#0d0e0f';

  _renderBackground(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = this.pasteboard;
    ctx.fillRect(0, 0, this.width, this.height);
    const v = this.viewportTransform;
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    const z = v[0];
    // drop shadow
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = this.pageBg ?? '#ffffff';
    ctx.fillRect(0, 0, this.pageW, this.pageH);
    ctx.shadowColor = 'transparent';
    if (!this.pageBg) {
      // transparency checkerboard
      const s = 8 / z;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, this.pageW, this.pageH);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.pageW, this.pageH);
      ctx.fillStyle = '#d9dce1';
      const cols = Math.ceil(this.pageW / s);
      const rows = Math.ceil(this.pageH / s);
      if (cols * rows < 250000) {
        for (let y = 0; y < rows; y++) for (let x = (y % 2); x < cols; x += 2) ctx.fillRect(x * s, y * s, s, s);
      }
      ctx.restore();
    }
    ctx.restore();
  }
}

export interface SnapLine {
  orientation: 'h' | 'v';
  position: number;
}

export class Viewport {
  readonly host: HTMLElement;
  readonly canvas: QuvreloCanvas;
  readonly overlay: HTMLCanvasElement;
  readonly editor: Editor;
  private objects = new Map<Id, NodeObject>();
  private lastDoc: QuvreloDocument | null = null;
  private lastTheme = '';
  private lastContainer: Id | null = null;
  private syncingSelection = false;
  private tool: Tool;
  private toolId = '';
  private unsub: () => void;
  private resizeObs: ResizeObserver;
  private spaceDown = false;
  private panning: { x: number; y: number; vpt: number[] } | null = null;
  private antsOffset = 0;
  private antsTimer: number | null = null;
  snapLines: SnapLine[] = [];
  textEdit: TextEditOverlay;
  /** set by tools to hide a node from rendering (e.g. while editing text) */
  livePaint: DrawEnv['livePaint'] = null;
  private envCache: DrawEnv | null = null;
  onViewChange: (() => void) | null = null;

  constructor(host: HTMLElement, editor: Editor) {
    this.host = host;
    this.editor = editor;
    const el = document.createElement('canvas');
    el.setAttribute('aria-label', 'Document canvas');
    el.tabIndex = -1;
    host.appendChild(el);
    this.canvas = new QuvreloCanvas(el, {
      width: host.clientWidth,
      height: host.clientHeight,
      preserveObjectStacking: true,
      selectionColor: 'rgba(47,184,166,0.12)',
      selectionBorderColor: '#2fb8a6',
      selectionLineWidth: 1,
      fireRightClick: false,
      stopContextMenu: true,
      enableRetinaScaling: true,
      renderOnAddRemove: false,
      uniformScaling: false,
      uniScaleKey: 'shiftKey',
      altActionKey: 'shiftKey',
      centeredKey: 'altKey',
      targetFindTolerance: 4,
    });
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'viewport-overlay';
    host.appendChild(this.overlay);
    this.textEdit = new TextEditOverlay(this);
    this.tool = createTool('move', this.toolContext());
    this.bindEvents();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.unsub = editor.subscribe(() => this.sync());
    this.resize();
    this.sync();
    this.zoomToFit();
  }

  destroy(): void {
    this.unsub();
    this.resizeObs.disconnect();
    if (this.antsTimer) window.clearInterval(this.antsTimer);
    this.textEdit.destroy();
    this.canvas.dispose();
    this.overlay.remove();
  }

  // -------------------------------------------------------------------------
  // Environment

  env = (): DrawEnv => {
    const doc = this.editor.doc!;
    const e = this.envCache;
    const z = this.canvas.getZoom();
    const hidden = this.editor.ui.editingTextId;
    const preview = this.editor.ui.interacting;
    if (e && e.doc === doc && e.zoom === z && e.hiddenNodeId === hidden && e.preview === preview && e.livePaint === this.livePaint) return e;
    this.envCache = { doc, assets: this.editor.assets, editor: true, preview, hiddenNodeId: hidden, livePaint: this.livePaint, zoom: z };
    return this.envCache;
  };

  toolContext(): ToolContext {
    return { viewport: this, editor: this.editor };
  }

  // -------------------------------------------------------------------------
  // Model → fabric

  sync(): void {
    const ed = this.editor;
    const doc = ed.doc;
    if (!doc) return;
    if (this.toolId !== ed.ui.tool) this.setTool(ed.ui.tool);
    const container = ed.activeContainer;
    if (!container) return;
    const containerChanged = this.lastContainer !== container.id;
    const themeKey = document.documentElement.dataset.theme ?? '';
    if (themeKey !== this.lastTheme) {
      this.lastTheme = themeKey;
      this.canvas.pasteboard = getComputedStyle(document.documentElement).getPropertyValue('--pasteboard').trim() || '#0d0e0f';
      this.canvas.requestRenderAll();
    }
    if (doc !== this.lastDoc || containerChanged) {
      this.envCache = null;
      const c = this.canvas;
      c.pageW = doc.settings.width;
      c.pageH = doc.settings.height;
      c.bleed = doc.settings.bleed;
      c.pageBg = doc.settings.background;
      c.pasteboard = getComputedStyle(document.documentElement).getPropertyValue('--pasteboard').trim() || '#0d0e0f';
      const page = doc.pages.find((p) => p.id === container.id);
      const master = page?.masterId ? doc.masters.find((m) => m.id === page.masterId) : null;
      const desired: { node: SceneNode; master: boolean }[] = [
        ...(master ? master.nodes.map((n) => ({ node: n, master: true })) : []),
        ...container.nodes.map((n) => ({ node: n, master: false })),
      ];
      const keep = new Set<Id>();
      const ordered: NodeObject[] = [];
      const activeObj = c.getActiveObject();
      if (activeObj instanceof ActiveSelection) {
        const changed = activeObj.getObjects().some((o) => {
          const no = o as NodeObject;
          const loc = desired.find((d) => d.node.id === no.nodeId);
          return !loc || loc.node !== no.node;
        });
        if (changed || containerChanged) {
          this.syncingSelection = true;
          c.discardActiveObject();
          this.syncingSelection = false;
        }
      }
      for (const { node, master: isM } of desired) {
        keep.add(node.id);
        let obj = this.objects.get(node.id);
        if (obj && obj.isMaster !== isM) {
          c.remove(obj);
          this.objects.delete(node.id);
          obj = undefined;
        }
        if (!obj) {
          obj = new NodeObject(node, this.env, isM);
          this.applyToolLocks(obj);
          this.objects.set(node.id, obj);
          c.add(obj);
        } else if (obj.node !== node || containerChanged) {
          obj.applyNode(node);
        }
        ordered.push(obj);
      }
      for (const [id, obj] of this.objects) {
        if (!keep.has(id)) {
          if (c.getActiveObject() === obj) {
            this.syncingSelection = true;
            c.discardActiveObject();
            this.syncingSelection = false;
          }
          c.remove(obj);
          this.objects.delete(id);
        }
      }
      const objs = (c as unknown as { _objects: FabricObject[] })._objects;
      objs.length = 0;
      objs.push(...ordered);
      this.lastDoc = doc;
      this.lastContainer = container.id;
    }
    this.syncSelectionFromEditor();
    this.updateAnts();
    this.canvas.requestRenderAll();
    this.textEdit.sync();
  }

  private syncSelectionFromEditor(): void {
    if ((this.canvas as unknown as { _currentTransform: unknown })._currentTransform) return;
    const ed = this.editor;
    const doc = ed.doc!;
    // map selected ids to their top-level fabric objects
    const targets: NodeObject[] = [];
    for (const id of ed.ui.selection) {
      let obj = this.objects.get(id);
      if (!obj) {
        const loc = findNode(doc, id);
        if (loc?.ancestors.length) obj = this.objects.get(loc.ancestors[0].id);
      }
      if (obj && !obj.isMaster && obj.selectable && !targets.includes(obj)) targets.push(obj);
    }
    const current = this.canvas.getActiveObjects() as NodeObject[];
    const same = current.length === targets.length && current.every((o) => targets.includes(o));
    if (same) return;
    this.syncingSelection = true;
    this.canvas.discardActiveObject();
    if (targets.length === 1) this.canvas.setActiveObject(targets[0]);
    else if (targets.length > 1) this.canvas.setActiveObject(new ActiveSelection(targets, { canvas: this.canvas }));
    this.syncingSelection = false;
  }

  objectFor(id: Id): NodeObject | undefined {
    return this.objects.get(id);
  }

  // -------------------------------------------------------------------------
  // fabric → model

  private bindEvents(): void {
    const c = this.canvas;
    const onSel = () => {
      if (this.syncingSelection) return;
      const ids = (c.getActiveObjects() as NodeObject[]).filter((o) => o instanceof NodeObject).map((o) => o.nodeId);
      // painting/drawing tools act on the current selection: don't let canvas clicks clear it
      if (!ids.length && this.toolId !== 'move' && this.toolId !== 'node') return;
      const sel = this.editor.ui.selection;
      // keep a child selection made in the layers panel if its group is the active object
      if (ids.length === 1 && sel.length === 1 && sel[0] !== ids[0]) {
        const loc = findNode(this.editor.doc!, sel[0]);
        if (loc?.ancestors[0]?.id === ids[0]) return;
      }
      this.editor.select(ids);
    };
    c.on('selection:created', onSel);
    c.on('selection:updated', onSel);
    c.on('selection:cleared', onSel);
    c.on('object:modified', (e) => this.commitTransforms(e.target as FabricObject));
    c.on('object:moving', (e) => this.snapMoving(e.target as FabricObject, e.e as MouseEvent));
    c.on('mouse:up', () => {
      if (this.snapLines.length) {
        this.snapLines = [];
        this.drawOverlay();
      }
    });
    c.on('after:render', () => this.drawOverlay());
    c.on('mouse:dblclick', (e) => this.tool.onDblClick?.(e.scenePoint, e.e as MouseEvent, this.targetNode(e)));

    c.on('mouse:down', (e: TPointerEventInfo) => {
      if (this.panning || this.isPanGesture(e.e as MouseEvent)) return;
      this.tool.onDown?.(e.scenePoint, e.e as MouseEvent, this.targetNode(e));
    });
    c.on('mouse:move', (e: TPointerEventInfo) => {
      if (this.panning) return;
      this.tool.onMove?.(e.scenePoint, e.e as MouseEvent);
      this.editor.ui.status = `${Math.round(e.scenePoint.x)}, ${Math.round(e.scenePoint.y)} px`;
      this.onViewChange?.();
    });
    c.on('mouse:up', (e: TPointerEventInfo) => {
      if (this.panning) return;
      this.tool.onUp?.(e.scenePoint, e.e as MouseEvent);
    });

    const upper = this.host;
    upper.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false });
    upper.addEventListener('pointerdown', (ev) => {
      if (this.isPanGesture(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        this.panning = { x: ev.clientX, y: ev.clientY, vpt: [...this.canvas.viewportTransform] };
        upper.setPointerCapture(ev.pointerId);
        upper.classList.add('panning');
      }
    }, { capture: true });
    upper.addEventListener('pointermove', (ev) => {
      if (!this.panning) return;
      const v = [...this.panning.vpt] as Matrix;
      v[4] += ev.clientX - this.panning.x;
      v[5] += ev.clientY - this.panning.y;
      this.setVpt(v);
    });
    const endPan = (ev: PointerEvent) => {
      if (!this.panning) return;
      this.panning = null;
      upper.classList.remove('panning');
      try {
        upper.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };
    upper.addEventListener('pointerup', endPan);
    upper.addEventListener('pointercancel', endPan);
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space' && !isEditable(ev.target)) {
        if (!this.spaceDown) {
          this.spaceDown = true;
          this.host.classList.add('pan-ready');
        }
        ev.preventDefault();
      }
    });
    window.addEventListener('keyup', (ev) => {
      if (ev.code === 'Space') {
        this.spaceDown = false;
        this.host.classList.remove('pan-ready');
      }
    });
  }

  private isPanGesture(ev: MouseEvent): boolean {
    return ev.button === 1 || this.spaceDown || (this.editor.ui.tool === 'hand' && ev.button === 0);
  }

  private targetNode(e: TPointerEventInfo): SceneNode | null {
    const t = e.target as NodeObject | undefined;
    if (t && t instanceof NodeObject && !t.isMaster) return t.node;
    return null;
  }

  /** Read a fabric object's transform back into its node. */
  private nodeFromObject(obj: NodeObject): SceneNode {
    const node = obj.node;
    const m = obj.calcTransformMatrix() as unknown as Matrix;
    const off = obj.centreOffset();
    const inGroup = !!obj.group;
    let t: Pick<SceneNode, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'skewX' | 'flipX' | 'flipY'>;
    if (!inGroup) {
      t = {
        x: 0, y: 0,
        rotation: ((obj.angle % 360) + 360) % 360,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        skewX: obj.skewX,
        flipX: obj.flipX,
        flipY: obj.flipY,
      };
    } else {
      t = decompose(m);
    }
    // node origin sits at -off in the object's local frame
    const ox = m[0] * -off.x + m[2] * -off.y + m[4];
    const oy = m[1] * -off.x + m[3] * -off.y + m[5];
    let next: SceneNode = { ...node, ...t, x: ox, y: oy } as SceneNode;
    if (RESIZE_TYPES.has(node.type) && 'w' in next) {
      const sx = Math.abs(next.scaleX);
      const sy = Math.abs(next.scaleY);
      next = { ...next, w: Math.max(1, (next as { w: number }).w * sx), h: Math.max(1, (next as { h: number }).h * sy), scaleX: 1, scaleY: 1 } as SceneNode;
      if (next.type === 'textframe' || next.type === 'imageframe') {
        // frames never flip their content
        next = { ...next, flipX: false, flipY: false };
      }
    } else if (next.type === 'path') {
      const sx = next.scaleX;
      const sy = next.scaleY;
      if (Math.abs(sx - 1) > 1e-9 || Math.abs(sy - 1) > 1e-9) {
        next = { ...next, d: transformPath(next.d, scaleM(sx, sy)), scaleX: 1, scaleY: 1 };
      }
    }
    return next;
  }

  private committing = false;

  private commitTransforms(target: FabricObject): void {
    if (this.committing) return;
    this.committing = true;
    try {
      this.commitTransformsInner(target);
    } finally {
      this.committing = false;
    }
  }

  private commitTransformsInner(target: FabricObject): void {
    const objs = (target instanceof ActiveSelection ? target.getObjects() : [target]).filter((o): o is NodeObject => o instanceof NodeObject);
    if (!objs.length) return;
    const updates = new Map<Id, SceneNode>();
    for (const o of objs) updates.set(o.nodeId, this.nodeFromObject(o));
    const multi = target instanceof ActiveSelection;
    if (multi) {
      this.syncingSelection = true;
      this.canvas.discardActiveObject();
      this.syncingSelection = false;
    }
    this.editor.commit(multi ? 'Transform objects' : 'Transform', (doc) =>
      updateNodes(doc, [...updates.keys()], (n) => updates.get(n.id) ?? n),
    );
    this.syncSelectionFromEditor();
    this.canvas.requestRenderAll();
  }

  // -------------------------------------------------------------------------
  // Snapping

  private snapMoving(target: FabricObject, ev: MouseEvent): void {
    this.snapLines = [];
    if (!this.editor.settings.snapping || ev?.altKey) return;
    const doc = this.editor.doc!;
    const z = this.canvas.getZoom();
    const tol = 6 / z;
    const b = target.getBoundingRect();
    const xs = [b.left, b.left + b.width / 2, b.left + b.width];
    const ys = [b.top, b.top + b.height / 2, b.top + b.height];
    const { width: W, height: H, margins } = doc.settings;
    const candX: number[] = [0, W / 2, W, margins.left, W - margins.right];
    const candY: number[] = [0, H / 2, H, margins.top, H - margins.bottom];
    for (const g of doc.guides) (g.orientation === 'v' ? candX : candY).push(g.position);
    const moving = new Set(target instanceof ActiveSelection ? target.getObjects() : [target]);
    for (const o of this.canvas.getObjects()) {
      if (moving.has(o) || !o.visible) continue;
      const r = o.getBoundingRect();
      candX.push(r.left, r.left + r.width / 2, r.left + r.width);
      candY.push(r.top, r.top + r.height / 2, r.top + r.height);
    }
    const best = (vals: number[], cands: number[]) => {
      let bd = Infinity;
      let delta = 0;
      let pos = 0;
      for (const v of vals) for (const c of cands) {
        const d = Math.abs(c - v);
        if (d < bd) {
          bd = d;
          delta = c - v;
          pos = c;
        }
      }
      return bd <= tol ? { delta, pos } : null;
    };
    const sx = best(xs, candX);
    const sy = best(ys, candY);
    if (sx) {
      target.set('left', (target.left ?? 0) + sx.delta);
      this.snapLines.push({ orientation: 'v', position: sx.pos });
    }
    if (sy) {
      target.set('top', (target.top ?? 0) + sy.delta);
      this.snapLines.push({ orientation: 'h', position: sy.pos });
    }
    if (sx || sy) target.setCoords();
  }

  // -------------------------------------------------------------------------
  // Tools

  setTool(id: string): void {
    this.tool.deactivate?.();
    this.toolId = id;
    this.tool = createTool(id as never, this.toolContext());
    const c = this.canvas;
    const isMove = id === 'move';
    c.selection = isMove;
    c.skipTargetFind = !(isMove || id === 'node' || id === 'textframe' || id === 'text' || id === 'imageframe');
    c.defaultCursor = this.tool.cursor ?? 'default';
    c.hoverCursor = isMove ? 'move' : this.tool.cursor ?? 'default';
    for (const o of this.objects.values()) this.applyToolLocks(o);
    this.host.dataset.tool = id;
    c.requestRenderAll();
  }

  /** Only the Move tool may drag, scale or rotate objects directly. */
  private applyToolLocks(o: NodeObject): void {
    const isMove = this.toolId === 'move';
    o.hasControls = isMove;
    o.hasBorders = isMove || this.toolId === 'node';
    o.lockMovementX = o.lockMovementY = !isMove;
    o.lockRotation = o.lockScalingX = o.lockScalingY = !isMove;
  }

  get activeTool(): Tool {
    return this.tool;
  }

  // -------------------------------------------------------------------------
  // View

  resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.canvas.setDimensions({ width: w, height: h });
    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.round(w * dpr);
    this.overlay.height = Math.round(h * dpr);
    this.overlay.style.width = w + 'px';
    this.overlay.style.height = h + 'px';
    this.canvas.requestRenderAll();
  }

  setVpt(v: Matrix): void {
    this.canvas.setViewportTransform(v as never);
    this.editor.ui.zoom = v[0];
    (window as unknown as { __quvreloVpt: number[] }).__quvreloVpt = [...v];
    this.envCache = null;
    this.canvas.requestRenderAll();
    this.textEdit.sync();
    this.onViewChange?.();
  }

  get vpt(): Matrix {
    return [...this.canvas.viewportTransform] as Matrix;
  }

  zoomTo(z: number, screen?: { x: number; y: number }): void {
    const clamped = Math.min(64, Math.max(0.02, z));
    const p = screen ?? { x: this.canvas.width / 2, y: this.canvas.height / 2 };
    this.canvas.zoomToPoint(new Point(p.x, p.y), clamped);
    this.setVpt(this.vpt);
  }

  zoomBy(f: number, screen?: { x: number; y: number }): void {
    this.zoomTo(this.canvas.getZoom() * f, screen);
  }

  zoomToFit(): void {
    const doc = this.editor.doc;
    if (!doc) return;
    const W = doc.settings.width;
    const H = doc.settings.height;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (!cw || !ch) return;
    const z = Math.min((cw - 80) / W, (ch - 80) / H);
    this.setVpt([z, 0, 0, z, (cw - W * z) / 2, (ch - H * z) / 2]);
  }

  zoomToRect(r: Rect): void {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const z = Math.min(64, Math.min((cw - 40) / Math.max(1, r.w), (ch - 40) / Math.max(1, r.h)));
    this.setVpt([z, 0, 0, z, cw / 2 - (r.x + r.w / 2) * z, ch / 2 - (r.y + r.h / 2) * z]);
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const rect = this.host.getBoundingClientRect();
    const p = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    if (ev.ctrlKey || ev.metaKey) {
      const f = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0025));
      this.zoomBy(f, p);
    } else {
      const v = this.vpt;
      const k = ev.deltaMode === 1 ? 20 : 1;
      if (ev.shiftKey && !ev.deltaX) v[4] -= ev.deltaY * k;
      else {
        v[4] -= ev.deltaX * k;
        v[5] -= ev.deltaY * k;
      }
      this.setVpt(v);
    }
  }

  screenToScene(x: number, y: number): { x: number; y: number } {
    const v = this.vpt;
    return { x: (x - v[4]) / v[0], y: (y - v[5]) / v[3] };
  }

  sceneToScreen(x: number, y: number): { x: number; y: number } {
    const v = this.vpt;
    return { x: x * v[0] + v[4], y: y * v[3] + v[5] };
  }

  /** Bounds of nodes using real metrics (for align/snap). */
  boundsOf = (n: SceneNode): Rect => renderBounds(n);

  // -------------------------------------------------------------------------
  // Overlay

  private updateAnts(): void {
    const need = !!this.editor.ui.pixelSelection && !this.editor.settings.reduceMotion;
    if (need && !this.antsTimer) {
      this.antsTimer = window.setInterval(() => {
        this.antsOffset = (this.antsOffset + 1) % 16;
        this.drawOverlay();
      }, 90);
    } else if (!need && this.antsTimer) {
      window.clearInterval(this.antsTimer);
      this.antsTimer = null;
    }
  }

  drawOverlay(): void {
    const ctx = this.overlay.getContext('2d');
    const doc = this.editor.doc;
    if (!ctx || !doc) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const v = this.vpt;
    ctx.setTransform(dpr * v[0], 0, 0, dpr * v[3], dpr * v[4], dpr * v[5]);
    const z = v[0];
    const px = 1 / z;
    const { width: W, height: H, margins, bleed, columns, columnGutter } = doc.settings;
    // bleed
    if (bleed > 0) {
      ctx.strokeStyle = 'rgba(230,57,70,0.7)';
      ctx.lineWidth = px;
      ctx.setLineDash([]);
      ctx.strokeRect(-bleed, -bleed, W + 2 * bleed, H + 2 * bleed);
    }
    // margins and columns
    if (margins.top || margins.left || margins.right || margins.bottom) {
      ctx.strokeStyle = 'rgba(255,107,74,0.75)';
      ctx.lineWidth = px;
      ctx.strokeRect(margins.left, margins.top, W - margins.left - margins.right, H - margins.top - margins.bottom);
      if (columns > 1) {
        const inner = W - margins.left - margins.right;
        const cw = (inner - (columns - 1) * columnGutter) / columns;
        ctx.strokeStyle = 'rgba(255,107,74,0.4)';
        for (let i = 1; i < columns; i++) {
          const x = margins.left + i * cw + (i - 1) * columnGutter;
          ctx.beginPath();
          ctx.moveTo(x, margins.top);
          ctx.lineTo(x, H - margins.bottom);
          ctx.moveTo(x + columnGutter, margins.top);
          ctx.lineTo(x + columnGutter, H - margins.bottom);
          ctx.stroke();
        }
      }
    }
    // ruler guides
    ctx.strokeStyle = 'rgba(56,189,230,0.9)';
    ctx.lineWidth = px;
    for (const g of doc.guides) {
      ctx.beginPath();
      if (g.orientation === 'v') {
        ctx.moveTo(g.position, -1e5);
        ctx.lineTo(g.position, 1e5);
      } else {
        ctx.moveTo(-1e5, g.position);
        ctx.lineTo(1e5, g.position);
      }
      ctx.stroke();
    }
    // snapping feedback
    ctx.strokeStyle = '#ff6b4a';
    for (const s of this.snapLines) {
      ctx.beginPath();
      if (s.orientation === 'v') {
        ctx.moveTo(s.position, -1e5);
        ctx.lineTo(s.position, 1e5);
      } else {
        ctx.moveTo(-1e5, s.position);
        ctx.lineTo(1e5, s.position);
      }
      ctx.stroke();
    }
    // text frame links for the selected frame's story
    this.drawFrameLinks(ctx, px);
    // pixel selection (marching ants)
    const sel = this.editor.ui.pixelSelection;
    if (sel && sel.length) {
      const p = new Path2D(pathToString(sel));
      ctx.lineWidth = px;
      ctx.setLineDash([4 * px, 4 * px]);
      ctx.strokeStyle = '#000';
      ctx.lineDashOffset = -this.antsOffset * px;
      ctx.stroke(p);
      ctx.strokeStyle = '#fff';
      ctx.lineDashOffset = -this.antsOffset * px + 4 * px;
      ctx.stroke(p);
      ctx.setLineDash([]);
    }
    this.tool.drawOverlay?.(ctx, z);
  }

  private drawFrameLinks(ctx: CanvasRenderingContext2D, px: number): void {
    const doc = this.editor.doc!;
    const sel = this.editor.selectedNodes();
    const container = this.editor.activeContainer;
    if (!container) return;
    for (const n of sel) {
      if (n.type !== 'textframe') continue;
      const story = doc.stories[n.storyId];
      if (!story || story.chain.length < 2) continue;
      const pts: { x: number; y: number; on: boolean }[] = [];
      for (const fid of story.chain) {
        const loc = findNode(doc, fid);
        if (!loc || loc.node.type !== 'textframe') continue;
        const f = loc.node;
        pts.push({ x: f.x, y: f.y, on: getContainer(doc, loc.container.id)?.id === container.id });
      }
      ctx.strokeStyle = 'rgba(47,184,166,0.9)';
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      for (let i = 1; i < pts.length; i++) {
        if (!pts[i - 1].on || !pts[i].on) continue;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  /** Matrix from a node's local space to screen pixels (CSS). */
  screenMatrixFor(id: Id): Matrix | null {
    const doc = this.editor.doc;
    if (!doc) return null;
    const loc = findNode(doc, id);
    if (!loc) return null;
    let m: Matrix = this.vpt;
    for (const g of loc.ancestors) m = multiply(m, nodeMatrixOf(g));
    return multiply(m, nodeMatrixOf(loc.node));
  }

  /** Force a re-render (e.g. live paint). */
  render(): void {
    this.envCache = null;
    this.canvas.requestRenderAll();
  }

  updateNodeLive(id: Id, patch: Partial<SceneNode>): void {
    this.editor.preview((d) => updateNode(d, id, patch));
  }
}

import { composeTransform } from '../../core/geometry';
function nodeMatrixOf(n: SceneNode): Matrix {
  return composeTransform(n);
}

export function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
