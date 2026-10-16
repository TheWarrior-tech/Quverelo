/**
 * Scripting host: the operations a script may perform on a document, as plain
 * JSON-in / JSON-out calls. The sandboxed script never sees the real document
 * or any app API; it calls `__host(op, argsJson)` and gets JSON back (see
 * runner.ts for the QuickJS sandbox and prelude.ts for the script-side API).
 *
 * All edits go to a private working copy. The caller commits the final copy as
 * one undo step, so a script can always be undone in one go.
 */
import { createPage, createStory, findNode, make, nodeBounds, solid, NO_PAINT, defaultTextStyle, walk } from '../document';
import { addNodes, duplicateNodes, groupNodes, removeNodes, ungroup, updateNode } from '../commands';
import { centrePath, parsePath } from '../path';
import { BLEND_MODES, type BlendMode, type Id, type Paint, type QuvreloDocument, type SceneNode } from '../types';

export interface HostLimits {
  /** Most objects a single run may create. */
  maxCreated: number;
  /** Longest string accepted for text / names. */
  maxString: number;
}

export const DEFAULT_LIMITS: HostLimits = { maxCreated: 20000, maxString: 100_000 };

export class ScriptError extends Error {}

const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i;

function colour(v: unknown, what: string): Paint {
  if (v === null || v === 'none') return NO_PAINT;
  if (typeof v === 'string' && (COLOR_RE.test(v) || RGB_RE.test(v))) return solid(v.toLowerCase());
  throw new ScriptError(`${what} must be a colour like "#ff8800", "rgb(255,136,0)" or null`);
}

function finite(v: unknown, what: string, min = -1e7, max = 1e7): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ScriptError(`${what} must be a number`);
  if (v < min || v > max) throw new ScriptError(`${what} must be between ${min} and ${max}`);
  return v;
}

const paintHex = (p: Paint): string | null => (p.type === 'solid' ? p.color : p.type === 'none' ? null : (p.stops[0]?.color ?? null));

/** The JSON view of a node a script sees. */
export interface NodeInfo {
  id: Id;
  type: SceneNode['type'];
  name: string;
  x: number; y: number; w: number; h: number;
  rotation: number; opacity: number; visible: boolean; locked: boolean; blend: BlendMode;
  fill: string | null; stroke: string | null; strokeWidth: number;
  text?: string; fontSize?: number; fontFamily?: string; fontWeight?: number;
  radius?: number;
  children?: Id[];
  bounds: { x: number; y: number; w: number; h: number };
}

export class ScriptHost {
  doc: QuvreloDocument;
  selection: Id[];
  logs: string[] = [];
  created = 0;
  constructor(doc: QuvreloDocument, selection: Id[] = [], private limits: HostLimits = DEFAULT_LIMITS) {
    this.doc = doc;
    this.selection = selection.filter((id) => !!findNode(doc, id));
  }

  private node(id: unknown): SceneNode {
    const loc = typeof id === 'string' ? findNode(this.doc, id) : null;
    if (!loc) throw new ScriptError(`No object with id ${String(id)}`);
    return loc.node;
  }

  private str(v: unknown, what: string): string {
    if (typeof v !== 'string') throw new ScriptError(`${what} must be text`);
    if (v.length > this.limits.maxString) throw new ScriptError(`${what} is too long`);
    return v;
  }

  private page(i: unknown) {
    const n = typeof i === 'number' ? i : 0;
    const p = this.doc.pages[n];
    if (!p) throw new ScriptError(`No page ${n + 1} (the document has ${this.doc.pages.length})`);
    return p;
  }

