/**
 * Document → SVG exporter. Pure and deterministic so it is fully testable.
 * Vectors and text stay vectors; pixel layers and placed images embed as data URIs.
 */
import { nodeToPath } from './document';
import { pathToString } from './path';
import { gradientGeometry, linearDefault, type Box } from './gradient';
import { expandNode, isNonZeroFill, shapeBox } from './vectorExpand';
import { textPathCommands } from './textPath';
import { flowStory, lineHeightPx, monoMeasure, type MeasureFn } from './textflow';
import type { QuvreloDocument, Id, Page, Paint, SceneNode, Stroke, TextStyle } from './types';

export interface SvgExportOptions {
  measure?: MeasureFn;
  /** data: URI (or other href) for an asset id; for rasters this should include adjustments */
  assetHref?: (assetId: Id, node?: SceneNode) => string | null;
  includeBleed?: boolean;
  /** pretty-print with newlines */
  pretty?: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Baseline offset from the top of a line box (shared by canvas, SVG and PDF renderers). */
export function baselineOffset(style: TextStyle): number {
  const lh = lineHeightPx(style);
  return (lh - style.fontSize) / 2 + style.fontSize * 0.8;
}

class Ctx {
  defs: string[] = [];
  private n = 0;
  constructor(public opts: SvgExportOptions, public doc: QuvreloDocument) {}
  id(prefix: string) {
    this.n++;
    return `${prefix}${this.n}`;
  }
}

const UNIT_BOX: Box = { x: 0, y: 0, w: 1, h: 1 };

function stopsSvg(stops: { offset: number; color: string }[]): string {
  return [...stops].sort((a, b) => a.offset - b.offset).map((s) => {
    const m = /^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(s.color.replace(/\s+/g, ''));
    if (m) return `<stop offset="${num(Math.min(1, Math.max(0, s.offset)))}" stop-color="rgb(${m[1]},${m[2]},${m[3]})" stop-opacity="${num(parseFloat(m[4]))}"/>`;
    return `<stop offset="${num(Math.min(1, Math.max(0, s.offset)))}" stop-color="${esc(s.color)}"/>`;
  }).join('');
}

/**
 * Paint as an SVG attribute. Gradients are written in user space from the
 * painted object's box, using the same geometry as the canvas and PDF.
 * Conical fills and strokes of shapes are expanded into clipped wedges before
 * this (core/vectorExpand); a conical paint still reaching here (text) has no
 * SVG equivalent and is written as a linear gradient at its angle.
 */
function paintAttr(ctx: Ctx, p: Paint, attr: 'fill' | 'stroke', box: Box = UNIT_BOX): string {
  switch (p.type) {
    case 'none':
      return `${attr}="none"`;
    case 'solid': {
      const m = /^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(p.color.replace(/\s+/g, ''));
      if (m) return `${attr}="rgb(${m[1]},${m[2]},${m[3]})" ${attr}-opacity="${num(parseFloat(m[4]))}"`;
      return `${attr}="${esc(p.color)}"`;
    }
    case 'linear':
    case 'conical': {
      const id = ctx.id('lg');
      const lp = p.type === 'linear' ? p : { type: 'linear' as const, stops: p.stops, angle: p.angle, ...linearDefault(p.angle) };
      const g = gradientGeometry(lp, box) as Extract<ReturnType<typeof gradientGeometry>, { type: 'linear' }>;
      ctx.defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(g.x1)}" y1="${num(g.y1)}" x2="${num(g.x2)}" y2="${num(g.y2)}">` +
          stopsSvg(p.stops) + `</linearGradient>`,
      );
      return `${attr}="url(#${id})"`;
    }
    case 'radial': {
      const id = ctx.id('rg');
      const g = gradientGeometry(p, box) as Extract<ReturnType<typeof gradientGeometry>, { type: 'radial' }>;
      const focal = g.fx !== g.cx || g.fy !== g.cy ? ` fx="${num(g.fx)}" fy="${num(g.fy)}"` : '';
      ctx.defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(g.cx)}" cy="${num(g.cy)}" r="${num(g.r)}"${focal}>` +
          stopsSvg(p.stops) + `</radialGradient>`,
      );
      return `${attr}="url(#${id})"`;
    }
  }
}

