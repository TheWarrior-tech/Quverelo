/**
 * SVG import → editable Quvrelo nodes, using paper.js's SVG parser (offline).
 *
 * Keeps the file's structure: groups stay groups (with their opacity and
 * names), clip groups become masks, paths keep their stroke (width, caps,
 * joins, mitre, dashes), linear / radial gradients keep their geometry,
 * text stays editable text, and embedded (data: URI) images come in as pixel
 * layers. External image links are skipped: Quvrelo never fetches from the
 * network.
 */
import { getPaper } from '../../core/paperScope';
import { make, makeStroke, solid, NO_PAINT } from '../../core/document';
import { centrePath, parsePath, transformPath } from '../../core/path';
import { newId } from '../../core/ids';
import type { GroupNode, Paint, SceneNode, Stroke, UnitPoint } from '../../core/types';

const getScope = getPaper;

/** Unit-box point of an absolute point in a bounds rectangle. */
type BoxLike = { x: number; y: number; width: number; height: number };

/** Control-point box of path commands (the box Quvrelo's gradients are relative to). */
function ctrlBox(d: ReturnType<typeof parsePath>): BoxLike {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of d) for (let i = 1; i < c.length; i += 2) {
    x0 = Math.min(x0, c[i] as number); x1 = Math.max(x1, c[i] as number);
    y0 = Math.min(y0, c[i + 1] as number); y1 = Math.max(y1, c[i + 1] as number);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: 0, height: 0 };
}

function unitIn(b: BoxLike, p: paper.Point): UnitPoint {
  return { x: b.width ? (p.x - b.x) / b.width : 0.5, y: b.height ? (p.y - b.y) / b.height : 0.5 };
}

function colorToPaint(c: paper.Color | null | undefined, bounds?: BoxLike): Paint {
  if (!c) return NO_PAINT;
  if (c.gradient) {
    const stops = c.gradient.stops.map((s: paper.GradientStop) => ({ offset: s.offset ?? 0, color: s.color.toCSS(s.color.alpha >= 1) }));
    const g = c as unknown as { origin?: paper.Point; destination?: paper.Point; highlight?: paper.Point };
    const o = g.origin;
    const d = g.destination;
    if (c.gradient.radial) {
      if (o && d && bounds) {
        return { type: 'radial', stops, center: unitIn(bounds, o), edge: unitIn(bounds, d), ...(g.highlight ? { focal: unitIn(bounds, g.highlight) } : {}) };
      }
      return { type: 'radial', stops };
    }
    const angle = o && d ? (Math.atan2(d.y - o.y, d.x - o.x) * 180) / Math.PI : 0;
    if (o && d && bounds) return { type: 'linear', stops, angle, from: unitIn(bounds, o), to: unitIn(bounds, d) };
    return { type: 'linear', stops, angle };
  }
  if (c.alpha === 0) return NO_PAINT;
  return solid(c.alpha < 1 ? c.toCSS(false) : c.toCSS(true));
}

export interface SvgImportImage {
  id: string;
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  name: string;
}

export interface SvgImportResult {
  nodes: SceneNode[];
  width: number;
  height: number;
  /** embedded images: add to the asset store under these ids before committing the nodes */
  images: SvgImportImage[];
}

function dataUriBytes(src: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src.trim());
  if (!m) return null;
  const mime = m[1];
  if (!/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(mime)) return null;
  try {
    if (m[2]) {
      const bin = atob(m[3].replace(/\s+/g, ''));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return { bytes: out, mime: mime.replace('jpg', 'jpeg') };
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), mime };
  } catch {
    return null;
  }
}

/** World-space path data of a path item (with every ancestor transform applied). */
function worldPathData(s: ReturnType<typeof getScope>, it: paper.PathItem): string | null {
  const clone = it.clone({ insert: false }) as paper.PathItem;
  clone.matrix = new s.Matrix();
  clone.transform(it.globalMatrix);
  return clone.pathData || null;
}

function strokeOf(it: paper.Item, box?: BoxLike): Stroke {
  const paint = colorToPaint(it.strokeColor, box ?? it.bounds);
  if (paint.type === 'none' || !it.strokeColor) return makeStroke();
  const m = it.globalMatrix;
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  return {
    ...makeStroke(),
    paint,
    width: (it.strokeWidth ?? 1) * k,
    cap: (it.strokeCap as Stroke['cap']) ?? 'butt',
    join: (it.strokeJoin as Stroke['join']) ?? 'miter',
    miter: it.miterLimit ?? 4,
    dash: (it.dashArray ?? []).map((v: number) => v * k),
    ...(it.dashOffset ? { dashOffset: it.dashOffset * k } : {}),
  };
}