  info(n: SceneNode): NodeInfo {
    const size = 'w' in n ? { w: n.w, h: n.h } : { w: nodeBounds(n).w, h: nodeBounds(n).h };
    const out: NodeInfo = {
      id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, w: size.w, h: size.h,
      rotation: n.rotation, opacity: n.opacity, visible: n.visible, locked: n.locked, blend: n.blend,
      fill: 'fill' in n ? paintHex(n.fill) : n.type === 'text' ? paintHex(n.style.fill) : null,
      stroke: 'stroke' in n ? paintHex(n.stroke.paint) : null,
      strokeWidth: 'stroke' in n ? n.stroke.width : 0,
      bounds: nodeBounds(n),
    };
    if (n.type === 'text') Object.assign(out, { text: n.text, fontSize: n.style.fontSize, fontFamily: n.style.fontFamily, fontWeight: n.style.fontWeight });
    if (n.type === 'textframe') {
      const s = this.doc.stories[n.storyId];
      if (s) Object.assign(out, { text: s.text, fontSize: s.style.fontSize, fontFamily: s.style.fontFamily, fontWeight: s.style.fontWeight, fill: paintHex(s.style.fill) });
    }
    if (n.type === 'rect') out.radius = n.radius;
    if (n.type === 'group') out.children = n.children.map((c) => c.id);
    return out;
  }

  private patch(n: SceneNode, p: Record<string, unknown>): void {
    let doc = this.doc;
    const up = (patch: Partial<SceneNode> | ((x: SceneNode) => SceneNode)) => { doc = updateNode(doc, n.id, patch as never); };
    for (const [k, v] of Object.entries(p)) {
      switch (k) {
        case 'name': up({ name: this.str(v, 'name').slice(0, 200) }); break;
        case 'x': case 'y': case 'rotation': up({ [k]: finite(v, k) } as Partial<SceneNode>); break;
        case 'opacity': up({ opacity: finite(v, 'opacity', 0, 1) }); break;
        case 'visible': case 'locked': up({ [k]: !!v } as Partial<SceneNode>); break;
        case 'blend':
          if (!BLEND_MODES.includes(v as BlendMode)) throw new ScriptError(`blend must be one of ${BLEND_MODES.join(', ')}`);
          up({ blend: v as BlendMode });
          break;
        case 'w': case 'h':
          if (!('w' in n)) throw new ScriptError(`${n.type} objects have no ${k}; scale them instead`);
          up({ [k]: finite(v, k, 0.01) } as Partial<SceneNode>);
          break;
        case 'radius':
          if (n.type !== 'rect') throw new ScriptError('radius applies to rectangles');
          up({ radius: finite(v, 'radius', 0) } as Partial<SceneNode>);
          break;
        case 'fill': {
          const paint = colour(v, 'fill');
          if (n.type === 'text') up((x) => ({ ...x, style: { ...(x as typeof n).style, fill: paint } }) as SceneNode);
          else if (n.type === 'textframe') {
            const s = doc.stories[n.storyId];
            if (s) doc = { ...doc, stories: { ...doc.stories, [s.id]: { ...s, style: { ...s.style, fill: paint } } } };
          } else if ('fill' in n) up({ fill: paint } as Partial<SceneNode>);
          else throw new ScriptError(`${n.type} objects have no fill`);
          break;
        }
        case 'stroke': case 'strokeWidth': {
          if (!('stroke' in n)) throw new ScriptError(`${n.type} objects have no stroke`);
          up((x) => {
            const s = (x as Extract<SceneNode, { stroke: unknown }>).stroke;
            const next = k === 'stroke' ? { ...s, paint: colour(v, 'stroke'), width: s.width || 1 } : { ...s, width: finite(v, 'strokeWidth', 0, 10000) };
            return { ...x, stroke: next } as SceneNode;
          });
          break;
        }
        case 'text': case 'fontSize': case 'fontFamily': case 'fontWeight': {
          const val = k === 'text' ? this.str(v, 'text') : k === 'fontFamily' ? this.str(v, 'fontFamily').slice(0, 300) : finite(v, k, k === 'fontWeight' ? 100 : 0.5, k === 'fontWeight' ? 900 : 5000);
          if (n.type === 'text') {
            up((x) => (k === 'text' ? { ...x, text: val as string } : { ...x, style: { ...(x as typeof n).style, [k]: val } }) as SceneNode);
          } else if (n.type === 'textframe') {
            const s = doc.stories[n.storyId];
            if (s) doc = { ...doc, stories: { ...doc.stories, [s.id]: k === 'text' ? { ...s, text: val as string } : { ...s, style: { ...s.style, [k]: val } } } };
          } else throw new ScriptError(`${k} applies to text`);
          break;
        }
        default:
          throw new ScriptError(`Unknown property "${k}"`);
      }
    }
    this.doc = doc;
  }