function strokeAttrs(ctx: Ctx, s: Stroke, box: Box = UNIT_BOX): string {
  if (s.paint.type === 'none' || s.width <= 0) return 'stroke="none"';
  const parts = [paintAttr(ctx, s.paint, 'stroke', box), `stroke-width="${num(s.width)}"`];
  if (s.dash.length) parts.push(`stroke-dasharray="${s.dash.map(num).join(' ')}"`);
  if (s.dash.length && s.dashOffset) parts.push(`stroke-dashoffset="${num(s.dashOffset)}"`);
  if (s.cap !== 'butt') parts.push(`stroke-linecap="${s.cap}"`);
  if (s.join !== 'miter') parts.push(`stroke-linejoin="${s.join}"`);
  if (s.join === 'miter' && s.miter !== undefined && s.miter !== 4) parts.push(`stroke-miterlimit="${num(s.miter)}"`);
  return parts.join(' ');
}

function transformAttr(n: SceneNode): string {
  const parts = [`translate(${num(n.x)} ${num(n.y)})`];
  if (n.rotation) parts.push(`rotate(${num(n.rotation)})`);
  const sx = n.scaleX * (n.flipX ? -1 : 1);
  const sy = n.scaleY * (n.flipY ? -1 : 1);
  if (sx !== 1 || sy !== 1) parts.push(`scale(${num(sx)} ${num(sy)})`);
  if (n.skewX) parts.push(`skewX(${num(n.skewX)})`);
  return parts.join(' ');
}

function textStyleAttrs(style: TextStyle): string {
  const attrs = [
    `font-family="${esc(style.fontFamily)}"`,
    `font-size="${num(style.fontSize)}"`,
  ];
  if (style.fontWeight !== 400) attrs.push(`font-weight="${style.fontWeight}"`);
  if (style.italic) attrs.push('font-style="italic"');
  if (style.underline) attrs.push('text-decoration="underline"');
  if (style.letterSpacing) attrs.push(`letter-spacing="${num((style.letterSpacing / 1000) * style.fontSize)}"`);
  if (style.kerning === false) attrs.push('font-kerning="none"');
  if (style.caps && style.caps !== 'normal') attrs.push(`font-variant="${style.caps}"`);
  return attrs.join(' ');
}

