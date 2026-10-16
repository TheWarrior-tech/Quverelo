import { newId } from './ids';
import {
  composeTransform, transformRect, unionRects, multiply, type Matrix, type Rect,
} from './geometry';
import { ellipsePath, pathBounds, pointsToPath, polygonPoints, rectPath, starPoints } from './path';
import type {
  DocumentSettings, QuvreloDocument, GroupNode, MasterPage, NodeBase, Page, Paint, PathCommand,
  SceneNode, Story, Stroke, StudioKind, Swatch, TextStyle, Id,
} from './types';

/**
 * Default document palette (critique 3 P2-8): a ten-step neutral ramp, then ten
 * considered mid-tone hues that print and project well, in place of a saturated
 * rainbow. The picker shows it as two rows of ten.
 */
export const DEFAULT_SWATCHES: Swatch[] = [
  ['Black', '#000000'], ['Ink', '#1b1d22'], ['Graphite', '#33363d'], ['Slate', '#4d5159'], ['Steel', '#6b7079'],
  ['Pewter', '#8d929b'], ['Silver', '#b1b5bc'], ['Mist', '#d4d7dc'], ['Paper', '#ecedef'], ['White', '#ffffff'],
  ['Brick', '#c4473a'], ['Coral', '#e07a5f'], ['Amber', '#e3a13b'], ['Mustard', '#d9b44a'], ['Olive', '#8a9a5b'],
  ['Green', '#3d8b6d'], ['Teal', '#2a8c9a'], ['Blue', '#3d6fb6'], ['Indigo', '#5a55a6'], ['Plum', '#8e4f8b'],
].map(([name, color]) => ({ id: newId('sw'), name, color }));

export const solid = (color: string): Paint => ({ type: 'solid', color });
export const NO_PAINT: Paint = { type: 'none' };

export function makeStroke(color: string | null = null, width = 0): Stroke {
  return {
    paint: color ? solid(color) : NO_PAINT,
    width,
    dash: [],
    cap: 'butt',
    join: 'miter',
  };
}

export function defaultTextStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: 'Inter, Segoe UI, Helvetica, Arial, sans-serif',
    fontSize: 16,
    fontWeight: 400,
    italic: false,
    underline: false,
    lineHeight: 1.3,
    letterSpacing: 0,
    align: 'left',
    fill: solid('#1b1b1f'),
    ...overrides,
  };
}

export function defaultSettings(overrides: Partial<DocumentSettings> = {}): DocumentSettings {
  return {
    width: 1920,
    height: 1080,
    unit: 'px',
    dpi: 300,
    bleed: 0,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    background: '#ffffff',
    facingPages: false,
    columns: 1,
    columnGutter: 16,
    ...overrides,
  };
}

export function createPage(name = 'Page 1', masterId: Id | null = null, nodes: SceneNode[] = []): Page {
  return { id: newId('pg'), name, masterId, nodes };
}

export function createMaster(name = 'A-Master', nodes: SceneNode[] = []): MasterPage {
  return { id: newId('ms'), name, nodes };
}

export function createDocument(opts: {
  title?: string;
  settings?: Partial<DocumentSettings>;
  pages?: number;
  studio?: StudioKind;
} = {}): QuvreloDocument {
  const now = new Date().toISOString();
  const pageCount = Math.max(1, opts.pages ?? 1);
  const pages: Page[] = [];
  for (let i = 0; i < pageCount; i++) pages.push(createPage(`Page ${i + 1}`));
  return {
    format: 'quvrelo',
    version: 1,
    id: newId('doc'),
    title: opts.title ?? 'Untitled',
    createdAt: now,
    modifiedAt: now,
    settings: defaultSettings(opts.settings),
    pages,
    masters: [],
    stories: {},
    guides: [],
    swatches: DEFAULT_SWATCHES.map((s) => ({ ...s })),
    assets: {},
    studio: opts.studio ?? 'vector',
  };
}

function base(name: string, extra: Partial<NodeBase> = {}): NodeBase {
  return {
    id: newId('n'),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    flipX: false,
    flipY: false,
    ...extra,
  };
}

