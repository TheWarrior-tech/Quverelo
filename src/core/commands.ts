/**
 * Pure document operations. Every function takes a document and returns a new
 * one (or the same instance when nothing changed). The UI wraps these in
 * history entries; tests exercise them directly.
 */
import { newId } from './ids';
import {
  apply, decompose, invert, multiply, unionRects, type Matrix, type Rect,
} from './geometry';
import {
  cloneNode, createMaster, createPage, createStory, findNode, getContainer, make, mapContainers,
  mapNodes, nodeBounds, nodeMatrix, nodeToPath, setContainerNodes, walk, worldMatrix,
} from './document';
import { centrePath, transformPath } from './path';
import type {
  QuvreloDocument, GroupNode, Guide, Id, Page, PathNode, SceneNode, Story, TextStyle, Swatch, NodeBase,
} from './types';

export type BoundsFn = (n: SceneNode) => Rect;

// ---------------------------------------------------------------------------
// Nodes

export function addNodes(doc: QuvreloDocument, containerId: Id, nodes: SceneNode[], index?: number): QuvreloDocument {
  const c = getContainer(doc, containerId);
  if (!c) return doc;
  const list = [...c.nodes];
  list.splice(index ?? list.length, 0, ...nodes);
  return setContainerNodes(doc, containerId, list);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoosePatch = { [key: string]: any };

export function updateNode<T extends SceneNode = SceneNode>(
  doc: QuvreloDocument, id: Id, patch: Partial<T> | LoosePatch | ((n: T) => T),
): QuvreloDocument {
  return mapContainers(doc, (nodes) =>
    mapNodes(nodes, (n) => {
      if (n.id !== id) return n;
      return typeof patch === 'function' ? (patch as (n: T) => T)(n as T) : ({ ...n, ...patch } as SceneNode);
    }),
  );
}

export function updateNodes(doc: QuvreloDocument, ids: Id[], fn: (n: SceneNode) => SceneNode): QuvreloDocument {
  const set = new Set(ids);
  return mapContainers(doc, (nodes) => mapNodes(nodes, (n) => (set.has(n.id) ? fn(n) : n)));
}

export function removeNodes(doc: QuvreloDocument, ids: Id[]): QuvreloDocument {
  const set = new Set(ids);
  const removedFrames = new Set<Id>();
  for (const id of ids) {
    const loc = findNode(doc, id);
    if (loc) walk([loc.node], (n) => n.type === 'textframe' && removedFrames.add(n.id));
  }
  let out = mapContainers(doc, (nodes) => mapNodes(nodes, (n) => (set.has(n.id) ? null : n)));
  if (removedFrames.size) {
    const stories: Record<Id, Story> = {};
    for (const [sid, s] of Object.entries(out.stories)) {
      const chain = s.chain.filter((f) => !removedFrames.has(f));
      if (chain.length) stories[sid] = chain.length === s.chain.length ? s : { ...s, chain };
    }
    out = { ...out, stories };
  }
  return out;
}

/** Siblings list containing the node and a setter for it. */
function withSiblings(doc: QuvreloDocument, id: Id, fn: (siblings: SceneNode[], index: number) => SceneNode[]): QuvreloDocument {
  const loc = findNode(doc, id);
  if (!loc) return doc;
  if (!loc.ancestors.length) {
    const c = getContainer(doc, loc.container.id)!;
    return setContainerNodes(doc, c.id, fn(c.nodes, loc.index));
  }
  const parent = loc.ancestors[loc.ancestors.length - 1];
  return updateNode<GroupNode>(doc, parent.id, (g) => ({ ...g, children: fn(g.children, loc.index) }));
}

export type ArrangeOp = 'forward' | 'backward' | 'front' | 'back';

export function arrange(doc: QuvreloDocument, ids: Id[], op: ArrangeOp): QuvreloDocument {
  let out = doc;
  const ordered = op === 'forward' || op === 'back' ? [...ids].reverse() : ids;
  for (const id of ordered) {
    out = withSiblings(out, id, (sib, i) => {
      const list = [...sib];
      const [n] = list.splice(i, 1);
      let j = i;
      if (op === 'forward') j = Math.min(list.length, i + 1);
      if (op === 'backward') j = Math.max(0, i - 1);
      if (op === 'front') j = list.length;
      if (op === 'back') j = 0;
      list.splice(j, 0, n);
      return list;
    });
  }
  return out;
}

/** Move a node to a specific index in a container (used by layer drag-and-drop). */
export function moveNodeTo(doc: QuvreloDocument, id: Id, containerId: Id, index: number): QuvreloDocument {
  const loc = findNode(doc, id);
  if (!loc) return doc;
  const node = loc.node;
  let out = removeNodesKeepStories(doc, [id]);
  const c = getContainer(out, containerId);
  if (!c) return doc;
  const list = [...c.nodes];
  list.splice(Math.max(0, Math.min(index, list.length)), 0, node);
  out = setContainerNodes(out, containerId, list);
  return out;
}

function removeNodesKeepStories(doc: QuvreloDocument, ids: Id[]): QuvreloDocument {
  const set = new Set(ids);
  return mapContainers(doc, (nodes) => mapNodes(nodes, (n) => (set.has(n.id) ? null : n)));
}

export function duplicateNodes(doc: QuvreloDocument, ids: Id[], offset = 20): { doc: QuvreloDocument; ids: Id[] } {
  let out = doc;
  const newIds: Id[] = [];
  for (const id of ids) {
    const loc = findNode(out, id);
    if (!loc) continue;
    const copy = cloneNode(loc.node);
    copy.x += offset;
    copy.y += offset;
    copy.name = loc.node.name;
    // duplicated text frames get their own story copy so they don't steal the chain
    out = detachClonedFrames(out, copy);
    newIds.push(copy.id);
    out = withSiblings(out, id, (sib, i) => {
      const list = [...sib];
      list.splice(i + 1, 0, copy);
      return list;
    });
  }
  return { doc: out, ids: newIds };
}

function detachClonedFrames(doc: QuvreloDocument, node: SceneNode): QuvreloDocument {
  let out = doc;
  walk([node], (n) => {
    if (n.type === 'textframe') {
      const src = out.stories[n.storyId];
      const story = createStory(src ? src.text : '', src ? src.style : {});
      story.chain = [n.id];
      (n as { storyId: Id }).storyId = story.id;
      out = { ...out, stories: { ...out.stories, [story.id]: story } };
    }
  });
  return out;
}

export function groupNodes(doc: QuvreloDocument, ids: Id[], bounds: BoundsFn = nodeBounds): { doc: QuvreloDocument; groupId: Id | null } {
  if (ids.length < 1) return { doc, groupId: null };
  const locs = ids.map((id) => findNode(doc, id)).filter((l): l is NonNullable<typeof l> => !!l);
  if (!locs.length) return { doc, groupId: null };
  const first = locs[0];
  const parentId = first.ancestors.length ? first.ancestors[first.ancestors.length - 1].id : null;
  const same = locs.filter((l) => {
    const p = l.ancestors.length ? l.ancestors[l.ancestors.length - 1].id : null;
    return p === parentId && l.container.id === first.container.id;
  });
  same.sort((a, b) => a.index - b.index);
  const r = unionRects(same.map((l) => bounds(l.node)));
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const children = same.map((l) => ({ ...l.node, x: l.node.x - cx, y: l.node.y - cy }));
  const group = make.group(children, { x: cx, y: cy, name: 'Group' });
  const topIndex = same[same.length - 1].index;
  const idSet = new Set(same.map((l) => l.node.id));
  const insert = (sib: SceneNode[]): SceneNode[] => {
    const list: SceneNode[] = [];
    sib.forEach((n, i) => {
      if (i === topIndex) list.push(group);
      if (!idSet.has(n.id)) list.push(n);
    });
    return list;
  };
  let out: QuvreloDocument;
  if (parentId) out = updateNode<GroupNode>(doc, parentId, (g) => ({ ...g, children: insert(g.children) }));
  else {
    const c = getContainer(doc, first.container.id)!;
    out = setContainerNodes(doc, c.id, insert(c.nodes));
  }
  return { doc: out, groupId: group.id };
}

/** Express a child's transform in its grandparent's space. */
export function bakeTransform<T extends SceneNode>(child: T, parent: Matrix): T {
  const m = multiply(parent, nodeMatrix(child));
  const t = decompose(m);
  return { ...child, ...t, flipX: false } as T;
}

export function ungroup(doc: QuvreloDocument, groupId: Id): { doc: QuvreloDocument; ids: Id[] } {
  const loc = findNode(doc, groupId);
  if (!loc || loc.node.type !== 'group') return { doc, ids: [] };
  const g = loc.node;
  const gm = nodeMatrix(g);
  const kids = g.children.map((c) => {
    const baked = bakeTransform(c, gm);
    return { ...baked, opacity: c.opacity * g.opacity };
  });
  const out = withSiblings(doc, groupId, (sib, i) => {
    const list = [...sib];
    list.splice(i, 1, ...kids);
    return list;
  });
  return { doc: out, ids: kids.map((k) => k.id) };
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignNodes(
  doc: QuvreloDocument, ids: Id[], mode: AlignMode, target: Rect | null, bounds: BoundsFn = nodeBounds,
): QuvreloDocument {
  const locs = ids.map((id) => findNode(doc, id)).filter((l): l is NonNullable<typeof l> => !!l);
  if (!locs.length) return doc;
  const ref = target ?? unionRects(locs.map((l) => bounds(l.node)));
  return updateNodes(doc, ids, (n) => {
    const b = bounds(n);
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left': dx = ref.x - b.x; break;
      case 'right': dx = ref.x + ref.w - (b.x + b.w); break;
      case 'hcenter': dx = ref.x + ref.w / 2 - (b.x + b.w / 2); break;
      case 'top': dy = ref.y - b.y; break;
      case 'bottom': dy = ref.y + ref.h - (b.y + b.h); break;
      case 'vcenter': dy = ref.y + ref.h / 2 - (b.y + b.h / 2); break;
    }
    return dx || dy ? { ...n, x: n.x + dx, y: n.y + dy } : n;
  });
}

export function distributeNodes(doc: QuvreloDocument, ids: Id[], axis: 'h' | 'v', bounds: BoundsFn = nodeBounds): QuvreloDocument {
  const locs = ids.map((id) => findNode(doc, id)).filter((l): l is NonNullable<typeof l> => !!l);
  if (locs.length < 3) return doc;
  const items = locs.map((l) => ({ id: l.node.id, b: bounds(l.node) }));
  const key = axis === 'h' ? 'x' : 'y';
  const size = axis === 'h' ? 'w' : 'h';
  items.sort((a, b) => a.b[key] - b.b[key]);
  const start = items[0].b[key];
  const end = Math.max(...items.map((i) => i.b[key] + i.b[size]));
  const total = items.reduce((s, i) => s + i.b[size], 0);
  const gap = (end - start - total) / (items.length - 1);
  const deltas = new Map<Id, number>();
  let cursor = start;
  for (const it of items) {
    deltas.set(it.id, cursor - it.b[key]);
    cursor += it.b[size] + gap;
  }
  return updateNodes(doc, ids, (n) => {
    const d = deltas.get(n.id) ?? 0;
    return axis === 'h' ? { ...n, x: n.x + d } : { ...n, y: n.y + d };
  });
}

export function flipNodes(doc: QuvreloDocument, ids: Id[], axis: 'h' | 'v'): QuvreloDocument {
  return updateNodes(doc, ids, (n) => (axis === 'h' ? { ...n, flipX: !n.flipX } : { ...n, flipY: !n.flipY }));
}

export function rotateNodes(doc: QuvreloDocument, ids: Id[], deg: number): QuvreloDocument {
  return updateNodes(doc, ids, (n) => ({ ...n, rotation: (((n.rotation + deg) % 360) + 360) % 360 }));
}

export function nudgeNodes(doc: QuvreloDocument, ids: Id[], dx: number, dy: number): QuvreloDocument {
  return updateNodes(doc, ids, (n) => (n.locked ? n : { ...n, x: n.x + dx, y: n.y + dy }));
}

/** Convert a shape into an editable path node with the same appearance. */
export function convertToCurves(doc: QuvreloDocument, id: Id): QuvreloDocument {
  const loc = findNode(doc, id);
  if (!loc) return doc;
  const n = loc.node;
  if (n.type === 'path' || !['rect', 'ellipse', 'polygon', 'star'].includes(n.type)) return doc;
  const d = nodeToPath(n);
  if (!d) return doc;
  const shape = n as Extract<SceneNode, { type: 'rect' | 'ellipse' | 'polygon' | 'star' }>;
  const pathNode: PathNode = {
    ...pickBase(shape),
    type: 'path',
    d,
    closed: true,
    fill: shape.fill,
    stroke: shape.stroke,
  };
  return updateNode(doc, id, () => pathNode);
}

export function pickBase(n: SceneNode): NodeBase {
  const { id, name, visible, locked, opacity, blend, x, y, rotation, scaleX, scaleY, skewX, flipX, flipY, mask } = n;
  return { id, name, visible, locked, opacity, blend, x, y, rotation, scaleX, scaleY, skewX, flipX, flipY, mask };
}

/** Build a path node from a path given in world coordinates. */
export function pathNodeFromWorld(d: Parameters<typeof centrePath>[0], init: Partial<PathNode> = {}): PathNode {
  const c = centrePath(d);
  return make.path({ ...init, d: c.d, x: c.cx, y: c.cy, closed: d.some((cmd) => cmd[0] === 'Z') });
}

/** World-space outline of a node (applies the node and ancestor transforms). */
export function worldPath(doc: QuvreloDocument, id: Id) {
  const loc = findNode(doc, id);
  if (!loc) return null;
  const d = nodeToPath(loc.node);
  if (!d) return null;
  return transformPath(d, worldMatrix(loc));
}

/** Convert a world point into a node's local coordinates. */
export function worldToLocal(doc: QuvreloDocument, id: Id, p: { x: number; y: number }) {
  const loc = findNode(doc, id);
  if (!loc) return p;
  return apply(invert(worldMatrix(loc)), p);
}

// ---------------------------------------------------------------------------
// Masks

export function setMaskFromWorldPath(doc: QuvreloDocument, id: Id, worldD: Parameters<typeof transformPath>[0], inverted = false): QuvreloDocument {
  const loc = findNode(doc, id);
  if (!loc) return doc;
  const local = transformPath(worldD, invert(worldMatrix(loc)));
  return updateNode(doc, id, { mask: { d: local, inverted, enabled: true } } as Partial<SceneNode>);
}

export function releaseMask(doc: QuvreloDocument, id: Id): QuvreloDocument {
  return updateNode(doc, id, (n) => {
    const { mask: _mask, ...rest } = n;
    return rest as SceneNode;
  });
}

// ---------------------------------------------------------------------------
// Pages & masters

export function addPage(doc: QuvreloDocument, afterIndex = doc.pages.length - 1, masterId: Id | null = null): { doc: QuvreloDocument; pageId: Id } {
  const page = createPage(`Page ${doc.pages.length + 1}`, masterId ?? doc.pages[afterIndex]?.masterId ?? null);
  const pages = [...doc.pages];
  pages.splice(afterIndex + 1, 0, page);
  return { doc: renumberPages({ ...doc, pages }), pageId: page.id };
}

export function duplicatePage(doc: QuvreloDocument, pageId: Id): { doc: QuvreloDocument; pageId: Id } {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return { doc, pageId };
  const src = doc.pages[i];
  let out = doc;
  const nodes = src.nodes.map((n) => {
    const c = cloneNode(n);
    out = detachClonedFrames(out, c);
    return c;
  });
  const page: Page = { ...createPage(src.name + ' copy', src.masterId), nodes };
  const pages = [...out.pages];
  pages.splice(i + 1, 0, page);
  return { doc: renumberPages({ ...out, pages }), pageId: page.id };
}

export function removePage(doc: QuvreloDocument, pageId: Id): QuvreloDocument {
  if (doc.pages.length <= 1) return doc;
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  let out = removeNodes(doc, page.nodes.map((n) => n.id));
  out = { ...out, pages: out.pages.filter((p) => p.id !== pageId) };
  return renumberPages(out);
}

export function movePage(doc: QuvreloDocument, pageId: Id, toIndex: number): QuvreloDocument {
  const pages = [...doc.pages];
  const i = pages.findIndex((p) => p.id === pageId);
  if (i < 0) return doc;
  const [p] = pages.splice(i, 1);
  pages.splice(Math.max(0, Math.min(toIndex, pages.length)), 0, p);
  return renumberPages({ ...doc, pages });
}

/** Keep default "Page N" names in sequence; custom names are preserved. */
function renumberPages(doc: QuvreloDocument): QuvreloDocument {
  const pages = doc.pages.map((p, i) => (/^Page \d+( copy)?$/.test(p.name) ? { ...p, name: `Page ${i + 1}` } : p));
  return { ...doc, pages };
}

export function renamePage(doc: QuvreloDocument, pageId: Id, name: string): QuvreloDocument {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === pageId ? { ...p, name } : p)),
    masters: doc.masters.map((m) => (m.id === pageId ? { ...m, name } : m)),
  };
}