  private bump(n = 1) {
    this.created += n;
    if (this.created > this.limits.maxCreated) throw new ScriptError(`A script may create at most ${this.limits.maxCreated} objects`);
  }

  private create(pageIndex: unknown, kind: unknown, props: Record<string, unknown> = {}): Id {
    const page = this.page(pageIndex);
    const W = this.doc.settings.width, H = this.doc.settings.height;
    const { x = W / 2, y = H / 2 } = props as { x?: number; y?: number };
    const at = { x: finite(x, 'x'), y: finite(y, 'y') };
    let node: SceneNode;
    const rest = { ...props };
    delete rest.x; delete rest.y; delete rest.d; delete rest.text;
    switch (kind) {
      case 'rect': node = make.rect(at); break;
      case 'ellipse': node = make.ellipse(at); break;
      case 'polygon': node = make.polygon({ ...at, sides: Math.round(finite(props.sides ?? 6, 'sides', 3, 100)) }); delete rest.sides; break;
      case 'star': node = make.star({ ...at, points: Math.round(finite(props.points ?? 5, 'points', 3, 100)) }); delete rest.points; break;
      case 'text': node = make.text({ ...at, text: this.str(props.text ?? 'Text', 'text') }); break;
      case 'path': {
        let d;
        try { d = parsePath(this.str(props.d ?? '', 'd')); } catch { throw new ScriptError('d must be SVG path data, e.g. "M0 0 L100 0 L50 80 Z"'); }
        if (!d.length) throw new ScriptError('d must be SVG path data, e.g. "M0 0 L100 0 L50 80 Z"');
        const c = centrePath(d);
        node = make.path({ d: c.d, x: c.cx + (props.x === undefined ? 0 : at.x), y: c.cy + (props.y === undefined ? 0 : at.y), closed: d.some((q) => q[0] === 'Z'), fill: solid('#3d6fb6') });
        break;
      }
      case 'textframe': {
        const story = createStory(this.str(props.text ?? '', 'text'), {});
        node = make.textframe({ ...at, storyId: story.id });
        story.chain = [node.id];
        this.doc = { ...this.doc, stories: { ...this.doc.stories, [story.id]: { ...story, style: defaultTextStyle({ fontSize: 16 }) } } };
        break;
      }
      default:
        throw new ScriptError(`Cannot create "${String(kind)}"; use rect, ellipse, polygon, star, text, textframe or path`);
    }
    this.bump();
    this.doc = addNodes(this.doc, page.id, [node]);
    if (Object.keys(rest).length) this.patch(node, rest);
    return node.id;
  }

  private find(q: Record<string, unknown> = {}): Id[] {
    const out: Id[] = [];
    const pages = q.page === undefined ? this.doc.pages : [this.page(q.page)];
    for (const p of pages) {
      walk(p.nodes, (n) => {
        if (q.type && n.type !== q.type) return;
        if (typeof q.name === 'string' && !n.name.toLowerCase().includes(q.name.toLowerCase())) return;
        if (typeof q.text === 'string') {
          const t = n.type === 'text' ? n.text : n.type === 'textframe' ? this.doc.stories[n.storyId]?.text ?? '' : null;
          if (t === null || !t.toLowerCase().includes(q.text.toLowerCase())) return;
        }
        out.push(n.id);
      });
    }
    return out;
  }