type Without<T, K extends keyof T> = Omit<T, K>;
type NodeInit<T extends SceneNode> = Partial<Without<T, 'type'>>;

export const make = {
  rect(p: NodeInit<Extract<SceneNode, { type: 'rect' }>> = {}): Extract<SceneNode, { type: 'rect' }> {
    return { ...base('Rectangle'), w: 100, h: 100, radius: 0, fill: solid('#3a86ff'), stroke: makeStroke(), ...p, type: 'rect' };
  },
  ellipse(p: NodeInit<Extract<SceneNode, { type: 'ellipse' }>> = {}): Extract<SceneNode, { type: 'ellipse' }> {
    return { ...base('Ellipse'), w: 100, h: 100, fill: solid('#ff7f50'), stroke: makeStroke(), ...p, type: 'ellipse' };
  },
  polygon(p: NodeInit<Extract<SceneNode, { type: 'polygon' }>> = {}): Extract<SceneNode, { type: 'polygon' }> {
    return { ...base('Polygon'), w: 100, h: 100, sides: 6, fill: solid('#2a9d8f'), stroke: makeStroke(), ...p, type: 'polygon' };
  },
  star(p: NodeInit<Extract<SceneNode, { type: 'star' }>> = {}): Extract<SceneNode, { type: 'star' }> {
    return { ...base('Star'), w: 100, h: 100, points: 5, innerRatio: 0.45, fill: solid('#ffd166'), stroke: makeStroke(), ...p, type: 'star' };
  },
  path(p: NodeInit<Extract<SceneNode, { type: 'path' }>> = {}): Extract<SceneNode, { type: 'path' }> {
    return { ...base('Curve'), d: [], closed: false, fill: NO_PAINT, stroke: makeStroke('#1b1b1f', 2), ...p, type: 'path' };
  },
  text(p: NodeInit<Extract<SceneNode, { type: 'text' }>> = {}): Extract<SceneNode, { type: 'text' }> {
    return { ...base('Text'), text: 'Text', style: defaultTextStyle({ fontSize: 48 }), stroke: makeStroke(), ...p, type: 'text' };
  },
  textframe(p: NodeInit<Extract<SceneNode, { type: 'textframe' }>> & { storyId: Id }): Extract<SceneNode, { type: 'textframe' }> {
    return {
      ...base('Text Frame'), w: 300, h: 200, padding: 0, columns: 1, columnGap: 16,
      fill: NO_PAINT, stroke: makeStroke(), ...p, type: 'textframe',
    };
  },
  imageframe(p: NodeInit<Extract<SceneNode, { type: 'imageframe' }>> = {}): Extract<SceneNode, { type: 'imageframe' }> {
    return {
      ...base('Picture Frame'), w: 300, h: 200, assetId: null, fit: 'fill', contentX: 0, contentY: 0, contentScale: 1,
      fill: NO_PAINT, stroke: makeStroke(), ...p, type: 'imageframe',
    };
  },
  raster(p: NodeInit<Extract<SceneNode, { type: 'raster' }>> & { assetId: Id; w: number; h: number }): Extract<SceneNode, { type: 'raster' }> {
    return { ...base('Pixel Layer'), adjustments: [], ...p, type: 'raster' };
  },
  adjustment(p: NodeInit<Extract<SceneNode, { type: 'adjustment' }>> & { adjustment: Extract<SceneNode, { type: 'adjustment' }>['adjustment']; w: number; h: number }): Extract<SceneNode, { type: 'adjustment' }> {
    return { ...base('Adjustment'), ...p, type: 'adjustment' };
  },
  group(children: SceneNode[], p: Partial<NodeBase> = {}): GroupNode {
    return { ...base('Group'), children, ...p, type: 'group' };
  },
};

export function createStory(text = '', style: Partial<TextStyle> = {}): Story {
  return { id: newId('st'), text, style: defaultTextStyle(style), chain: [] };
}

// ---------------------------------------------------------------------------
// Geometry of nodes

export function nodeMatrix(n: NodeBase): Matrix {
  return composeTransform(n);
}

