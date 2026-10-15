/**
 * Object Select session: the clicks made on one photo layer and the model's
 * last result, so each click refines the previous mask (QuvSelect click
 * prompts). The session ends when the selection is changed by anything else
 * (another tool, Deselect, Invert, undoing the layer) or another layer is clicked.
 */
import { apply, type Point } from '../../core/geometry';
import { findNode } from '../../core/document';
import type { PathCommand, RasterNode, SceneNode } from '../../core/types';
import type { SelectionClick, SelectionResult } from '../../core/ml/selectSubject';
import type { Editor } from '../state/editor';
import { toast } from '../state/bus';
import { activeRaster, worldToPixelMatrix } from './pixelOps';
import { rasterView, resultToWorldPath, runSelectObject } from './mlSelect';

interface Session {
  nodeId: string;
  node: RasterNode;
  view: NonNullable<ReturnType<typeof rasterView>>;
  clicks: SelectionClick[];
  /** world-space click positions, for the on-canvas markers */
  points: (Point & { positive: boolean })[];
  previous: SelectionResult | null;
  /** the selection this session produced (identity) */
  path: PathCommand[] | null;
}

let session: Session | null = null;

export function resetObjectSelect(): void {
  session = null;
}

/** True when the editor's pixel selection is still the one this session made. */
function live(ed: Editor): Session | null {
  if (!session) return null;
  const n = ed.doc ? findNode(ed.doc, session.nodeId)?.node : null;
  if (!n || n !== session.node || ed.ui.pixelSelection !== session.path) {
    session = null;
    return null;
  }
  return session;
}

export function objectSelectMarkers(ed: Editor): (Point & { positive: boolean })[] {
  return live(ed)?.points ?? [];
}

/** Is world point p over the raster node (in its own, possibly rotated, frame)? */
function containsPoint(ed: Editor, n: RasterNode, p: Point): boolean {
  const m = ed.doc ? worldToPixelMatrix(ed.doc, n.id) : null;
  if (!m) return false;
  const q = apply(m, p);
  return q.x >= 0 && q.y >= 0 && q.x < n.w && q.y < n.h;
}

/** The photo layer a click targets: the selected pixel layer, else the topmost visible one under the pointer. */
export function targetRaster(ed: Editor, p: Point): RasterNode | null {
  const sel = activeRaster(ed);
  if (sel) return sel;
  const c = ed.activeContainer;
  if (!c) return null;
  const rasters = [...c.nodes].reverse().filter((n: SceneNode): n is RasterNode => n.type === 'raster' && n.visible !== false);
  return rasters.find((n) => containsPoint(ed, n, p)) ?? rasters[0] ?? null;
}

let busy = false;

export interface ClickHooks {
  onStart?: () => void;
  onEnd?: () => void;
  redraw?: () => void;
}

/** One Object Select click at world point p. positive = include, false = exclude (Alt). */
export async function objectSelectClick(ed: Editor, p: Point, positive: boolean, hooks: ClickHooks = {}): Promise<boolean> {
  if (busy) return false;
  let s = live(ed);
  const r = s ? s.node : targetRaster(ed, p);
  if (!r) {
    toast('Add or select a photo layer first');
    return false;
  }
  if (s && s.nodeId !== r.id) s = null;
  if (!s) {
    if (!positive) {
      toast('Click an object first, then Alt-click to remove parts');
      return false;
    }
    const view = rasterView(ed, r);
    if (!view) return false;
    s = { nodeId: r.id, node: r, view, clicks: [], points: [], previous: null, path: null };
  }
  const q = apply(s.view.toPixel, p);
  if (q.x < 0 || q.y < 0 || q.x >= s.view.width || q.y >= s.view.height) return false;
  const clicks = [...s.clicks, { x: q.x, y: q.y, positive }];
  busy = true;
  ed.setUi({ mlBusy: true, status: 'Selecting object…' });
  hooks.onStart?.();
  try {
    const res = await runSelectObject(s.view, clicks, s.previous);
    const path = resultToWorldPath(s.view, res);
    if (!path) {
      ed.setUi({ status: '' });
      toast(positive ? 'No object found there' : 'That would remove the whole selection');
      return false;
    }
    s.clicks = clicks;
    s.points = [...s.points, { x: p.x, y: p.y, positive }];
    s.previous = res;
    s.path = path;
    session = s;
    ed.setUi({ pixelSelection: path, status: `Object selected (${res.source === 'ml' ? 'on-device model' : 'basic fallback'}, ${Math.round(res.ms)} ms)` });
    return true;
  } finally {
    busy = false;
    ed.setUi({ mlBusy: false });
    hooks.onEnd?.();
    hooks.redraw?.();
  }
}
