/**
 * Boolean path operations (add / subtract / intersect / exclude / divide),
 * powered by paper.js running headless.
 */
import { getPaper } from './paperScope';
import { parsePath, pathToString } from './path';
import type { PathCommand } from './types';

export type BooleanOp = 'add' | 'subtract' | 'intersect' | 'exclude' | 'divide';

const getScope = getPaper;
type Scope = ReturnType<typeof getPaper>;

function toItem(s: Scope, d: PathCommand[]): paper.PathItem {
  return new s.CompoundPath({ pathData: pathToString(d), insert: false, fillRule: 'evenodd' });
}

function toCommands(item: paper.Item | null): PathCommand[] {
  if (!item) return [];
  const data = (item as paper.PathItem).pathData;
  return data ? parsePath(data) : [];
}

/**
 * Combine world-space paths. The first path is the base (bottom-most) for
 * subtract; the rest are cut from it. Returns one or more result paths.
 */
export function booleanPaths(paths: PathCommand[][], op: BooleanOp): PathCommand[][] {
  if (paths.length < 2) return paths;
  const s = getScope();
  const items = paths.map((d) => toItem(s, d));
  if (op === 'divide') {
    // split everything by everything: collect pieces
    let pieces: paper.PathItem[] = [items[0]];
    for (let i = 1; i < items.length; i++) {
      const next: paper.PathItem[] = [];
      const cutter = items[i];
      let rest: paper.PathItem = cutter;
      for (const p of pieces) {
        const inter = p.intersect(cutter, { insert: false });
        const outside = p.subtract(cutter, { insert: false });
        rest = rest.subtract(p, { insert: false });
        if (!inter.isEmpty()) next.push(inter);
        if (!outside.isEmpty()) next.push(outside);
      }
      if (!rest.isEmpty()) next.push(rest);
      pieces = next;
    }
    return pieces.map((p) => toCommands(p)).filter((d) => d.length);
  }
  let acc: paper.PathItem = items[0];
  for (let i = 1; i < items.length; i++) {
    const b = items[i];
    switch (op) {
      case 'add': acc = acc.unite(b, { insert: false }); break;
      case 'subtract': acc = acc.subtract(b, { insert: false }); break;
      case 'intersect': acc = acc.intersect(b, { insert: false }); break;
      case 'exclude': acc = acc.exclude(b, { insert: false }); break;
    }
  }
  const d = toCommands(acc);
  return d.length ? [d] : [];
}
