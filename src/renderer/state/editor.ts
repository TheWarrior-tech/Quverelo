/**
 * Editor state: the open document (via history), assets, and UI state such as
 * the active studio, tool, selection and tool options. React subscribes with
 * useSyncExternalStore; the canvas viewport subscribes directly.
 */
import { syncSymbols } from '../../core/symbols';
import { DocumentHistory } from '../../core/history';
import { findNode, getContainer, referencedAssets } from '../../core/document';
import type { QuvreloDocument, Id, Paint, PathCommand, SceneNode, StudioKind, Unit } from '../../core/types';
import { DEFAULT_POLICY, featureEnabled, type FeatureId, type Policy } from '../../core/policy';
import { DEFAULT_SETTINGS, type UserSettings } from '../../shared/api';
import { AssetStore } from '../engine/assets';
import { remember, studioTools, type RailMemory } from './toolGroups';
import type { CropOverlay, CropRatioId, CropRect } from '../../core/crop';

export type ToolId =
  | 'move' | 'node' | 'hand' | 'zoom'
  | 'marquee-rect' | 'marquee-ellipse' | 'lasso' | 'object-select' | 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'crop'
  | 'pen' | 'pencil' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line'
  | 'rrect' | 'arrow' | 'gradient' | 'artboard'
  | 'text' | 'textframe' | 'imageframe';

export interface ToolOptions {
  brushSize: number;
  brushHardness: number; // 0..1
  brushOpacity: number; // 0..1
  eraserSize: number;
  polygonSides: number;
  starPoints: number;
  starInner: number;
  cornerRadius: number;
  selectionMode: 'new' | 'add' | 'subtract' | 'intersect';
  fillTolerance: number;
  fontFamily: string;
  fontSize: number;
  strokeWidth: number;
  /** crop tool: aspect-ratio preset, orientation and guide overlay */
  cropRatio: CropRatioId;
  cropPortrait: boolean;
  cropOverlay: CropOverlay;
  /** gradient tool: which paint it edits and the type a new gradient gets */
  gradientTarget: 'fill' | 'stroke';
  gradientType: 'linear' | 'radial' | 'conical';
  /** rounded rectangle tool radius */
  roundRadius: number;
  /** Arrange › Space: gap between objects (px) */
  spaceGap: number;
  /** what Align lines objects up with */
  alignTo: 'auto' | 'selection' | 'first' | 'last' | 'page';
}

export interface UiState {
  studio: StudioKind;
  tool: ToolId;
  activeContainerId: Id | null;
  selection: Id[];
  /**
   * The active layer (CRITIQUE-4 R2). Separate from the object selection:
   * selecting a layer sets both, but clearing the selection (Esc, Deselect,
   * Crop, Object Select, a click on empty pasteboard) keeps it. Photo always
   * has one while the page holds a pixel layer; the Adjust panel, brush,
   * eraser, fill, Object Select and Copy to layer act on it.
   */
  activeLayerId: Id | null;
  pixelSelection: PathCommand[] | null;
  /** live crop box while the Crop tool is active (null = whole canvas) */
  crop: CropRect | null;
  /** an on-device selection model run is in progress */
  mlBusy: boolean;
  fillColor: string;
  strokeColor: string;
  strokeEnabled: boolean;
  fillEnabled: boolean;
  /** gradient paint for new objects when the default fill/stroke is linear or radial (null = solid) */
  fillGradient: Paint | null;
  strokeGradient: Paint | null;
  zoom: number;
  editingTextId: Id | null;
  toolOptions: ToolOptions;
  /** live-preview flag (adjustment slider drags) */
  interacting: boolean;
  status: string;
  /** last-used tool per tool-rail flyout group (shown on the rail) */
  railTools: RailMemory;
}

export interface DocSession {
  history: DocumentHistory;
  filePath: string | null;
  recoveryId: string;
}

type Listener = () => void;

const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  brushSize: 24,
  brushHardness: 0.8,
  brushOpacity: 1,
  eraserSize: 32,
  polygonSides: 6,
  starPoints: 5,
  starInner: 0.45,
  cornerRadius: 0,
  selectionMode: 'new',
  fillTolerance: 32,
  fontFamily: 'Inter',
  fontSize: 48,
  strokeWidth: 2,
  // the photo's own proportions, so a 3:2 photo crops at 3:2 (critique 3 P2-2)
  cropRatio: 'original',
  cropPortrait: false,
  cropOverlay: 'thirds',
  gradientTarget: 'fill',
  gradientType: 'linear',
  roundRadius: 16,
  spaceGap: 20,
  alignTo: 'auto',
};

/** Every tool per studio in rail order; the rail layout and flyout groups live in toolGroups.ts. */
export const STUDIO_TOOLS: Record<StudioKind, ToolId[]> = {
  photo: studioTools('photo'),
  vector: studioTools('vector'),
  layout: studioTools('layout'),
};