export function importSvg(svgText: string): SvgImportResult {
  const s = getScope();
  const item = s.project.importSVG(svgText, { expandShapes: true, insert: false, applyMatrix: true }) as paper.Item;
  if (!item) throw new Error('Could not read SVG');
  const images: SvgImportImage[] = [];

  /** Convert one item to a node in world coordinates (groups get their own centre). */
  const convert = (it: paper.Item): SceneNode | null => {
    if (!it.visible) return null;
    const opacity = it.opacity ?? 1;
    const name = it.name || '';
    if (it instanceof s.Path || it instanceof s.CompoundPath) {
      if (it.clipMask) return null;
      const data = worldPathData(s, it);
      if (!data) return null;
      const d = parsePath(data);
      if (!d.length) return null;
      const c = centrePath(d);
      // gradient geometry is relative to the shape's control-point box (paper gives it in world space too)
      const b = ctrlBox(d);
      const fill = colorToPaint(it.fillColor, b);
      return make.path({
        name: name || 'Path',
        x: c.cx, y: c.cy, d: c.d,
        closed: d.some((cmd) => cmd[0] === 'Z'),
        fill,
        stroke: strokeOf(it, b),
        opacity,
      });
    }
    if (it instanceof s.PointText) {
      const b = it.bounds;
      const fs = (it.fontSize as number) * Math.abs(it.globalMatrix.scaling.y || 1);
      const just = (it as unknown as { justification?: string }).justification;
      return make.text({
        name: name || 'Text',
        text: it.content,
        x: b.center.x, y: b.center.y,
        rotation: ((it.globalMatrix.rotation % 360) + 360) % 360,
        style: {
          ...make.text().style,
          fontFamily: String(it.fontFamily || 'Inter'),
          fontSize: fs || 16,
          fontWeight: Number(it.fontWeight) || (String(it.fontWeight) === 'bold' ? 700 : 400),
          align: just === 'center' ? 'center' : just === 'right' ? 'right' : 'left',
          fill: colorToPaint(it.fillColor, b),
        },
        stroke: strokeOf(it),
        opacity,
      });
    }
    if (it instanceof s.Raster) {
      const src = String((it as unknown as { source?: string }).source ?? '');
      const data = dataUriBytes(src);
      if (!data) return null; // linked images are never fetched
      const m = it.globalMatrix;
      const w = (it as unknown as { width: number }).width || it.bounds.width;
      const h = (it as unknown as { height: number }).height || it.bounds.height;
      const id = newId('a');
      images.push({ id, bytes: data.bytes, mime: data.mime, width: w, height: h, name: name || 'Image' });
      const c = it.bounds.center;
      return make.raster({
        name: name || 'Image', assetId: id, w, h, x: c.x, y: c.y,
        rotation: ((m.rotation % 360) + 360) % 360,
        scaleX: Math.abs(m.scaling.x) || 1, scaleY: Math.abs(m.scaling.y) || 1,
        opacity,
      });
    }
    if (it.children) {
      const kids = [...it.children];
      const clip = (it as paper.Group).clipped ? kids.find((k) => (k as paper.Path).clipMask) : null;
      const children = kids.map(convert).filter((n): n is SceneNode => !!n);
      if (!children.length) return null;
      // a lone child with no clip or opacity needs no group of its own
      if (children.length === 1 && !clip && opacity >= 1 && !name) return children[0];
      const xs = children.map((n) => n.x);
      const ys = children.map((n) => n.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const g: GroupNode = make.group(children.map((n) => ({ ...n, x: n.x - cx, y: n.y - cy })), { x: cx, y: cy, name: name || 'Group', opacity });
      if (clip) {
        const data = worldPathData(s, clip as paper.PathItem);
        if (data) g.mask = { d: transformPath(parsePath(data), [1, 0, 0, 1, -cx, -cy]), inverted: false, enabled: true };
      }
      return g;
    }
    return null;
  };

  const root = convert(item);
  const nodes = !root ? [] : root.type === 'group' && !root.mask && root.opacity >= 1
    ? root.children.map((n) => ({ ...n, x: n.x + root.x, y: n.y + root.y }))
    : [root];
  // the document size: the SVG's own width/height (viewBox), else the artwork's bounds
  const sizeMatch = /<svg\b[^>]*>/i.exec(svgText)?.[0] ?? '';
  const attr = (n: string) => {
    const m = new RegExp(`\\b${n}\\s*=\\s*["']([\\d.]+)(px)?["']`, 'i').exec(sizeMatch);
    return m ? parseFloat(m[1]) : NaN;
  };
  const vb = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(sizeMatch);
  const b = item.bounds;
  const width = attr('width') || (vb ? parseFloat(vb[1]) : NaN) || b.width;
  const height = attr('height') || (vb ? parseFloat(vb[2]) : NaN) || b.height;
  return { nodes, width, height, images };
}
