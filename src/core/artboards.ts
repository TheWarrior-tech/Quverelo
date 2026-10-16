/**
 * Artboards (Vector): several boards on one page, each a group with a fixed,
 * clipped size and its own background. They export one file each (slices)
 * and objects drawn over a board go into it.
 */
import { addNodes, updateNode } from './commands';
import { findNode, walk, worldMatrix } from './document';
import { apply, invert, type Point, type Rect } from './geometry';
import { newId } from './ids';
import type { GroupNode, Id, QuvreloDocument, SceneNode } from './types';

export const ARTBOARD_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: 'a4', label: 'A4 portrait', w: 794, h: 1123 },
  { id: 'a4l', label: 'A4 landscape', w: 1123, h: 794 },
  { id: 'iphone', label: 'Phone 390 × 844', w: 390, h: 844 },
  { id: 'tablet', label: 'Tablet 820 × 1180', w: 820, h: 1180 },
  { id: 'desktop', label: 'Desktop 1440 × 1024', w: 1440, h: 1024 },
  { id: 'social', label: 'Social post 1080 × 1080', w: 1080, h: 1080 },
  { id: 'icon', label: 'App icon 1024 × 1024', w: 1024, h: 1024 },
];

export function makeArtboard(r: Rect, name: string, background: string | null = '#ffffff', children: SceneNode[] = []): GroupNode {
  return {
    id: newId('node'), name, visible: true, locked: false, opacity: 1, blend: 'normal',
    x: r.x + r.w / 2, y: r.y + r.h / 2, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false,
    type: 'group', children, artboard: { w: Math.max(1, r.w), h: Math.max(1, r.h), background },
  };
}

/** Next free "Artboard N" name on a page. */
export function nextArtboardName(doc: QuvreloDocument, pageId: Id): string {
  const names = new Set<string>();
  const page = doc.pages.find((p) => p.id === pageId);
  if (page) walk(page.nodes, (n) => { if (n.type === 'group' && n.artboard) names.add(n.name); });
  let i = 1;
  while (names.has(`Artboard ${i}`)) i++;
  return `Artboard ${i}`;
}

export function addArtboard(doc: QuvreloDocument, pageId: Id, r: Rect, name?: string, background: string | null = '#ffffff'): { doc: QuvreloDocument; id: Id } {
  const ab = makeArtboard(r, name ?? nextArtboardName(doc, pageId), background);
  // boards sit under everything else on the page
  return { doc: addNodes(doc, pageId, [ab], 0), id: ab.id };
}

/** The top-level artboard under a page point (topmost first), if any. */
export function artboardAt(doc: QuvreloDocument, pageId: Id, p: Point): GroupNode | null {
  const page = doc.pages.find((x) => x.id === pageId);
  if (!page) return null;
  for (let i = page.nodes.length - 1; i >= 0; i--) {
    const n = page.nodes[i];
    if (n.type !== 'group' || !n.artboard || !n.visible) continue;
    const loc = findNode(doc, n.id)!;
    const q = apply(invert(worldMatrix(loc)), p);
    if (Math.abs(q.x) <= n.artboard.w / 2 && Math.abs(q.y) <= n.artboard.h / 2) return n;
  }
  return null;
}

/** Move a top-level node into an artboard, keeping where it appears on the page. */
export function moveIntoArtboard(doc: QuvreloDocument, nodeId: Id, artboardId: Id): QuvreloDocument {
  const loc = findNode(doc, nodeId);
  const ab = findNode(doc, artboardId);
  if (!loc || !ab || loc.ancestors.length || ab.node.type !== 'group' || nodeId === artboardId) return doc;
  const inv = invert(worldMatrix(ab));
  const c = apply(inv, { x: loc.node.x, y: loc.node.y });
  const child = { ...loc.node, x: c.x, y: c.y };
  const page = doc.pages.find((p) => p.id === loc.container.id);
  if (!page) return doc;
  const without = { ...doc, pages: doc.pages.map((p) => (p.id === page.id ? { ...p, nodes: p.nodes.filter((n) => n.id !== nodeId) } : p)) };
  return updateNode<GroupNode>(without, artboardId, (g) => ({ ...g, children: [...g.children, child] }));
}

export function setArtboardSize(doc: QuvreloDocument, id: Id, w: number, h: number): QuvreloDocument {
  return updateNode<GroupNode>(doc, id, (g) => (g.artboard ? { ...g, artboard: { ...g.artboard, w: Math.max(1, w), h: Math.max(1, h) } } : g));
}

export function setArtboardBackground(doc: QuvreloDocument, id: Id, background: string | null): QuvreloDocument {
  return updateNode<GroupNode>(doc, id, (g) => (g.artboard ? { ...g, artboard: { ...g.artboard, background } } : g));
}