export function setPageMaster(doc: QuvreloDocument, pageId: Id, masterId: Id | null): QuvreloDocument {
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? { ...p, masterId } : p)) };
}

export function addMaster(doc: QuvreloDocument, name?: string): { doc: QuvreloDocument; masterId: Id } {
  const letter = String.fromCharCode(65 + doc.masters.length);
  const m = createMaster(name ?? `${letter}-Master`);
  return { doc: { ...doc, masters: [...doc.masters, m] }, masterId: m.id };
}

export function removeMaster(doc: QuvreloDocument, masterId: Id): QuvreloDocument {
  const m = doc.masters.find((x) => x.id === masterId);
  if (!m) return doc;
  let out = removeNodes(doc, m.nodes.map((n) => n.id));
  out = {
    ...out,
    masters: out.masters.filter((x) => x.id !== masterId),
    pages: out.pages.map((p) => (p.masterId === masterId ? { ...p, masterId: null } : p)),
  };
  return out;
}

// ---------------------------------------------------------------------------
// Stories & text frames

export function addTextFrame(
  doc: QuvreloDocument, containerId: Id, init: Partial<Extract<SceneNode, { type: 'textframe' }>>, text = '', style: Partial<TextStyle> = {},
): { doc: QuvreloDocument; id: Id } {
  const story = createStory(text, style);
  const frame = make.textframe({ ...init, storyId: story.id });
  story.chain = [frame.id];
  let out: QuvreloDocument = { ...doc, stories: { ...doc.stories, [story.id]: story } };
  out = addNodes(out, containerId, [frame]);
  return { doc: out, id: frame.id };
}