function nodeToSvg(ctx: Ctx, node: SceneNode): string {
  if (!node.visible) return '';
  const n = expandNode(node, { conicalWedges: true });
  const common: string[] = [`transform="${transformAttr(n)}"`];
  if (n.opacity < 1) common.push(`opacity="${num(n.opacity)}"`);
  if (n.blend !== 'normal') common.push(`style="mix-blend-mode:${n.blend}"`);
  if (n.mask?.enabled && n.mask.d.length) {
    const id = ctx.id('clip');
    if (n.mask.inverted) {
      ctx.defs.push(
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">` +
          `<rect x="-100000" y="-100000" width="200000" height="200000" fill="#fff"/>` +
          `<path d="${pathToString(n.mask.d)}" fill="#000"/></mask>`,
      );
      common.push(`mask="url(#${id})"`);
    } else {
      ctx.defs.push(`<clipPath id="${id}"><path d="${pathToString(n.mask.d)}"/></clipPath>`);
      common.push(`clip-path="url(#${id})"`);
    }
  }
  const label = `data-name="${esc(node.name)}"${node.type === 'group' && node.artboard ? ' data-artboard="true"' : ''}${node.type === 'group' && node.symbolId ? ` data-symbol="${esc(node.symbolId)}"` : ''}`;
  const open = `<g id="${esc(n.id)}" ${label} ${common.join(' ')}>`;
  let body = '';
  switch (n.type) {
    case 'rect':
      body = `<rect x="${num(-n.w / 2)}" y="${num(-n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}"${
        n.radius ? ` rx="${num(Math.min(n.radius, n.w / 2, n.h / 2))}"` : ''
      } ${paintAttr(ctx, n.fill, 'fill', shapeBox(n))} ${strokeAttrs(ctx, n.stroke, shapeBox(n))}/>`;
      break;
    case 'ellipse':
      body = `<ellipse cx="0" cy="0" rx="${num(n.w / 2)}" ry="${num(n.h / 2)}" ${paintAttr(ctx, n.fill, 'fill', shapeBox(n))} ${strokeAttrs(ctx, n.stroke, shapeBox(n))}/>`;
      break;
    case 'polygon':
    case 'star':
    case 'path': {
      const d = nodeToPath(n) ?? [];
      const box = shapeBox(n, d);
      const open = n.type === 'path' && !n.closed && n.fill.type === 'none';
      body = `<path d="${pathToString(d)}" ${open ? 'fill="none"' : paintAttr(ctx, n.fill, 'fill', box)} ${strokeAttrs(ctx, n.stroke, box)} fill-rule="${isNonZeroFill(n) ? 'nonzero' : 'evenodd'}"/>`;
      break;
    }
    case 'text': {
      const s = n.style;
      if (n.onPath) {
        const pid = ctx.id('tp');
        const pd = textPathCommands(n.onPath.d, n.onPath.flip);
        ctx.defs.push(`<path id="${pid}" d="${pathToString(pd)}"/>`);
        const shown = n.onPath.showPath && n.stroke.width > 0 && n.stroke.paint.type !== 'none'
          ? `<path d="${pathToString(n.onPath.d)}" fill="none" ${strokeAttrs(ctx, n.stroke)}/>`
          : '';
        body = shown +
          `<text ${textStyleAttrs(s)} ${paintAttr(ctx, s.fill, 'fill')}${n.onPath.showPath ? '' : ' ' + strokeAttrs(ctx, n.stroke)} xml:space="preserve">` +
          `<textPath href="#${pid}" xlink:href="#${pid}" startOffset="${num(Math.min(1, Math.max(0, n.onPath.start)) * 100)}%">${esc(n.text.replace(/\n/g, ' '))}</textPath></text>`;
        break;
      }
      const lines = n.text.split('\n');
      const lh = lineHeightPx(s);
      const measure = ctx.opts.measure ?? monoMeasure();
      const widths = lines.map((l) => measure(l, s));
      const w = Math.max(1, ...widths);
      const h = lines.length * lh;
      const anchor = s.align === 'center' ? 'middle' : s.align === 'right' ? 'end' : 'start';
      const x = s.align === 'center' ? 0 : s.align === 'right' ? w / 2 : -w / 2;
      const base = -h / 2 + baselineOffset(s);
      body =
        `<text ${textStyleAttrs(s)} text-anchor="${anchor}" ${paintAttr(ctx, s.fill, 'fill')} ${strokeAttrs(ctx, n.stroke)} xml:space="preserve">` +
        lines.map((l, i) => `<tspan x="${num(x)}" y="${num(base + i * lh)}">${esc(l)}</tspan>`).join('') +
        `</text>`;
      break;
    }
    case 'textframe': {
      const story = ctx.doc.stories[n.storyId];
      const bg = `<rect x="${num(-n.w / 2)}" y="${num(-n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}" ${paintAttr(ctx, n.fill, 'fill')} ${strokeAttrs(ctx, n.stroke)}/>`;
      if (!story) {
        body = bg;
        break;
      }
      const frames = story.chain
        .map((fid) => findFrame(ctx.doc, fid))
        .filter((f): f is Extract<SceneNode, { type: 'textframe' }> => !!f);
      const flow = flowStory(story.text, story.style, frames, ctx.opts.measure ?? monoMeasure());
      const layout = flow.frames[n.id];
      const s = story.style;
      const ox = -n.w / 2;
      const oy = -n.h / 2 + baselineOffset(s);
      const tspans = (layout?.lines ?? [])
        .map((l) => `<tspan x="${num(ox + l.x)}" y="${num(oy + l.y)}"${l.wordSpacing ? ` word-spacing="${num(l.wordSpacing)}"` : ''}>${esc(l.text)}</tspan>`)
        .join('');
      body = bg + `<text ${textStyleAttrs(s)} ${paintAttr(ctx, s.fill, 'fill')} xml:space="preserve">${tspans}</text>`;
      break;
    }
    case 'imageframe': {
      const clip = ctx.id('fr');
      ctx.defs.push(`<clipPath id="${clip}"><rect x="${num(-n.w / 2)}" y="${num(-n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}"/></clipPath>`);
      const bg = `<rect x="${num(-n.w / 2)}" y="${num(-n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}" ${paintAttr(ctx, n.fill, 'fill')}/>`;
      let img = '';
      const meta = n.assetId ? ctx.doc.assets[n.assetId] : null;
      const href = n.assetId ? ctx.opts.assetHref?.(n.assetId, n) : null;
      if (meta && href) {
        const r = imageFrameContentRect(n, meta.width, meta.height);
        img = `<image href="${esc(href)}" x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" preserveAspectRatio="none"/>`;
      }
      const border = n.stroke.width > 0 && n.stroke.paint.type !== 'none'
        ? `<rect x="${num(-n.w / 2)}" y="${num(-n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}" fill="none" ${strokeAttrs(ctx, n.stroke)}/>`
        : '';
      body = `<g clip-path="url(#${clip})">${bg}${img}</g>${border}`;
      break;
    }
    case 'raster': {
      const href = ctx.opts.assetHref?.(n.assetId, n);
      if (href) body = `<image href="${esc(href)}" x="${num(-n.w / 2)}" y="${num(-n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}" preserveAspectRatio="none"/>`;
      break;
    }
    case 'group':
      body = n.children.map((c) => nodeToSvg(ctx, c)).join('');
      break;
  }
  return `${open}${body}</g>`;
}

