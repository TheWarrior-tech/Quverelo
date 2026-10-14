/**
 * Editor state: the open document (via history), assets, and UI state such as
 * the active studio, tool, selection and tool options. React subscribes with
 * useSyncExternalStore; the canvas viewport subscribes directly.
 */
import { DocumentHistory } from '../../core/history';
import { findNode, getContainer, referencedAssets } from '../../core/document';
import type { QuvreloDocument, Id, PathCommand, SceneNode, StudioKind } from '../../core/types';
import { DEFAULT_POLICY, featureEnabled, type FeatureId, type Policy } from '../../core/policy';
import { DEFAULT_SETTINGS, type UserSettings } from '../../shared/api';
import { AssetStore } from '../engine/assets';

export type ToolId =
  | 'move' | 'node' | 'hand' | 'zoom'
  | 'marquee-rect' | 'marquee-ellipse' | 'lasso' | 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'crop'
  | 'pen' | 'pencil' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line'
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
}

export interface UiState {
  studio: StudioKind;
  tool: ToolId;
  activeContainerId: Id | null;
  selection: Id[];
  pixelSelection: PathCommand[] | null;
  fillColor: string;
  strokeColor: string;
  strokeEnabled: boolean;
  fillEnabled: boolean;
  zoom: number;
  editingTextId: Id | null;
  toolOptions: ToolOptions;
  /** live-preview flag (adjustment slider drags) */
  interacting: boolean;
  status: string;
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
};

export const STUDIO_TOOLS: Record<StudioKind, ToolId[]> = {
  photo: ['move', 'marquee-rect', 'marquee-ellipse', 'lasso', 'crop', 'brush', 'eraser', 'fill', 'eyedropper', 'text', 'hand', 'zoom'],
  vector: ['move', 'node', 'pen', 'pencil', 'rect', 'ellipse', 'polygon', 'star', 'line', 'text', 'eyedropper', 'hand', 'zoom'],
  layout: ['move', 'node', 'textframe', 'imageframe', 'text', 'rect', 'ellipse', 'line', 'eyedropper', 'hand', 'zoom'],
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
    pixelSelection: null,
    fillColor: '#8f959e',
    strokeColor: '#1b1b1f',
    strokeEnabled: false,
    fillEnabled: true,
    zoom: 1,
    editingTextId: null,
    toolOptions: { ...DEFAULT_TOOL_OPTIONS },
    interacting: false,
    status: '',
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
      pixelSelection: null,
      editingTextId: null,
    };
    this.emitNow();
  }

  closeSession(): void {
    this.unsubHistory?.();
    this.unsubHistory = null;
    this.session = null;
    this.assets.clear();
    this.ui = { ...this.ui, selection: [], pixelSelection: null, editingTextId: null, activeContainerId: null };
    this.emitNow();
  }

  /** Apply a document change as an undoable step. */
  commit(label: string, fn: (doc: QuvreloDocument) => QuvreloDocument, mergeKey?: string): boolean {
    const h = this.history;
    if (!h) return false;
    const next = fn(h.doc);
    return h.push(label, next, mergeKey);
  }

  /** Replace the document without an undo step (live previews). */
  preview(fn: (doc: QuvreloDocument) => QuvreloDocument): void {
    const h = this.history;
    if (!h) return;
    h.replace(fn(h.doc));
  }

  setUi(patch: Partial<UiState>): void {
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
    this.ui = { ...this.ui, selection: ids };
    this.emit();
  }

  setStudio(studio: StudioKind): void {
    if (!this.feature(studio)) return;
    const tools = STUDIO_TOOLS[studio];
    const tool = tools.includes(this.ui.tool) ? this.ui.tool : 'move';
    this.ui = { ...this.ui, studio, tool };
    this.emit();
  }

  setTool(tool: ToolId): void {
    this.ui = { ...this.ui, tool, editingTextId: tool === this.ui.tool ? this.ui.editingTextId : null };
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
    let { activeContainerId, selection, editingTextId } = this.ui;
    if (!activeContainerId || !getContainer(d, activeContainerId)) activeContainerId = d.pages[0].id;
    selection = selection.filter((id) => !!findNode(d, id));
    if (editingTextId && !findNode(d, editingTextId)) editingTextId = null;
    this.ui = { ...this.ui, activeContainerId, selection, editingTextId };
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

export const editor = new Editor();