export function setStoryText(doc: QuvreloDocument, storyId: Id, text: string): QuvreloDocument {
  const s = doc.stories[storyId];
  if (!s || s.text === text) return doc;
  return { ...doc, stories: { ...doc.stories, [storyId]: { ...s, text } } };
}

export function setStoryStyle(doc: QuvreloDocument, storyId: Id, style: Partial<TextStyle>): QuvreloDocument {
  const s = doc.stories[storyId];
  if (!s) return doc;
  return { ...doc, stories: { ...doc.stories, [storyId]: { ...s, style: { ...s.style, ...style } } } };
}

/** Link `toFrame` after `fromFrame` so the story overflows into it. */
export function linkFrames(doc: QuvreloDocument, fromFrameId: Id, toFrameId: Id): QuvreloDocument {
  const from = findNode(doc, fromFrameId)?.node;
  const to = findNode(doc, toFrameId)?.node;
  if (!from || !to || from.type !== 'textframe' || to.type !== 'textframe' || fromFrameId === toFrameId) return doc;
  const story = doc.stories[from.storyId];
  if (!story || story.chain.includes(toFrameId)) return doc;
  const oldStory = doc.stories[to.storyId];
  const stories = { ...doc.stories };
  let text = story.text;
  if (oldStory) {
    const remaining = oldStory.chain.filter((f) => f !== toFrameId);
    if (remaining.length) stories[oldStory.id] = { ...oldStory, chain: remaining };
    else {
      if (oldStory.text.trim()) text = text + (text.endsWith('\n') || !text ? '' : '\n') + oldStory.text;
      delete stories[oldStory.id];
    }
  }
  const chain = [...story.chain];
  chain.splice(chain.indexOf(fromFrameId) + 1, 0, toFrameId);
  stories[story.id] = { ...story, text, chain };
  const out = { ...doc, stories };
  return updateNode(out, toFrameId, { storyId: story.id } as Partial<SceneNode>);
}

