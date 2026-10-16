/**
 * Bridge between the Node tool (canvas) and the chrome (context bar, menus,
 * command palette): the tool publishes what is selected, the chrome runs
 * node actions through `nodeAction`.
 */
import type { NodeKind } from '../../core/pathEdit';

export type NodeAction = 'sharp' | 'smooth' | 'symmetric' | 'break' | 'join' | 'close' | 'reverse' | 'delete' | 'select-all';

export interface NodeEditState {
  /** a path is loaded in the Node tool */
  active: boolean;
  /** selected nodes / all nodes */
  selected: number;
  total: number;
  /** kind shared by the selected nodes, 'mixed', or null with none selected */
  kind: NodeKind | 'mixed' | null;
  /** open subpaths in the path (join / close apply) */
  openSubpaths: number;
}

const EMPTY: NodeEditState = { active: false, selected: 0, total: 0, kind: null, openSubpaths: 0 };
let state: NodeEditState = EMPTY;
let handler: ((a: NodeAction) => void) | null = null;
const listeners = new Set<() => void>();

export function getNodeEdit(): NodeEditState {
  return state;
}

export function publishNodeEdit(next: NodeEditState | null): void {
  const s = next ?? EMPTY;
  if (s.active === state.active && s.selected === state.selected && s.total === state.total && s.kind === state.kind && s.openSubpaths === state.openSubpaths) return;
  state = s;
  for (const l of listeners) l();
}

export function subscribeNodeEdit(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function setNodeActionHandler(h: ((a: NodeAction) => void) | null): void {
  handler = h;
}

/** Run a node action on the Node tool's path. Returns false when no path is being edited. */
export function nodeAction(a: NodeAction): boolean {
  if (!handler) return false;
  handler(a);
  return true;
}
