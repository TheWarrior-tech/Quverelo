/**
 * The script-side API, evaluated inside the QuickJS sandbox before the user's
 * script. It wraps the single host function `__host(op, argsJson)` in friendly
 * objects. Documented in docs/SCRIPTING.md; typings in SCRIPTING_DTS below.
 */
export const PRELUDE = String.raw`
"use strict";
const __bridge = globalThis.__host;
const __call = (op, ...args) => {
  const r = JSON.parse(__bridge(op, JSON.stringify(args)));
  if (r && r.error) throw new Error(r.error);
  return r ? r.value : undefined;
};
const __PROPS = ['name','x','y','w','h','rotation','opacity','visible','locked','blend','fill','stroke','strokeWidth','text','fontSize','fontFamily','fontWeight','radius'];
class Node {
  constructor(id) { Object.defineProperty(this, 'id', { value: id, enumerable: true }); }
  get type() { return __call('node.get', this.id).type; }
  get bounds() { return __call('node.get', this.id).bounds; }
  get children() { return (__call('node.get', this.id).children || []).map((id) => new Node(id)); }
  info() { return __call('node.get', this.id); }
  set(props) { __call('node.set', this.id, props); return this; }
  moveBy(dx, dy) { const i = this.info(); return this.set({ x: i.x + (dx || 0), y: i.y + (dy || 0) }); }
  remove() { __call('node.remove', this.id); }
  duplicate(offset) { return new Node(__call('node.duplicate', this.id, offset || 0)); }
  ungroup() { return __call('ungroup', this.id).map((id) => new Node(id)); }
  toString() { return '[' + this.type + ' ' + this.id + ']'; }
}
for (const k of __PROPS) {
  Object.defineProperty(Node.prototype, k, {
    get() { return __call('node.get', this.id)[k]; },
    set(v) { __call('node.set', this.id, { [k]: v }); },
  });
}
class Page {
  constructor(index) { this.index = index; }
  get name() { return __call('pages.list')[this.index].name; }
  set name(v) { __call('page.rename', this.index, v); }
  get nodes() { return __call('page.nodes', this.index).map((id) => new Node(id)); }
  add(kind, props) { return new Node(__call('create', this.index, kind, props || {})); }
  addRect(p) { return this.add('rect', p); }
  addEllipse(p) { return this.add('ellipse', p); }
  addPolygon(p) { return this.add('polygon', p); }
  addStar(p) { return this.add('star', p); }
  addText(p) { return this.add('text', typeof p === 'string' ? { text: p } : p); }
  addTextFrame(p) { return this.add('textframe', p); }
  addPath(d, p) { return this.add('path', Object.assign({}, p || {}, { d })); }
  find(q) { return __call('find', Object.assign({}, q || {}, { page: this.index })).map((id) => new Node(id)); }
}
const document = {
  get title() { return __call('doc.info').title; },
  set title(v) { __call('doc.setTitle', v); },
  get width() { return __call('doc.info').width; },
  get height() { return __call('doc.info').height; },
  get unit() { return __call('doc.info').unit; },
  get dpi() { return __call('doc.info').dpi; },
  get studio() { return __call('doc.info').studio; },
  get background() { return __call('doc.info').background; },
  set background(v) { __call('doc.setBackground', v); },
  get pages() { return __call('pages.list').map((p) => new Page(p.index)); },
  get page() { return new Page(0); },
  addPage(name) { return new Page(__call('pages.add', name)); },
  find(q) { return __call('find', q || {}).map((id) => new Node(id)); },
  group(nodes) { return new Node(__call('group', nodes.map((n) => n.id))); },
  get swatches() { return __call('swatches.list'); },
  addSwatch(name, color) { __call('swatches.add', name, color); },
};
const selection = {
  get nodes() { return __call('selection.get').map((id) => new Node(id)); },
  set(nodes) { __call('selection.set', nodes.map((n) => n.id)); },
  clear() { __call('selection.set', []); },
};
const units = {
  mm: (v) => v * 96 / 25.4, cm: (v) => v * 96 / 2.54, in: (v) => v * 96, pt: (v) => v * 96 / 72, px: (v) => v,
  toMm: (px) => px * 25.4 / 96,
};
const color = {
  rgb: (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''),
  hsl: (h, s, l) => {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return color.rgb(f(0) * 255, f(8) * 255, f(4) * 255);
  },
};
const log = (...a) => __call('log', a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
const console = { log, info: log, warn: log, error: log };
const quvrelo = { document, selection, units, color, log, version: 1 };
`;

/** Type declarations for script authors (shipped in docs/SCRIPTING.md and shown in the editor help). */
export const SCRIPTING_DTS = `declare type Colour = string | null; // "#rrggbb", "rgb(r,g,b)" or null for none
declare type NodeType = 'rect'|'ellipse'|'polygon'|'star'|'path'|'text'|'textframe'|'imageframe'|'raster'|'group';
declare interface Node {
  readonly id: string; readonly type: NodeType; readonly bounds: { x: number; y: number; w: number; h: number };
  readonly children: Node[];
  name: string; x: number; y: number; w: number; h: number; rotation: number; opacity: number;
  visible: boolean; locked: boolean; blend: string; fill: Colour; stroke: Colour; strokeWidth: number;
  text?: string; fontSize?: number; fontFamily?: string; fontWeight?: number; radius?: number;
  set(props: Partial<Node>): Node; moveBy(dx: number, dy: number): Node; remove(): void;
  duplicate(offset?: number): Node; ungroup(): Node[];
}
declare interface Page {
  readonly index: number; name: string; readonly nodes: Node[];
  addRect(p?: Partial<Node>): Node; addEllipse(p?: Partial<Node>): Node; addPolygon(p?: Partial<Node> & { sides?: number }): Node;
  addStar(p?: Partial<Node> & { points?: number }): Node; addText(p: string | Partial<Node>): Node; addTextFrame(p?: Partial<Node>): Node;
  addPath(svgPathData: string, p?: Partial<Node>): Node; find(q?: { type?: NodeType; name?: string; text?: string }): Node[];
}
declare const document: {
  title: string; readonly width: number; readonly height: number; readonly unit: string; readonly dpi: number;
  readonly studio: 'photo'|'vector'|'layout'; background: Colour; readonly pages: Page[]; readonly page: Page;
  addPage(name?: string): Page; find(q?: { type?: NodeType; name?: string; text?: string; page?: number }): Node[];
  group(nodes: Node[]): Node; readonly swatches: { name: string; color: string }[]; addSwatch(name: string, color: string): void;
};
declare const selection: { readonly nodes: Node[]; set(nodes: Node[]): void; clear(): void };
declare const units: { mm(v: number): number; cm(v: number): number; in(v: number): number; pt(v: number): number; px(v: number): number; toMm(px: number): number };
declare const color: { rgb(r: number, g: number, b: number): string; hsl(h: number, s: number, l: number): string };
declare function log(...values: unknown[]): void;
`;
