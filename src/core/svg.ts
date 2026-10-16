/**
 * Document → SVG exporter. Pure and deterministic so it is fully testable.
 * Vectors and text stay vectors; pixel layers and placed images embed as data URIs.
 */
import { nodeToPath } from './document';
import { pathToString } from './path';
import { drawnStyle, flowRichStory, lineHeightPx, monoMeasure, type LaidOutLine, type MeasureFn } from './textflow';
import { sheetOf } from './typography';
import { featureSettings } from './otFeatures';
import { fieldContext, masterItemsFor } from './layout';
import { isCovered, layoutCell } from './tables';
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
  /** page being exported (page-number fields) */
  pageIndex = -1;
  constructor(public opts: SvgExportOptions, public doc: QuvreloDocument) {}
  id(prefix: string) {
    this.n++;
    return `${prefix}${this.n}`;
  }
}

function paintAttr(ctx: Ctx, p: Paint, attr: 'fill' | 'stroke'): string {
  switch (p.type) {
    case 'none':
      return `${attr}="none"`;
    case 'solid':
      return `${attr}="${esc(p.color)}"`;
    case 'linear': {
      const id = ctx.id('lg');
      const a = (p.angle * Math.PI) / 180;
      const x1 = 0.5 - Math.cos(a) / 2;
      const y1 = 0.5 - Math.sin(a) / 2;
      const x2 = 0.5 + Math.cos(a) / 2;
      const y2 = 0.5 + Math.sin(a) / 2;
      ctx.defs.push(
        `<linearGradient id="${id}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}">` +
          p.stops.map((s) => `<stop offset="${num(s.offset)}" stop-color="${esc(s.color)}"/>`).join('') +
          `</linearGradient>`,
      );
      return `${attr}="url(#${id})"`;
    }
    case 'radial': {
      const id = ctx.id('rg');
      ctx.defs.push(
        `<radialGradient id="${id}">` +
          p.stops.map((s) => `<stop offset="${num(s.offset)}" stop-color="${esc(s.color)}"/>`).join('') +
          `</radialGradient>`,
      );
      return `${attr}="url(#${id})"`;
    }
  }
}

function strokeAttrs(ctx: Ctx, s: Stroke): string {
  if (s.paint.type === 'none' || s.width <= 0) return 'stroke="none"';
  const parts = [paintAttr(ctx, s.paint, 'stroke'), `stroke-width="${num(s.width)}"`];
  if (s.dash.length) parts.push(`stroke-dasharray="${s.dash.map(num).join(' ')}"`);
  if (s.cap !== 'butt') parts.push(`stroke-linecap="${s.cap}"`);
  if (s.join !== 'miter') parts.push(`stroke-linejoin="${s.join}"`);
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
  const deco = [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) attrs.push(`text-decoration="${deco}"`);
  if (style.letterSpacing) attrs.push(`letter-spacing="${num((style.letterSpacing / 1000) * style.fontSize)}"`);
  if (style.kerning === false) attrs.push('font-kerning="none"');
  if (style.caps && style.caps !== 'normal') attrs.push(`font-variant="${style.caps}"`);
  const fs = featureSettings(style);
  if (fs) attrs.push(`style="font-feature-settings: ${esc(fs)}"`);
  return attrs.join(' ');
}

/** Laid-out lines (styled runs) as <text> elements, origin = frame top-left at (ox, oy). */
function linesToSvg(ctx: Ctx, lines: LaidOutLine[], fallback: TextStyle, ox: number, oy: number): string {
  const out: string[] = [];
  for (const l of lines) {
    const base = l.baseline ?? l.y + baselineOffset(fallback);
    for (const r of l.runs ?? [{ text: l.text, x: l.x, width: l.width, style: fallback, start: l.start, end: l.end, wordSpacing: l.wordSpacing, rise: 0 }]) {
      if (!r.text) continue;
      const ds = drawnStyle(r.style);
      out.push(
        `<text ${textStyleAttrs(ds)} ${paintAttr(ctx, ds.fill, 'fill')} xml:space="preserve" x="${num(ox + r.x)}" y="${num(oy + base - r.rise)}"` +
          `${r.wordSpacing ? ` word-spacing="${num(r.wordSpacing)}"` : ''}>${esc(r.text)}</text>`,
      );
    }
  }
  return out.join('');
}