/** Estimate of artistic text size (renderer refines with real font metrics). */
export function estimateTextSize(text: string, style: TextStyle): { w: number; h: number } {
  const lines = text.split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  return {
    w: Math.max(style.fontSize * 0.3, longest * style.fontSize * 0.55),
    h: lines.length * style.fontSize * style.lineHeight,
  };
}

/** Intrinsic (untransformed) size of a node, centred at its origin. */
export function nodeSize(n: SceneNode): { w: number; h: number } {
  switch (n.type) {
    case 'path': {
      const b = pathBounds(n.d);
      return { w: b.w, h: b.h };
    }
    case 'text':
      return estimateTextSize(n.text, n.style);
    case 'group': {
      const r = unionRects(n.children.map(nodeBounds));
      return { w: r.w, h: r.h };
    }
    default:
      return { w: n.w, h: n.h };
  }
}

/** Local bounds (before the node's own transform). */
export function nodeLocalBounds(n: SceneNode): Rect {
  if (n.type === 'path') return pathBounds(n.d);
  if (n.type === 'group') return unionRects(n.children.map(nodeBounds));
  const { w, h } = nodeSize(n);
  return { x: -w / 2, y: -h / 2, w, h };
}

/** Axis-aligned bounds in the parent's coordinate space. */
export function nodeBounds(n: SceneNode): Rect {
  return transformRect(nodeMatrix(n), nodeLocalBounds(n));
}

/** Vector outline of a node in node-local coordinates (null if it has none). */
export function nodeToPath(n: SceneNode): PathCommand[] | null {
  switch (n.type) {
    case 'rect':
      return rectPath(n.w, n.h, n.radius);
    case 'ellipse':
      return ellipsePath(n.w, n.h);
    case 'polygon':
      return pointsToPath(polygonPoints(n.w, n.h, n.sides));
    case 'star':
      return pointsToPath(starPoints(n.w, n.h, n.points, n.innerRatio));
    case 'path':
      return n.d;
    case 'imageframe':
    case 'textframe':
    case 'raster':
    case 'table':
      return rectPath(n.w, n.h);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tree helpers (immutable)

export interface NodeLocation {
  node: SceneNode;
  container: { kind: 'page' | 'master'; id: Id };
  /** ancestor groups, outermost first */
  ancestors: GroupNode[];
  index: number;
}

export function walk(nodes: SceneNode[], fn: (n: SceneNode, ancestors: GroupNode[]) => void, ancestors: GroupNode[] = []): void {
  for (const n of nodes) {
    fn(n, ancestors);
    if (n.type === 'group') walk(n.children, fn, [...ancestors, n]);
  }
}

export function allContainers(doc: QuvreloDocument): { kind: 'page' | 'master'; id: Id; nodes: SceneNode[] }[] {
  return [
    ...doc.pages.map((p) => ({ kind: 'page' as const, id: p.id, nodes: p.nodes })),
    ...doc.masters.map((m) => ({ kind: 'master' as const, id: m.id, nodes: m.nodes })),
  ];
}

export function findNode(doc: QuvreloDocument, id: Id): NodeLocation | null {
  for (const c of allContainers(doc)) {
    const found = findIn(c.nodes, id, []);
    if (found) return { ...found, container: { kind: c.kind, id: c.id } };
  }
  return null;
}

function findIn(nodes: SceneNode[], id: Id, ancestors: GroupNode[]): Omit<NodeLocation, 'container'> | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return { node: n, ancestors, index: i };
    if (n.type === 'group') {
      const f = findIn(n.children, id, [...ancestors, n]);
      if (f) return f;
    }
  }
  return null;
}

/** World matrix of a node (including ancestor groups). */
export function worldMatrix(loc: NodeLocation): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  for (const g of loc.ancestors) m = multiply(m, nodeMatrix(g));
  return multiply(m, nodeMatrix(loc.node));
}

export function mapNodes(nodes: SceneNode[], fn: (n: SceneNode) => SceneNode | null): SceneNode[] {
  let changed = false;
  const out: SceneNode[] = [];
  for (const n of nodes) {
    let r = fn(n);
    if (r && r.type === 'group') {
      const kids = mapNodes(r.children, fn);
      if (kids !== r.children) r = { ...r, children: kids };
    }
    if (r !== n) changed = true;
    if (r) out.push(r);
  }
  return changed ? out : nodes;
}