/** Detach a frame from its story chain; it gets a new empty story. */
export function unlinkFrame(doc: QuvreloDocument, frameId: Id): QuvreloDocument {
  const frame = findNode(doc, frameId)?.node;
  if (!frame || frame.type !== 'textframe') return doc;
  const story = doc.stories[frame.storyId];
  if (!story || story.chain.length <= 1) return doc;
  const fresh = createStory('', story.style);
  fresh.chain = [frameId];
  const stories = {
    ...doc.stories,
    [story.id]: { ...story, chain: story.chain.filter((f) => f !== frameId) },
    [fresh.id]: fresh,
  };
  return updateNode({ ...doc, stories }, frameId, { storyId: fresh.id } as Partial<SceneNode>);
}

// ---------------------------------------------------------------------------
// Document-level

export function resizeDocument(
  doc: QuvreloDocument, width: number, height: number, anchor: { x: number; y: number } = { x: 0.5, y: 0.5 },
): QuvreloDocument {
  const dx = (width - doc.settings.width) * anchor.x;
  const dy = (height - doc.settings.height) * anchor.y;
  const shift = (nodes: SceneNode[]) => nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
  return {
    ...doc,
    settings: { ...doc.settings, width, height },
    pages: doc.pages.map((p) => ({ ...p, nodes: shift(p.nodes) })),
    masters: doc.masters.map((m) => ({ ...m, nodes: shift(m.nodes) })),
    guides: doc.guides.map((g) => ({ ...g, position: g.position + (g.orientation === 'v' ? dx : dy) })),
  };
}