  /** Dispatch one call from the sandbox. */
  call(op: string, args: unknown[]): unknown {
    const a = args;
    switch (op) {
      case 'doc.info': {
        const s = this.doc.settings;
        return { title: this.doc.title, width: s.width, height: s.height, unit: s.unit, dpi: s.dpi, studio: this.doc.studio, pageCount: this.doc.pages.length, background: s.background };
      }
      case 'doc.setTitle': this.doc = { ...this.doc, title: this.str(a[0], 'title').slice(0, 200) || 'Untitled' }; return null;
      case 'doc.setBackground': this.doc = { ...this.doc, settings: { ...this.doc.settings, background: a[0] === null ? null : paintHex(colour(a[0], 'background')) } }; return null;
      case 'pages.list': return this.doc.pages.map((p, i) => ({ index: i, id: p.id, name: p.name }));
      case 'pages.add': {
        const p = createPage(typeof a[0] === 'string' ? a[0].slice(0, 100) : `Page ${this.doc.pages.length + 1}`);
        this.doc = { ...this.doc, pages: [...this.doc.pages, p] };
        return this.doc.pages.length - 1;
      }
      case 'page.nodes': return this.page(a[0]).nodes.map((n) => n.id);
      case 'page.rename': {
        const p = this.page(a[0]);
        this.doc = { ...this.doc, pages: this.doc.pages.map((x) => (x.id === p.id ? { ...x, name: this.str(a[1], 'name').slice(0, 100) } : x)) };
        return null;
      }
      case 'node.get': return this.info(this.node(a[0]));
      case 'node.set': this.patch(this.node(a[0]), (a[1] ?? {}) as Record<string, unknown>); return null;
      case 'node.remove': this.node(a[0]); this.doc = removeNodes(this.doc, [a[0] as Id]); this.selection = this.selection.filter((s) => s !== a[0]); return null;
      case 'node.duplicate': {
        this.node(a[0]);
        this.bump();
        const r = duplicateNodes(this.doc, [a[0] as Id], typeof a[1] === 'number' ? a[1] : 0);
        this.doc = r.doc;
        return r.ids[0] ?? null;
      }
      case 'create': return this.create(a[0], a[1], (a[2] ?? {}) as Record<string, unknown>);
      case 'group': {
        const ids = (Array.isArray(a[0]) ? a[0] : []).filter((id): id is Id => typeof id === 'string' && !!findNode(this.doc, id));
        if (!ids.length) throw new ScriptError('group() needs objects on the same page');
        const r = groupNodes(this.doc, ids);
        this.doc = r.doc;
        return r.groupId;
      }
      case 'ungroup': {
        if (this.node(a[0]).type !== 'group') throw new ScriptError('Only groups can be ungrouped');
        const r = ungroup(this.doc, a[0] as Id);
        this.doc = r.doc;
        return r.ids;
      }
      case 'find': return this.find((a[0] ?? {}) as Record<string, unknown>);
      case 'selection.get': return this.selection.filter((id) => !!findNode(this.doc, id));
      case 'selection.set': this.selection = (Array.isArray(a[0]) ? a[0] : []).filter((id): id is Id => typeof id === 'string' && !!findNode(this.doc, id)); return null;
      case 'swatches.list': return this.doc.swatches.map((s) => ({ name: s.name, color: s.color }));
      case 'swatches.add': {
        const p = colour(a[1], 'swatch colour');
        if (p.type !== 'solid') throw new ScriptError('A swatch needs a colour');
        this.doc = { ...this.doc, swatches: [...this.doc.swatches, { id: `sw${Date.now().toString(36)}${this.doc.swatches.length}`, name: this.str(a[0], 'name').slice(0, 100), color: p.color }] };
        return null;
      }
      case 'log': this.logs.push(String(a[0]).slice(0, 2000)); if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000); return null;
      default: throw new ScriptError(`Unknown operation ${op}`);
    }
  }
}