/** Apply fn to every container's node list. */
export function mapContainers(doc: QuvreloDocument, fn: (nodes: SceneNode[]) => SceneNode[]): QuvreloDocument {
  let changed = false;
  const pages = doc.pages.map((p) => {
    const nodes = fn(p.nodes);
    if (nodes === p.nodes) return p;
    changed = true;
    return { ...p, nodes };
  });
  const masters = doc.masters.map((m) => {
    const nodes = fn(m.nodes);
    if (nodes === m.nodes) return m;
    changed = true;
    return { ...m, nodes };
  });
  return changed ? { ...doc, pages, masters } : doc;
}

export function getContainer(doc: QuvreloDocument, id: Id): Page | MasterPage | undefined {
  return doc.pages.find((p) => p.id === id) ?? doc.masters.find((m) => m.id === id);
}

export function setContainerNodes(doc: QuvreloDocument, id: Id, nodes: SceneNode[]): QuvreloDocument {
  if (doc.pages.some((p) => p.id === id)) {
    return { ...doc, pages: doc.pages.map((p) => (p.id === id ? { ...p, nodes } : p)) };
  }
  return { ...doc, masters: doc.masters.map((m) => (m.id === id ? { ...m, nodes } : m)) };
}

/** Collect asset ids referenced anywhere in the document. */
export function referencedAssets(doc: QuvreloDocument): Set<Id> {
  const ids = new Set<Id>();
  for (const c of allContainers(doc)) {
    walk(c.nodes, (n) => {
      if (n.type === 'raster') ids.add(n.assetId);
      if (n.type === 'imageframe' && n.assetId) ids.add(n.assetId);
      if (n.pixelMask) ids.add(n.pixelMask.assetId);
    });
  }
  return ids;
}

/** Deep clone a node giving it (and its descendants) fresh ids. */
export function cloneNode<T extends SceneNode>(n: T): T {
  const copy = structuredCloneSafe(n);
  const reid = (x: SceneNode) => {
    x.id = newId('n');
    if (x.type === 'group') x.children.forEach(reid);
  };
  reid(copy);
  return copy;
}

export function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function countNodes(nodes: SceneNode[]): number {
  let c = 0;
  walk(nodes, () => c++);
  return c;
}

/** Default layer names given by `make.text` / `make.textframe`; a text layer still carrying one is auto-named from its content. */
const AUTO_TEXT_NAMES: Record<string, string> = { text: 'Text', textframe: 'Text Frame' };
export const AUTO_NAME_LENGTH = 24;

/** First words of a text, whitespace collapsed, cut at a word boundary to `max` characters with an ellipsis. */
export function textSnippet(text: string, max = AUTO_NAME_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** Whether this layer's name is still the automatic default (never renamed). */
export function hasAutoName(n: SceneNode): boolean {
  const def = AUTO_TEXT_NAMES[n.type];
  return def !== undefined && n.name === def;
}

/**
 * The name a layer is shown under. Text layers that have not been renamed are
 * named by the first words of their content ("Open Evening", "Thursday 2…"),
 * like Figma; an empty text frame keeps "Text Frame". Everything else shows
 * its stored name.
 */
export function layerDisplayName(n: SceneNode, doc: Pick<QuvreloDocument, 'stories'> | null | undefined, max = AUTO_NAME_LENGTH): string {
  if (!hasAutoName(n)) return n.name;
  const text = n.type === 'text' ? n.text : n.type === 'textframe' ? doc?.stories[n.storyId]?.text ?? '' : '';
  return textSnippet(text, max) || n.name;
}

/**
 * Length cap for names shown in a CSS-truncated slot (layer rows, the inspector
 * header): long enough that the CSS ellipsis is the only cut anyone sees, so a
 * name is never cut twice ("Thirty projects fro…", critique 3 P2-16).
 */
export const DISPLAY_NAME_MAX = 120;
