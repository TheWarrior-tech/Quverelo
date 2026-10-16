/**
 * Symbols (Affinity Designer): a symbol is a group whose content is shared by
 * every instance. Each instance is a normal group carrying `symbolId`, so
 * every renderer, exporter and the layers panel handle it without changes.
 * After any edit, `syncSymbols` copies the content of the instance that
 * changed into every other instance (and into the symbol's definition), so
 * editing one instance updates them all. Instances keep their own transform,
 * opacity and blend.
 */
import { findNode, walk, mapContainers, mapNodes, allContainers } from './document';
import { groupNodes, addNodes, updateNode, type BoundsFn } from './commands';
import { newId } from './ids';
import type { GroupNode, Id, QuvreloDocument, SceneNode, SymbolDef } from './types';

/** Child id inside instance `instanceId` for symbol content key `key`. */
export function instanceChildId(instanceId: Id, key: string): Id {
  return `${instanceId}~${key}`;
}

/** The content key of a child id (the part shared by every instance). */
export function contentKey(id: Id): string {
  const i = id.lastIndexOf('~');
  return i >= 0 ? id.slice(i + 1) : id;
}

/** Copy symbol content for one instance, giving every node (nested too) that instance's ids. */
export function contentFor(instanceId: Id, nodes: SceneNode[]): SceneNode[] {
  const remap = (n: SceneNode): SceneNode => {
    const id = instanceChildId(instanceId, contentKey(n.id));
    if (n.type === 'group') return { ...n, id, children: n.children.map(remap) };
    return { ...n, id } as SceneNode;
  };
  return nodes.map(remap);
}

/** Every symbol instance in the document, by symbol id. */
export function symbolInstances(doc: QuvreloDocument): Map<Id, GroupNode[]> {
  const out = new Map<Id, GroupNode[]>();
  for (const c of allContainers(doc)) {
    walk(c.nodes, (n) => {
      if (n.type === 'group' && n.symbolId) {
        if (!out.has(n.symbolId)) out.set(n.symbolId, []);
        out.get(n.symbolId)!.push(n);
      }
    });
  }
  return out;
}

/** Turn the selection into a symbol (grouped, if needed) and return the instance id. */
export function createSymbol(doc: QuvreloDocument, ids: Id[], name: string, bounds?: BoundsFn): { doc: QuvreloDocument; instanceId: Id | null; symbolId: Id | null } {
  if (!ids.length) return { doc, instanceId: null, symbolId: null };
  let out = doc;
  let gid: Id | null;
  const single = ids.length === 1 ? findNode(doc, ids[0])?.node : null;
  if (single && single.type === 'group' && !single.symbolId && !single.artboard && !single.compound) gid = single.id;
  else {
    const r = groupNodes(doc, ids, bounds);
    out = r.doc;
    gid = r.groupId;
  }
  if (!gid) return { doc, instanceId: null, symbolId: null };
  const symbolId = newId('sym');
  const g = findNode(out, gid)!.node as GroupNode;
  // give the content instance ids now so later copies line up key-for-key
  const children = contentFor(gid, g.children);
  out = updateNode<GroupNode>(out, gid, (x) => ({ ...x, symbolId, name, children }));
  const def: SymbolDef = { id: symbolId, name, nodes: children };
  out = { ...out, symbols: [...(out.symbols ?? []), def] };
  return { doc: out, instanceId: gid, symbolId };
}

/** Place a new instance of a symbol at (x, y) in a container. */
export function insertInstance(doc: QuvreloDocument, symbolId: Id, containerId: Id, x: number, y: number): { doc: QuvreloDocument; instanceId: Id | null } {
  const def = doc.symbols?.find((s) => s.id === symbolId);
  if (!def) return { doc, instanceId: null };
  const id = newId('node');
  const inst: GroupNode = {
    id, name: def.name, visible: true, locked: false, opacity: 1, blend: 'normal',
    x, y, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false,
    type: 'group', symbolId, children: contentFor(id, def.nodes),
  };
  return { doc: addNodes(doc, containerId, [inst]), instanceId: id };
}

/** Detach instances: they become plain groups no longer linked to their symbol. */
export function detachInstances(doc: QuvreloDocument, ids: Id[]): QuvreloDocument {
  const set = new Set(ids);
  return mapContainers(doc, (nodes) => mapNodes(nodes, (n) => (set.has(n.id) && n.type === 'group' && n.symbolId ? { ...n, symbolId: undefined } : n)));
}

export function renameSymbol(doc: QuvreloDocument, symbolId: Id, name: string): QuvreloDocument {
  return { ...doc, symbols: (doc.symbols ?? []).map((s) => (s.id === symbolId ? { ...s, name } : s)) };
}

/** Remove a symbol definition; its instances are detached. */
export function deleteSymbol(doc: QuvreloDocument, symbolId: Id): QuvreloDocument {
  const ids = symbolInstances(doc).get(symbolId)?.map((g) => g.id) ?? [];
  const out = detachInstances(doc, ids);
  return { ...out, symbols: (out.symbols ?? []).filter((s) => s.id !== symbolId) };
}

/**
 * Propagate edits: for each symbol whose instance content changed between
 * `prev` and `next`, copy that content into all other instances and the
 * definition. Returns `next` unchanged (same object) when nothing needs syncing.
 */
export function syncSymbols(prev: QuvreloDocument, next: QuvreloDocument): QuvreloDocument {
  if (!next.symbols?.length || prev === next) return next;
  const before = new Map<Id, SceneNode[]>();
  for (const [, list] of symbolInstances(prev)) for (const g of list) before.set(g.id, g.children);
  const now = symbolInstances(next);
  const sources = new Map<Id, GroupNode>();
  for (const [sid, list] of now) {
    // the edited instance: its children changed (or it is new and the definition is out of date)
    const changed = list.find((g) => before.has(g.id) && before.get(g.id) !== g.children);
    if (changed) sources.set(sid, changed);
  }
  if (!sources.size) return next;
  let out = mapContainers(next, (nodes) => mapNodes(nodes, (n) => {
    if (n.type !== 'group' || !n.symbolId) return n;
    const src = sources.get(n.symbolId);
    if (!src || src.id === n.id) return n;
    return { ...n, children: contentFor(n.id, src.children) };
  }));
  out = {
    ...out,
    symbols: (out.symbols ?? []).map((s) => (sources.has(s.id) ? { ...s, nodes: sources.get(s.id)!.children } : s)),
  };
  return out;
}