export class Editor {
  session: DocSession | null = null;
  assets = new AssetStore();
  policy: Policy = DEFAULT_POLICY;
  settings: UserSettings = DEFAULT_SETTINGS;
  ui: UiState = {
    studio: 'vector',
    tool: 'move',
    activeContainerId: null,
    selection: [],
    activeLayerId: null,
    pixelSelection: null,
    crop: null,
    mlBusy: false,
    fillColor: '#8f959e',
    strokeColor: '#1b1b1f',
    strokeEnabled: false,
    fillEnabled: true,
    fillGradient: null,
    strokeGradient: null,
    zoom: 1,
    editingTextId: null,
    toolOptions: { ...DEFAULT_TOOL_OPTIONS },
    interacting: false,
    status: '',
    railTools: {},
  };
  /** clipboard (in-app) */
  clipboard: { nodes: SceneNode[]; stories: QuvreloDocument['stories'] } | null = null;
  private listeners = new Set<Listener>();
  private unsubHistory: (() => void) | null = null;
  private versionNo = 0;
  private emitQueued = false;

  get version(): number {
    return this.versionNo;
  }

  get doc(): QuvreloDocument | null {
    return this.session?.history.doc ?? null;
  }

  get history(): DocumentHistory | null {
    return this.session?.history ?? null;
  }

  /**
   * The unit every length readout uses: the document's own unit (mm for a Print
   * preset, px for screen and photos). Set at creation and in Document setup or
   * the status-bar Units select; never a global preference (CRITIQUE-3 N1).
   */
  get unit(): Unit {
    return this.doc?.settings.unit ?? 'px';
  }