function nodeToSvg(ctx: Ctx, n: SceneNode): string {
  if (!n.visible) return '';
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
  const label = `data-name="${esc(n.name)}"`;
  const open = `<g id="${esc(n.id)}" ${label} ${common.join(' ')}>`;
  let body = '';
  switch (n.type) {
    case 'rect':
      body = `<rect x="${num(-n.w / 2)}" y="${num(-n.h / 2)}" width="${num(n.w)}" height="${num(n.h)}"${
        n.radius ? ` rx="${num(Math.min(n.radius, n.w / 2, n.h / 2))}"` : ''
      } ${paintAttr(ctx, n.fill, 'fill')} ${strokeAttrs(ctx, n.stroke)}/>`;
      break;
    case 'ellipse':
      body = `<ellipse cx="0" cy="0" rx="${num(n.w / 2)}" ry="${num(n.h / 2)}" ${paintAttr(ctx, n.fill, 'fill')} ${strokeAttrs(ctx, n.stroke)}/>`;
      break;
    case 'polygon':
    case 'star':
    case 'path': {
      const d = nodeToPath(n) ?? [];
      body = `<path d="${pathToString(d)}" ${paintAttr(ctx, n.fill, 'fill')} ${strokeAttrs(ctx, n.stroke)} fill-rule="evenodd"/>`;
      break;
    }
    case 'text': {
      const s = n.style;
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
        .filter((f): f is Extract<SceneNode, { type: 'textframe' }> => !!f)
        .map((f) => ({ id: f.id, w: f.w, h: f.h, padding: f.padding, columns: f.columns, columnGap: f.columnGap, fields: ctx.pageIndex >= 0 ? fieldContext(ctx.doc, ctx.pageIndex) : null }));
      const g = ctx.doc.settings.baselineGrid;
      const flow = flowRichStory(story, sheetOf(ctx.doc), frames, ctx.opts.measure ?? monoMeasure(), { grid: g?.enabled ? g : null });
      const layout = flow.frames[n.id];
      body = bg + linesToSvg(ctx, layout?.lines ?? [], story.style, -n.w / 2, -n.h / 2);
      break;
    }
    case 'table': {
      const sheet = sheetOf(ctx.doc);
      const parts: string[] = [];
      const borders: string[] = [];
      for (let r = 0; r < n.rowHeights.length; r++) for (let c = 0; c < n.colWidths.length; c++) {
        if (isCovered(n, r, c)) continue;
        const cl = layoutCell(n, sheet, r, c, ctx.opts.measure ?? monoMeasure());
        const x = -n.w / 2 + cl.rect.x;
        const y = -n.h / 2 + cl.rect.y;
        const rect = `x="${num(x)}" y="${num(y)}" width="${num(cl.rect.w)}" height="${num(cl.rect.h)}"`;
        if (cl.props.fill.type !== 'none') parts.push(`<rect ${rect} ${paintAttr(ctx, cl.props.fill, 'fill')}/>`);
        parts.push(linesToSvg(ctx, cl.flow.frames.cell?.lines ?? [], cl.style, x, y));
        if (cl.props.strokeWidth > 0 && cl.props.stroke.type !== 'none') borders.push(`<rect ${rect} fill="none" ${paintAttr(ctx, cl.props.stroke, 'stroke')} stroke-width="${num(cl.props.strokeWidth)}"/>`);
      }
      body = parts.join('') + borders.join('');
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
  ctx.pageIndex = doc.pages.indexOf(page);
  const content = [
    background ? `<rect x="${num(-b)}" y="${num(-b)}" width="${num(width + 2 * b)}" height="${num(height + 2 * b)}" fill="${esc(background)}"/>` : '',
    ...masterItemsFor(doc, page).map((n) => nodeToSvg(ctx, n)),
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
