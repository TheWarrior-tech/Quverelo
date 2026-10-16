/**
 * Non-destructive compound shapes (Affinity's Alt+boolean): a group whose
 * children's outlines are combined live with add / subtract / intersect /
 * exclude / divide. The result is cached per children array, so editing a
 * child (a new array) recomputes it and nothing else does. Divide keeps every
 * piece as its own closed subpath: the pieces tile the union, so the fill is
 * unchanged and the stroke draws the live cut lines; compoundPieces gives the
 * pieces one by one for Expand.
 */
import { booleanPaths } from './boolean';
import { composeTransform } from './geometry';
import { transformPath } from './path';
import type { CompoundOp, GroupNode, PathCommand, SceneNode } from './types';

const cache = new WeakMap<SceneNode[], Map<CompoundOp, PathCommand[][]>>();

/** Combine child outlines (already in the group's space) with `op`. */
export function combineOutlines(paths: PathCommand[][], op: CompoundOp): PathCommand[] {
  return combinePieces(paths, op).flat();
}

/** As combineOutlines, one entry per result piece (several only for divide). */
export function combinePieces(paths: PathCommand[][], op: CompoundOp): PathCommand[][] {
  const list = paths.filter((d) => d.length);
  if (!list.length) return [];
  if (list.length === 1) return [list[0]];
  return booleanPaths(list, op);
}

/**
 * The compound's outline in its own (group-local) space. `toPath` gives a
 * child's local outline (core/document nodeToPath, injected to avoid a cycle).
 */
export function compoundPath(g: GroupNode, toPath: (n: SceneNode) => PathCommand[] | null): PathCommand[] {
  return compoundPieces(g, toPath).flat();
}

/** The compound's result pieces in group-local space (one piece except for divide). */
export function compoundPieces(g: GroupNode, toPath: (n: SceneNode) => PathCommand[] | null): PathCommand[][] {
  const op = g.compound?.op ?? 'add';
  let byOp = cache.get(g.children);
  const hit = byOp?.get(op);
  if (hit) return hit;
  const paths = g.children
    .filter((c) => c.visible)
    .map((c) => {
      const d = toPath(c);
      return d ? transformPath(d, composeTransform(c)) : [];
    });
  const pieces = combinePieces(paths, op);
  if (!byOp) {
    byOp = new Map();
    cache.set(g.children, byOp);
  }
  byOp.set(op, pieces);
  return pieces;
}