  feature(f: FeatureId): boolean {
    return featureEnabled(this.policy, f);
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.versionNo;

  emit(): void {
    this.versionNo++;
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      for (const l of this.listeners) l();
    });
  }

  /** Synchronous emit for the canvas (keeps drawing in step with edits). */
  emitNow(): void {
    this.versionNo++;
    for (const l of this.listeners) l();
  }

  openSession(doc: QuvreloDocument, filePath: string | null, studio?: StudioKind): void {
    this.unsubHistory?.();
    const history = new DocumentHistory(doc, { limit: this.policy.maxUndoSteps });
    this.session = { history, filePath, recoveryId: doc.id };
    this.unsubHistory = history.subscribe(() => {
      this.validateUi();
      this.emitNow();
    });
    let st = studio ?? doc.studio ?? 'vector';
    if (!this.feature(st)) st = (['vector', 'layout', 'photo'] as StudioKind[]).find((s) => this.feature(s)) ?? 'vector';
    this.ui = {
      ...this.ui,
      studio: st,
      tool: 'move',
      activeContainerId: doc.pages[0].id,
      selection: [],
      activeLayerId: null,
      pixelSelection: null,
      crop: null,
      editingTextId: null,
    };
    this.ensureActiveLayer(false);
    this.emitNow();
  }

  closeSession(): void {
    this.unsubHistory?.();
    this.unsubHistory = null;
    this.session = null;
    this.assets.clear();
    this.ui = { ...this.ui, selection: [], activeLayerId: null, pixelSelection: null, crop: null, editingTextId: null, activeContainerId: null };
    this.emitNow();
  }

  /** Apply a document change as an undoable step. */
  commit(label: string, fn: (doc: QuvreloDocument) => QuvreloDocument, mergeKey?: string): boolean {
    const h = this.history;
    if (!h) return false;
    // symbols: an edit inside one instance updates every instance (core/symbols)
    const next = syncSymbols(h.doc, fn(h.doc));
    return h.push(label, next, mergeKey);
  }

  /** Replace the document without an undo step (live previews). */
  preview(fn: (doc: QuvreloDocument) => QuvreloDocument): void {
    const h = this.history;
    if (!h) return;
    h.replace(syncSymbols(h.doc, fn(h.doc)));
  }

  setUi(patch: Partial<UiState>): void {
    // a flat colour picked anywhere (swatch, eyedropper, brush chip) replaces a default gradient
    if ('fillColor' in patch && !('fillGradient' in patch)) patch = { ...patch, fillGradient: null };
    if ('strokeColor' in patch && !('strokeGradient' in patch)) patch = { ...patch, strokeGradient: null };
    this.ui = { ...this.ui, ...patch };
    this.emit();
  }

  setToolOptions(patch: Partial<ToolOptions>): void {
    this.ui = { ...this.ui, toolOptions: { ...this.ui.toolOptions, ...patch } };
    this.emit();
  }

  select(ids: Id[]): void {
    const same = ids.length === this.ui.selection.length && ids.every((id, i) => id === this.ui.selection[i]);
    if (same) return;
    // selecting a layer makes it the active layer too; an empty selection keeps it
    const activeLayerId = ids.length ? ids[ids.length - 1] : this.ui.activeLayerId;
    this.ui = { ...this.ui, selection: ids, activeLayerId };
    this.emit();
  }

  setStudio(studio: StudioKind): void {
    if (!this.feature(studio)) return;
    if (studio === this.ui.studio) return;
    // entering a studio always starts on Move, so its context bar shows the
    // studio's own controls (page setup in Layout) rather than a stale tool
    this.ui = { ...this.ui, studio, tool: 'move', crop: null, editingTextId: null };
    this.ensureActiveLayer(false);
    this.emit();
  }

  /**
   * Photo always has an active pixel layer, as in Photoshop and Affinity
   * (CRITIQUE-3 N4, CRITIQUE-4 R2): when no valid layer is active, the
   * top-most pixel layer of the active page becomes the active layer. This
   * never touches the object selection. Called on open, on entering Photo,
   * after a crop, a delete and an undo. Returns true when it changed the layer.
   */
  ensureActiveLayer(emit = true): boolean {
    if (this.ui.studio !== 'photo') return false;
    const c = this.activeContainer;
    if (!c) return false;
    const cur = this.ui.activeLayerId;
    if (cur && findNodeIn(c.nodes, cur)) return false;
    const top = topPixelLayer(c.nodes);
    if (!top) return false;
    this.ui = { ...this.ui, activeLayerId: top.id };
    if (emit) this.emit();
    return true;
  }

  /** The active layer node (null when none, or it left the active page). */
  activeLayer(): SceneNode | null {
    const id = this.ui.activeLayerId;
    const c = this.activeContainer;
    return id && c ? findNodeIn(c.nodes, id) : null;
  }

  /** The layers an action targets: the selection, else the active layer. */
  targetIds(): Id[] {
    if (this.ui.selection.length) return this.ui.selection;
    return this.activeLayer() ? [this.ui.activeLayerId!] : [];
  }

  setTool(tool: ToolId): void {
    // leaving the Crop tool discards an unapplied crop box
    this.ui = {
      ...this.ui,
      tool,
      crop: tool === this.ui.tool ? this.ui.crop : null,
      editingTextId: tool === this.ui.tool ? this.ui.editingTextId : null,
      railTools: remember(this.ui.railTools, this.ui.studio, tool),
    };
    this.emit();
  }

  get activeContainer() {
    const d = this.doc;
    if (!d) return null;
    return (this.ui.activeContainerId && getContainer(d, this.ui.activeContainerId)) || d.pages[0];
  }

  /** The page shown in the viewport (or null when a master is being edited). */
  get activePageIndex(): number {
    const d = this.doc;
    if (!d) return 0;
    const i = d.pages.findIndex((p) => p.id === this.ui.activeContainerId);
    return i < 0 ? -1 : i;
  }

  get editingMaster(): boolean {
    const d = this.doc;
    return !!d && d.masters.some((m) => m.id === this.ui.activeContainerId);
  }

  selectedNodes(): SceneNode[] {
    const d = this.doc;
    if (!d) return [];
    return this.ui.selection.map((id) => findNode(d, id)?.node).filter((n): n is SceneNode => !!n);
  }

  /** Drop ids that no longer exist after undo/redo; fix the active container. */
  private validateUi(): void {
    const d = this.doc;
    if (!d) return;
    let { activeContainerId, selection, editingTextId, activeLayerId } = this.ui;
    if (!activeContainerId || !getContainer(d, activeContainerId)) activeContainerId = d.pages[0].id;
    selection = selection.filter((id) => !!findNode(d, id));
    if (editingTextId && !findNode(d, editingTextId)) editingTextId = null;
    if (activeLayerId && !findNode(d, activeLayerId)) activeLayerId = null;
    this.ui = { ...this.ui, activeContainerId, selection, editingTextId, activeLayerId };
    // the active layer was deleted (or undone away): activate the top pixel layer
    this.ensureActiveLayer(false);
  }

  /** Free pixel buffers that no history entry references any more. */
  collectGarbage(): void {
    const h = this.history;
    if (!h) return;
    const keep = new Set<Id>();
    for (const e of h.list) for (const id of referencedAssets(e.doc)) keep.add(id);
    if (this.clipboard) {
      const visit = (nodes: SceneNode[]) => nodes.forEach((n) => {
        if (n.type === 'raster') keep.add(n.assetId);
        if (n.type === 'imageframe' && n.assetId) keep.add(n.assetId);
        if (n.type === 'group') visit(n.children);
      });
      visit(this.clipboard.nodes);
    }
    this.assets.gc(keep);
  }
}

/** A node anywhere in a stack (groups searched). */
export function findNodeIn(nodes: SceneNode[], id: Id): SceneNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.type === 'group') {
      const hit = findNodeIn(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Top-most pixel layer in a stack (nodes are bottom-to-top; groups are searched too). Visible layers win. */
export function topPixelLayer(nodes: SceneNode[]): SceneNode | null {
  let fallback: SceneNode | null = null;
  const walk = (list: SceneNode[]): SceneNode | null => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.type === 'group') {
        const hit = walk(n.children);
        if (hit) return hit;
      } else if (n.type === 'raster') {
        if (n.visible) return n;
        fallback ??= n;
      }
    }
    return null;
  };
  return walk(nodes) ?? fallback;
}

/** True when a page holds any pixel layer (the Adjust empty state depends on it). */
export function hasPixelLayers(c: { nodes: SceneNode[] } | null): boolean {
  return !!c && topPixelLayer(c.nodes) !== null;
}

export const editor = new Editor();
