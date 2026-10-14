/** SVG import → editable vector nodes (paths, text) using paper.js's SVG parser. */
import { getPaper } from '../../core/paperScope';
import { make, makeStroke, solid, NO_PAINT } from '../../core/document';
import { centrePath, parsePath } from '../../core/path';
import type { Paint, SceneNode } from '../../core/types';

const getScope = getPaper;

function colorToPaint(c: paper.Color | null | undefined): Paint {
  if (!c) return NO_PAINT;
  if (c.gradient) {
    const stops = c.gradient.stops.map((s: paper.GradientStop) => ({ offset: s.offset ?? 0, color: s.color.toCSS(true) }));
    if (c.gradient.radial) return { type: 'radial', stops };
    const g = c as unknown as { origin?: paper.Point; destination?: paper.Point };
    const o = g.origin;
    const d = g.destination;
    const angle = o && d ? (Math.atan2(d.y - o.y, d.x - o.x) * 180) / Math.PI : 0;
    return { type: 'linear', stops, angle };
  }
  if (c.alpha === 0) return NO_PAINT;
  return solid(c.alpha < 1 ? c.toCSS(false) : c.toCSS(true));
}

export interface SvgImportResult {
  nodes: SceneNode[];
  width: number;
  height: number;
}

export function importSvg(svgText: string): SvgImportResult {
  const s = getScope();
  const item = s.project.importSVG(svgText, { expandShapes: true, insert: false, applyMatrix: true }) as paper.Item;
  if (!item) throw new Error('Could not read SVG');
  const nodes: SceneNode[] = [];
  const visit = (it: paper.Item, inheritedOpacity: number) => {
    if (!it.visible) return;
    const op = inheritedOpacity * (it.opacity ?? 1);
    if (it instanceof s.Path || it instanceof s.CompoundPath) {
      const clone = it.clone({ insert: false }) as paper.PathItem;
      clone.matrix = new s.Matrix();
      clone.transform(it.globalMatrix);
      const data = clone.pathData;
      if (!data) return;
      const d = parsePath(data);
      if (!d.length) return;
      const c = centrePath(d);
      const fill = it.clipMask ? NO_PAINT : colorToPaint(it.fillColor);
      const strokePaint = colorToPaint(it.strokeColor);
      const strokeWidth = it.strokeColor ? (it.strokeWidth ?? 1) * Math.sqrt(Math.abs(it.globalMatrix.a * it.globalMatrix.d - it.globalMatrix.b * it.globalMatrix.c)) : 0;
      nodes.push(make.path({
        name: it.name || 'Path',
        x: c.cx, y: c.cy, d: c.d,
        closed: d.some((cmd) => cmd[0] === 'Z'),
        fill,
        stroke: strokePaint.type === 'none' ? makeStroke() : { ...makeStroke(), paint: strokePaint, width: strokeWidth, cap: (it.strokeCap as 'butt') ?? 'butt', join: (it.strokeJoin as 'miter') ?? 'miter', dash: it.dashArray ?? [] },
        opacity: op,
      }));
    } else if (it instanceof s.PointText) {
      const b = it.bounds;
      const fs = (it.fontSize as number) * Math.abs(it.globalMatrix.scaling.y || 1);
      nodes.push(make.text({
        name: 'Text',
        text: it.content,
        x: b.center.x, y: b.center.y,
        style: { ...make.text().style, fontFamily: String(it.fontFamily || 'Inter'), fontSize: fs || 16, fontWeight: Number(it.fontWeight) || 400, fill: colorToPaint(it.fillColor) },
        opacity: op,
      }));
    } else if (it.children) {
      for (const ch of [...it.children]) visit(ch, op);
    }
  };
  visit(item, 1);
  const b = item.bounds;
  return { nodes, width: b.width, height: b.height };
}