function findFrame(doc: QuvreloDocument, id: Id): Extract<SceneNode, { type: 'textframe' }> | null {
  const visit = (nodes: SceneNode[]): Extract<SceneNode, { type: 'textframe' }> | null => {
    for (const n of nodes) {
      if (n.id === id && n.type === 'textframe') return n;
      if (n.type === 'group') {
        const f = visit(n.children);
        if (f) return f;
      }
    }
    return null;
  };
  for (const p of doc.pages) {
    const f = visit(p.nodes);
    if (f) return f;
  }
  for (const m of doc.masters) {
    const f = visit(m.nodes);
    if (f) return f;
  }
  return null;
}

/** Placement of an image inside a picture frame, in frame-local coordinates. */
export function imageFrameContentRect(
  n: Pick<Extract<SceneNode, { type: 'imageframe' }>, 'w' | 'h' | 'fit' | 'contentX' | 'contentY' | 'contentScale'>,
  iw: number, ih: number,
): { x: number; y: number; w: number; h: number } {
  let w = iw;
  let h = ih;
  if (n.fit === 'stretch') {
    w = n.w;
    h = n.h;
  } else if (n.fit === 'fill' || n.fit === 'fit') {
    const s = n.fit === 'fill' ? Math.max(n.w / iw, n.h / ih) : Math.min(n.w / iw, n.h / ih);
    w = iw * s;
    h = ih * s;
  }
  w *= n.contentScale;
  h *= n.contentScale;
  return { x: -w / 2 + n.contentX, y: -h / 2 + n.contentY, w, h };
}

export function pageToSvg(doc: QuvreloDocument, page: Page, opts: SvgExportOptions = {}): string {
  const ctx = new Ctx(opts, doc);
  const { width, height, background, bleed } = doc.settings;
  const b = opts.includeBleed ? bleed : 0;
  const master = page.masterId ? doc.masters.find((m) => m.id === page.masterId) : null;
  const content = [
    background ? `<rect x="${num(-b)}" y="${num(-b)}" width="${num(width + 2 * b)}" height="${num(height + 2 * b)}" fill="${esc(background)}"/>` : '',
    ...(master ? master.nodes.map((n) => nodeToSvg(ctx, n)) : []),
    ...page.nodes.map((n) => nodeToSvg(ctx, n)),
  ].join(opts.pretty ? '\n' : '');
  const defs = ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ` +
    `width="${num(width + 2 * b)}" height="${num(height + 2 * b)}" viewBox="${num(-b)} ${num(-b)} ${num(width + 2 * b)} ${num(height + 2 * b)}">` +
    `<title>${esc(doc.title)} — ${esc(page.name)}</title>${defs}${content}</svg>`
  );
}
