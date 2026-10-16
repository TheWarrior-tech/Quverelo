/**
 * The editing viewport: a fabric canvas that mirrors the active page/master of
 * the shared document model, plus an overlay canvas for guides, selections and
 * tool feedback. All edits go back through the Editor as undoable commits.
 */
import { reparentToArtboards } from '../../core/artboards';
import { ActiveSelection, Canvas, Point, type FabricObject, type TPointerEventInfo } from 'fabric';
import { hairline, sceneLine } from './hairline';
import { decompose, multiply, scale as scaleM, type Matrix, type Rect } from '../../core/geometry';
import { findNode, getContainer } from '../../core/document';
import { transformPath, pathToString } from '../../core/path';
import { updateNode, updateNodes } from '../../core/commands';
import type { QuvreloDocument, Id, SceneNode } from '../../core/types';
import type { Editor } from '../state/editor';
import { NodeObject, RESIZE_TYPES } from './NodeObject';
import { renderBounds, type DrawEnv } from './draw';
import { formatLength } from '../../core/units';
import { createTool, type Tool, type ToolContext } from './tools';
import { TextEditOverlay } from './textEdit';
import { HANDLE_SIZE, readOverlayColors, tuneControls, type OverlayColors } from './controls';

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

  /**
   * Fabric still does hit-testing and transforms, but the selection chrome is
   * drawn by the viewport overlay so it looks the same for every tool and
   * stays a constant screen size at any zoom.
   */
  drawControls(_ctx: CanvasRenderingContext2D): void {
    /* drawn in Viewport.drawSelectionChrome */
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
  /** canvas overlay colours for the current theme (refreshed on theme change in sync) */
  private ov: OverlayColors = readOverlayColors();
  /** Theme overlay colours (re-read on theme change); tools draw their canvas chrome with these. */
  get overlayColors(): OverlayColors {
    return this.ov;
  }
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
  /** node under the pointer (canvas) or under a hovered layer row; drawn as a 1px outline */
  private hoverId: Id | null = null;
  private pointerDown = false;
  private chromeListeners = new Set<() => void>();
  /** additional view-change listeners (pan/zoom/pointer move), for canvas-anchored UI */
  readonly viewListeners = new Set<() => void>();

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

  private onWindowPointerUp = (): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    this.notifyChrome();
  };

  /** Subscribe to selection-chrome changes (render, pan, zoom, drag start/end). */
  onChrome(fn: () => void): () => void {
    this.chromeListeners.add(fn);
    return () => this.chromeListeners.delete(fn);
  }

  private notifyChrome(): void {
    for (const fn of this.chromeListeners) fn();
  }

  /** True while the user is dragging on the canvas or transforming the selection. */
  get interacting(): boolean {
    return this.pointerDown || !!(this.canvas as unknown as { _currentTransform: unknown })._currentTransform || !!this.panning;
  }

  /**
   * Screen rect (CSS px, relative to the viewport host) of the selection
   * bounding box while it is drawn with handles, else null.
   */
  selectionRect(): { x: number; y: number; w: number; h: number } | null {
    const obj = this.canvas.getActiveObject();
    if (!obj || !this.showsObjectSelection()) return null;
    const oc = obj.calcOCoords() as Record<string, { x: number; y: number }>;
    const pts = ['tl', 'tr', 'br', 'bl'].map((k) => oc[k]).filter(Boolean);
    if (pts.length < 4) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  /** Highlight a node with the hover outline (from the canvas or a layer row). */
  setHover(id: Id | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.drawOverlay();
  }

  destroy(): void {
    window.removeEventListener('pointerup', this.onWindowPointerUp, { capture: true });
    this.chromeListeners.clear();
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
      this.ov = readOverlayColors();
      this.canvas.selectionBorderColor = this.ov.selection;
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
      type Desired = { node: SceneNode; master: boolean; shell?: boolean; parent?: Extract<SceneNode, { type: 'group' }> };
      const desired: Desired[] = [...(master ? master.nodes.map((n) => ({ node: n, master: true })) : [])];
      for (const n of container.nodes) {
        // artboards: the board, then each object on it as its own canvas object
        if (n.type === 'group' && n.artboard && page) {
          desired.push({ node: n, master: false, shell: true });
          for (const ch of n.children) desired.push({ node: ch, master: false, parent: n });
        } else desired.push({ node: n, master: false });
      }
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
      for (const { node, master: isM, shell, parent } of desired) {
        keep.add(node.id);
        let obj = this.objects.get(node.id);
        if (obj && obj.isMaster !== isM) {
          c.remove(obj);
          this.objects.delete(node.id);
          obj = undefined;
        }
        const offset = parent ? { x: parent.x, y: parent.y } : { x: 0, y: 0 };
        const clip = parent?.artboard ? { x: parent.x - parent.artboard.w / 2, y: parent.y - parent.artboard.h / 2, w: parent.artboard.w, h: parent.artboard.h } : null;
        const moved = !!obj && (obj.offset.x !== offset.x || obj.offset.y !== offset.y || obj.parentId !== (parent?.id ?? null));
        if (!obj) {
          obj = new NodeObject(node, this.env, isM);
          obj.shell = !!shell;
          obj.parentId = parent?.id ?? null;
          obj.clip = clip;
          obj.applyNode(node, offset);
          this.applyToolLocks(obj);
          this.objects.set(node.id, obj);
          c.add(obj);
        } else if (obj.node !== node || containerChanged || moved || obj.shell !== !!shell) {
          obj.shell = !!shell;
          obj.parentId = parent?.id ?? null;
          obj.clip = clip;
          obj.applyNode(node, offset);
          this.applyToolLocks(obj);
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
    else if (targets.length > 1) {
      const a = new ActiveSelection(targets, { canvas: this.canvas });
      tuneControls(a);
      this.canvas.setActiveObject(a);
    }
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
    const tuneActive = () => {
      const a = c.getActiveObject();
      if (a) tuneControls(a);
    };
    c.on('selection:created', tuneActive);
    c.on('selection:updated', tuneActive);
    c.on('selection:created', onSel);
    c.on('selection:updated', onSel);
    c.on('selection:cleared', onSel);
    c.on('object:modified', (e) => this.commitTransforms(e.target as FabricObject));
    c.on('object:moving', (e) => {
      this.snapMoving(e.target as FabricObject, e.e as MouseEvent);
      this.dragArtboardContent(e.target as FabricObject);
    });
    c.on('mouse:up', () => {
      if (this.snapLines.length) {
        this.snapLines = [];
        this.drawOverlay();
      }
    });
    c.on('after:render', () => this.drawOverlay());
    c.on('mouse:over', (e) => {
      const t = e.target as NodeObject | undefined;
      if (t instanceof NodeObject && !t.isMaster) this.setHover(t.nodeId);
    });
    c.on('mouse:out', (e) => {
      const t = e.target as NodeObject | undefined;
      if (t instanceof NodeObject && t.nodeId === this.hoverId) this.setHover(null);
    });
    c.on('mouse:dblclick', (e) => this.tool.onDblClick?.(e.scenePoint, e.e as MouseEvent, this.targetNode(e)));

    c.on('mouse:down', (e: TPointerEventInfo) => {
      if (this.panning || this.isPanGesture(e.e as MouseEvent)) return;
      this.tool.onDown?.(e.scenePoint, e.e as MouseEvent, this.targetNode(e));
    });
    c.on('mouse:move', (e: TPointerEventInfo) => {
      if (this.panning) return;
      this.tool.onMove?.(e.scenePoint, e.e as MouseEvent);
      // cursor position in the document unit; whole pixels in a px document
      const u = this.editor.unit;
      const digits = u === 'px' ? 0 : undefined;
      this.editor.ui.status = `${formatLength(e.scenePoint.x, u, { digits, suffix: false })}, ${formatLength(e.scenePoint.y, u, { digits })}`;
      this.onViewChange?.();
      for (const l of this.viewListeners) l();
    });
    c.on('mouse:up', (e: TPointerEventInfo) => {
      if (this.panning) return;
      this.tool.onUp?.(e.scenePoint, e.e as MouseEvent);
    });

    const upper = this.host;
    upper.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false });
    // the floating selection toolbar hides while the pointer is down on the canvas
    upper.addEventListener('pointerdown', () => {
      this.pointerDown = true;
      this.notifyChrome();
    }, { capture: true });
    window.addEventListener('pointerup', this.onWindowPointerUp, { capture: true });
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
    let next: SceneNode = { ...node, ...t, x: ox - obj.offset.x, y: oy - obj.offset.y } as SceneNode;
    if (next.type === 'group' && next.artboard) {
      // boards resize; their content is never stretched
      next = { ...next, artboard: { ...next.artboard, w: Math.max(1, next.artboard.w * Math.abs(next.scaleX)), h: Math.max(1, next.artboard.h * Math.abs(next.scaleY)) }, scaleX: 1, scaleY: 1, flipX: false, flipY: false, rotation: 0 };
    } else if (RESIZE_TYPES.has(node.type) && 'w' in next) {
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

  /** While an artboard is dragged, the objects on it follow (they are separate canvas objects). */
  private dragArtboardContent(target: FabricObject): void {
    const boards = (target instanceof ActiveSelection ? target.getObjects() : [target]).filter((o): o is NodeObject => o instanceof NodeObject && o.shell);
    for (const b of boards) {
      const node = b.node as Extract<SceneNode, { type: 'group' }>;
      const m = b.calcTransformMatrix();
      const dx = m[4] - node.x;
      const dy = m[5] - node.y;
      const clip = node.artboard ? { x: m[4] - node.artboard.w / 2, y: m[5] - node.artboard.h / 2, w: node.artboard.w, h: node.artboard.h } : null;
      for (const o of this.objects.values()) {
        if (o.parentId !== node.id) continue;
        o.set({ left: (o.left ?? 0) - (o.offset.x - node.x) + dx - 0, top: (o.top ?? 0) - (o.offset.y - node.y) + dy });
        o.offset = { x: node.x + dx, y: node.y + dy };
        o.clip = clip;
        o.setCoords();
      }
    }
  }

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
    const pageId = this.editor.activeContainer?.id;
    const vector = this.editor.ui.studio === 'vector';
    this.editor.commit(multi ? 'Transform objects' : 'Transform', (doc) => {
      const moved = updateNodes(doc, [...updates.keys()], (n) => updates.get(n.id) ?? n);
      // objects dropped onto / dragged off an artboard change board (Vector)
      return vector && pageId && doc.pages.some((p) => p.id === pageId) ? reparentToArtboards(moved, [...updates.keys()], pageId) : moved;
    });
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
    c.skipTargetFind = !(isMove || id === 'node' || id === 'textframe' || id === 'text' || id === 'imageframe' || id === 'gradient' || id === 'artboard');
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
    for (const l of this.viewListeners) l();
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

  /** The pixel selection belongs to Photo; other studios keep it in the model but never draw it. */
  private showsPixelSelection(): boolean {
    return this.editor.ui.studio === 'photo' && !!this.editor.ui.pixelSelection?.length;
  }

  private updateAnts(): void {
    // honour both the in-app setting and the OS preference (DESIGN.md §2 rule 9)
    const osReduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const need = this.showsPixelSelection() && !this.editor.settings.reduceMotion && !osReduce;
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
    // hairlines are whole device pixels at any display scale (1 CSS px at 150 % would blur)
    const hl = hairline(dpr);
    const px = hl.width / z;
    const sx = (x: number) => sceneLine(hl, x, v[0], v[4]);
    const sy = (y: number) => sceneLine(hl, y, v[3], v[5]);
    if (this.editor.ui.studio === 'layout') this.drawPageGuides(ctx, px, sx, sy);
    // ruler guides
    ctx.strokeStyle = 'rgba(56,189,230,0.9)';
    ctx.lineWidth = px;
    for (const g of doc.guides) {
      ctx.beginPath();
      if (g.orientation === 'v') {
        ctx.moveTo(sx(g.position), -1e5);
        ctx.lineTo(sx(g.position), 1e5);
      } else {
        ctx.moveTo(-1e5, sy(g.position));
        ctx.lineTo(1e5, sy(g.position));
      }
      ctx.stroke();
    }
    // snapping feedback
    ctx.strokeStyle = '#ff6b4a';
    for (const s of this.snapLines) {
      ctx.beginPath();
      if (s.orientation === 'v') {
        ctx.moveTo(sx(s.position), -1e5);
        ctx.lineTo(sx(s.position), 1e5);
      } else {
        ctx.moveTo(-1e5, sy(s.position));
        ctx.lineTo(1e5, sy(s.position));
      }
      ctx.stroke();
    }
    // text frame links for the selected frame's story
    this.drawFrameLinks(ctx, px);
    // pixel selection (marching ants)
    const sel = this.editor.ui.pixelSelection;
    if (sel && this.showsPixelSelection()) {
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
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawHover(ctx);
    this.drawSelectionChrome(ctx);
    // tool chrome that must stay crisp and fixed-size at any zoom (crop handles, click markers)
    this.tool.drawScreenOverlay?.(ctx);
    ctx.restore();
    this.notifyChrome();
  }

  /**
   * Hover: a 1px accent outline and nothing else, so it can never be read as a
   * selection (which adds handles). Skipped for selected nodes and while dragging.
   */
  private drawHover(ctx: CanvasRenderingContext2D): void {
    const id = this.hoverId;
    if (!id || this.editor.ui.selection.includes(id) || this.interacting || !this.showsObjectSelection()) return;
    let obj = this.objects.get(id);
    if (!obj && this.editor.doc) {
      const loc = findNode(this.editor.doc, id);
      if (loc?.ancestors.length) obj = this.objects.get(loc.ancestors[0].id);
    }
    if (!obj || obj.isMaster || !obj.visible) return;
    const { tl, tr, br, bl } = obj.calcOCoords() as Record<string, { x: number; y: number }>;
    if (!tl || !tr || !br || !bl) return;
    const hl = hairline();
    ctx.lineWidth = hl.width;
    ctx.setLineDash([]);
    ctx.strokeStyle = this.ov.selection;
    ctx.beginPath();
    ctx.moveTo(hl.line(tl.x), hl.line(tl.y));
    ctx.lineTo(hl.line(tr.x), hl.line(tr.y));
    ctx.lineTo(hl.line(br.x), hl.line(br.y));
    ctx.lineTo(hl.line(bl.x), hl.line(bl.y));
    ctx.closePath();
    ctx.stroke();
  }

  /** Which tools show the object bounding box. Photo shows it only for Move (like Affinity's Pixel persona). */
  private showsObjectSelection(): boolean {
    const t = this.toolId;
    if (t === 'node' || t === 'crop' || this.editor.ui.editingTextId) return false;
    if (this.editor.ui.studio === 'photo') return t === 'move';
    return true;
  }

  /**
   * 1px accent bounding box, 7px square handles and a rotation handle, drawn in
   * screen space (CSS px) so they keep their size at any zoom. Positions come
   * from fabric's own control coordinates so what you see is what you grab.
   */
  private drawSelectionChrome(ctx: CanvasRenderingContext2D): void {
    const obj = this.canvas.getActiveObject();
    if (!obj || !this.showsObjectSelection()) return;
    const oc = obj.calcOCoords() as Record<string, { x: number; y: number }>;
    const { tl, tr, br, bl, mt, mtr } = oc;
    if (!tl || !tr || !br || !bl) return;
    // whole device pixels at 125–200 % too: a 1px CSS line at 150 % would be 1.5 device px
    const hl = hairline();
    const crisp = hl.line;
    const axisAligned = Math.abs(tl.y - tr.y) < 0.01 && Math.abs(tl.x - bl.x) < 0.01;
    ctx.lineWidth = hl.width;
    ctx.setLineDash([]);
    ctx.strokeStyle = this.ov.selection;
    ctx.beginPath();
    if (axisAligned) {
      const x0 = crisp(Math.min(tl.x, br.x));
      const y0 = crisp(Math.min(tl.y, br.y));
      const x1 = crisp(Math.max(tl.x, br.x));
      const y1 = crisp(Math.max(tl.y, br.y));
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
    } else {
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
    }
    ctx.stroke();
    // multi-selection: each member gets a quiet outline so it is clear what is included
    const members = (obj as unknown as { getObjects?: () => FabricObject[] }).getObjects?.() ?? [];
    if (members.length > 1) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      for (const m of members) {
        const c = m.calcOCoords() as Record<string, { x: number; y: number }>;
        const q = [c.tl, c.tr, c.br, c.bl];
        if (q.some((p) => !p)) continue;
        ctx.beginPath();
        q.forEach((p, i) => (i ? ctx.lineTo(crisp(p.x), crisp(p.y)) : ctx.moveTo(crisp(p.x), crisp(p.y))));
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }
    const interactive = this.toolId === 'move' && obj.hasControls !== false;
    const w = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const h = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const keys = ['tl', 'tr', 'br', 'bl'];
    // edge handles only when there is room for them between the corners
    if (w > HANDLE_SIZE * 4) keys.push('mt', 'mb');
    if (h > HANDLE_SIZE * 4) keys.push('ml', 'mr');
    if (interactive && mt && mtr && !obj.lockRotation) {
      ctx.beginPath();
      ctx.moveTo(mt.x, mt.y);
      ctx.lineTo(mtr.x, mtr.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mtr.x, mtr.y, HANDLE_SIZE / 2, 0, Math.PI * 2);
      ctx.fillStyle = this.ov.handle;
      ctx.fill();
      ctx.strokeStyle = this.ov.ring;
      ctx.stroke();
      ctx.strokeStyle = this.ov.selection;
    }
    // accent handles with a 1px white ring: read on dark, light and photographic content alike
    // handle squares centred on the outline's device pixel, sizes in whole device pixels with the
    // outline's parity so the square stays symmetric about the line
    const H = hl.stroke(HANDLE_SIZE);
    const one = hl.width;
    for (const k of keys) {
      const p = oc[k];
      if (!p) continue;
      const x = crisp(p.x) - H / 2;
      const y = crisp(p.y) - H / 2;
      ctx.fillStyle = this.ov.ring;
      ctx.fillRect(x - one, y - one, H + 2 * one, H + 2 * one);
      ctx.fillStyle = this.ov.handle;
      ctx.fillRect(x, y, H, H);
    }
    ctx.strokeStyle = this.ov.selection;
    // live W×H while transforming
    if ((this.canvas as unknown as { _currentTransform: unknown })._currentTransform) {
      const r = obj.getBoundingRect();
      const label = `${Math.round(r.width)} × ${Math.round(r.height)}`;
      const ys = [tl.y, tr.y, br.y, bl.y];
      const xs = [tl.x, tr.x, br.x, bl.x];
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const by = Math.max(...ys) + 10;
      ctx.font = '500 11px Inter, sans-serif';
      (ctx as CanvasRenderingContext2D & { fontVariantNumeric?: string }).fontVariantNumeric = 'tabular-nums';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = this.ov.selection;
      ctx.beginPath();
      ctx.roundRect(Math.round(cx - tw / 2), Math.round(by), Math.round(tw), 18, 4);
      ctx.fill();
      ctx.fillStyle = '#06231e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, Math.round(cx), Math.round(by) + 9.5);
    }
  }

  /**
   * Layout studio page furniture: page edge hairline, bleed (dashed), margin
   * box and column guides (coral, DESIGN.md section 3). Photo and Vector never
   * show them, which is part of what makes Layout read as its own studio.
   */
  private drawPageGuides(ctx: CanvasRenderingContext2D, px: number, sx: (x: number) => number = (x) => x, sy: (y: number) => number = (y) => y): void {
    const doc = this.editor.doc!;
    const { width: W, height: H, margins, bleed, columns, columnGutter } = doc.settings;
    // edges snapped to crisp device-pixel hairlines (sx/sy)
    const box = (x0: number, y0: number, x1: number, y1: number) => ctx.strokeRect(sx(x0), sy(y0), sx(x1) - sx(x0), sy(y1) - sy(y0));
    ctx.lineWidth = px;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    box(0, 0, W, H);
    if (bleed > 0) {
      ctx.strokeStyle = 'rgba(230,57,70,0.75)';
      ctx.setLineDash([4 * px, 3 * px]);
      box(-bleed, -bleed, W + bleed, H + bleed);
      ctx.setLineDash([]);
    }
    if (margins.top || margins.left || margins.right || margins.bottom) {
      ctx.strokeStyle = 'rgba(255,107,74,0.6)';
      box(margins.left, margins.top, W - margins.right, H - margins.bottom);
    }
    if (columns > 1) {
      const inner = W - margins.left - margins.right;
      const cw = (inner - (columns - 1) * columnGutter) / columns;
      ctx.strokeStyle = 'rgba(255,107,74,0.4)';
      ctx.beginPath();
      for (let i = 1; i < columns; i++) {
        const x = margins.left + i * cw + (i - 1) * columnGutter;
        ctx.moveTo(sx(x), margins.top);
        ctx.lineTo(sx(x), H - margins.bottom);
        ctx.moveTo(sx(x + columnGutter), margins.top);
        ctx.lineTo(sx(x + columnGutter), H - margins.bottom);
      }
      ctx.stroke();
    }
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