/** Crop every page of the document to a rectangle (document coordinates). */
export function cropDocument(doc: QuvreloDocument, r: Rect): QuvreloDocument {
  const w = Math.max(1, Math.round(r.w));
  const h = Math.max(1, Math.round(r.h));
  const shift = (nodes: SceneNode[]) => nodes.map((n) => ({ ...n, x: n.x - r.x, y: n.y - r.y }));
  return {
    ...doc,
    settings: { ...doc.settings, width: w, height: h },
    pages: doc.pages.map((p) => ({ ...p, nodes: shift(p.nodes) })),
    masters: doc.masters.map((m) => ({ ...m, nodes: shift(m.nodes) })),
    guides: doc.guides
      .map((g) => ({ ...g, position: g.position - (g.orientation === 'v' ? r.x : r.y) }))
      .filter((g) => g.position >= 0 && g.position <= (g.orientation === 'v' ? w : h)),
  };
}

export function addGuide(doc: QuvreloDocument, orientation: 'h' | 'v', position: number): { doc: QuvreloDocument; id: Id } {
  const g: Guide = { id: newId('gd'), orientation, position };
  return { doc: { ...doc, guides: [...doc.guides, g] }, id: g.id };
}

export function moveGuide(doc: QuvreloDocument, id: Id, position: number): QuvreloDocument {
  return { ...doc, guides: doc.guides.map((g) => (g.id === id ? { ...g, position } : g)) };
}

export function removeGuide(doc: QuvreloDocument, id: Id): QuvreloDocument {
  return { ...doc, guides: doc.guides.filter((g) => g.id !== id) };
}

export function addSwatch(doc: QuvreloDocument, color: string, name?: string): QuvreloDocument {
  if (doc.swatches.some((s) => s.color.toLowerCase() === color.toLowerCase())) return doc;
  const sw: Swatch = { id: newId('sw'), name: name ?? color, color };
  return { ...doc, swatches: [...doc.swatches, sw] };
}

export function removeSwatch(doc: QuvreloDocument, id: Id): QuvreloDocument {
  return { ...doc, swatches: doc.swatches.filter((s) => s.id !== id) };
}

/** Remove asset metadata no longer referenced by any node. */
export function pruneAssets(doc: QuvreloDocument, referenced: Set<Id>): QuvreloDocument {
  const assets = Object.fromEntries(Object.entries(doc.assets).filter(([id]) => referenced.has(id)));
  return Object.keys(assets).length === Object.keys(doc.assets).length ? doc : { ...doc, assets };
}
