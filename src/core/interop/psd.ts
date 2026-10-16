/**
 * Photoshop (PSD/PSB) import and the model side of PSD export.
 *
 * Parsing and writing use ag-psd (MIT, bundled). This module maps the parsed
 * layer tree onto Quvrelo's document model:
 *  - pixel layers  -> raster nodes (pixels returned as RGBA, see ImportResult)
 *  - groups        -> group nodes (pass-through groups become normal groups)
 *  - text layers   -> editable artistic text (font, size, colour, alignment,
 *                     tracking, leading); the rendered pixels are not kept
 *  - shape layers  -> editable path nodes (vector mask + solid fill/stroke)
 *  - blend modes, opacity (x fill opacity), visibility, locks
 *  - vector masks  -> editable node masks
 *  - pixel masks   -> applied to the layer's alpha (the model has no pixel
 *                     masks yet), reported in the warnings
 */
import { initializeCanvas, readPsd, type BezierPath, type BlendMode as PsdBlend, type Color, type Layer, type Psd } from 'ag-psd';
import { createDocument, defaultTextStyle, make, makeStroke, NO_PAINT, solid } from '../document';
import { newId } from '../ids';
import { centrePath, pathBounds, translatePath } from '../path';
import type { Pixels } from '../pixels';
import type { BlendMode, Paint, PathCommand, SceneNode, Stroke, TextAlign } from '../types';
import { cmykToHex, grayHex, labToHex, rgbHex } from './color';
import { emptyResult, summariseWarnings, type ImportResult } from './types';

// ---------------------------------------------------------------------------
// Blend modes

const DIRECT: Partial<Record<PsdBlend, BlendMode>> = {
  normal: 'normal', 'pass through': 'normal', darken: 'darken', multiply: 'multiply', 'color burn': 'color-burn',
  lighten: 'lighten', screen: 'screen', 'color dodge': 'color-dodge', overlay: 'overlay', 'soft light': 'soft-light',
  'hard light': 'hard-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation',
  color: 'color', luminosity: 'luminosity',
};
/** Photoshop modes without an exact canvas equivalent and the closest one we use. */
const NEAREST: Partial<Record<PsdBlend, BlendMode>> = {
  dissolve: 'normal', 'linear burn': 'color-burn', 'darker color': 'darken', 'linear dodge': 'color-dodge',
  'lighter color': 'lighten', 'vivid light': 'hard-light', 'linear light': 'hard-light', 'pin light': 'hard-light',
  'hard mix': 'hard-light', subtract: 'difference', divide: 'color-dodge',
};

export function blendFromPsd(mode: PsdBlend | undefined): { blend: BlendMode; exact: boolean } {
  if (!mode) return { blend: 'normal', exact: true };
  const d = DIRECT[mode];
  if (d) return { blend: d, exact: true };
  return { blend: NEAREST[mode] ?? 'normal', exact: false };
}

export function blendToPsd(mode: BlendMode): PsdBlend {
  for (const [k, v] of Object.entries(DIRECT)) if (v === mode && k !== 'pass through') return k as PsdBlend;
  return 'normal';
}

// ---------------------------------------------------------------------------
// Colours, paths, pixels

export function psdColorHex(c: Color | undefined): string | null {
  if (!c) return null;
  if ('r' in c) return rgbHex(c.r, c.g, c.b);
  if ('fr' in c) return rgbHex(c.fr * 255, c.fg * 255, c.fb * 255);
  if ('c' in c) return cmykToHex(c.c / 255, c.m / 255, c.y / 255, c.k / 255);
  if ('l' in c) return labToHex(c.l, c.a, c.b);
  if ('h' in c) {
    // HSB (h in degrees, s/b 0..1)
    const h = c.h / 60, s = c.s, v = c.b;
    const i = Math.floor(h) % 6, f = h - Math.floor(h);
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
    return rgbHex(r * 255, g * 255, b * 255);
  }
  if ('k' in c) return grayHex(1 - c.k / 255);
  return null;
}

/** Photoshop bezier knots ([inX,inY, anchorX,anchorY, outX,outY] in document px) to path commands. */
export function bezierToPath(paths: BezierPath[]): PathCommand[] {
  const d: PathCommand[] = [];
  const r = (v: number) => Math.round(v * 1000) / 1000; // PSD paths are 8.24 fixed point
  for (const p of paths) {
    const k = p.knots.map((kn) => ({ ...kn, points: kn.points.map(r) }));
    if (!k.length) continue;
    d.push(['M', k[0].points[2], k[0].points[3]]);
    const seg = (a: number[], b: number[]) => d.push(['C', a[4], a[5], b[0], b[1], b[2], b[3]]);
    for (let i = 1; i < k.length; i++) seg(k[i - 1].points, k[i].points);
    if (!p.open) {
      seg(k[k.length - 1].points, k[0].points);
      d.push(['Z']);
    }
  }
  return d;
}

/** Normalise 8/16/32-bit layer data to 8-bit RGBA. */
function toPixels(img: { width: number; height: number; data: ArrayLike<number> }): Pixels {
  const src = img.data;
  if (src instanceof Uint8ClampedArray) return { width: img.width, height: img.height, data: src };
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  if (src instanceof Uint16Array) for (let i = 0; i < out.length; i++) out[i] = src[i] >> 8;
  else if (src instanceof Float32Array) for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, src[i])) * 255);
  else for (let i = 0; i < out.length; i++) out[i] = src[i];
  return { width: img.width, height: img.height, data: out };
}

/** Multiply a layer's alpha by its pixel mask (positions in document px). */
export function applyPixelMask(px: Pixels, left: number, top: number, mask: NonNullable<Layer['mask']>): void {
  const m = mask.imageData ? toPixels(mask.imageData) : null;
  const ml = mask.left ?? 0, mt = mask.top ?? 0;
  const mw = m?.width ?? 0, mh = m?.height ?? 0;
  const def = mask.defaultColor ?? 255;
  const d = px.data;
  for (let y = 0; y < px.height; y++) {
    const my = top + y - mt;
    for (let x = 0; x < px.width; x++) {
      const mx = left + x - ml;
      const v = m && mx >= 0 && my >= 0 && mx < mw && my < mh ? m.data[(my * mw + mx) * 4] : def;
      const i = (y * px.width + x) * 4 + 3;
      d[i] = (d[i] * v) / 255;
    }
  }
}

// ---------------------------------------------------------------------------
// Text

const JUSTIFY: Record<string, TextAlign> = {
  left: 'left', right: 'right', center: 'center', 'justify-left': 'justify', 'justify-right': 'justify', 'justify-center': 'justify', 'justify-all': 'justify',
};

/** PostScript name ("Inter-SemiBoldItalic", "ArialMT") to a CSS family, weight and style. */
export function fontFromPostScript(ps: string | undefined): { family: string; weight: number; italic: boolean } {
  if (!ps) return { family: defaultTextStyle().fontFamily, weight: 400, italic: false };
  const [fam, styleRaw = ''] = ps.split('-');
  const style = styleRaw.toLowerCase();
  const family = fam.replace(/MT$|PSMT$|PS$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  const weights: [RegExp, number][] = [[/thin|hairline/, 100], [/extralight|ultralight/, 200], [/light/, 300], [/medium/, 500], [/semibold|demibold/, 600], [/extrabold|ultrabold/, 800], [/black|heavy/, 900], [/bold/, 700]];
  const weight = weights.find(([r]) => r.test(style))?.[1] ?? 400;
  return { family: `${family}, ${defaultTextStyle().fontFamily}`, weight, italic: /italic|oblique/.test(style) };
}

function textNode(layer: Layer, warn: (w: string) => void): SceneNode | null {
  const t = layer.text;
  if (!t) return null;
  const st = t.style ?? {};
  const scale = t.transform ? Math.hypot(t.transform[2], t.transform[3]) || 1 : 1;
  const font = fontFromPostScript(st.font?.name);
  const size = (st.fontSize ?? 12) * scale;
  const fill = psdColorHex(st.fillColor) ?? '#000000';
  if (t.warp && t.warp.style && t.warp.style !== 'none') warn('Warped text was imported as straight text');
  if ((t.styleRuns?.length ?? 0) > 1) warn('Text with several styles was imported with the first style');
  const l = layer.left ?? 0, tp = layer.top ?? 0, r = layer.right ?? l, b = layer.bottom ?? tp;
  const rotation = t.transform ? (Math.atan2(t.transform[1], t.transform[0]) * 180) / Math.PI : 0;
  return make.text({
    name: layer.name || 'Text',
    text: t.text.replace(/\r\n?/g, '\n'),
    x: (l + r) / 2,
    y: (tp + b) / 2,
    rotation,
    style: defaultTextStyle({
      fontFamily: font.family,
      fontWeight: st.fauxBold ? 700 : font.weight,
      italic: font.italic || !!st.fauxItalic,
      fontSize: size,
      underline: !!st.underline,
      letterSpacing: st.tracking ?? 0,
      lineHeight: st.autoLeading === false && st.leading ? (st.leading * scale) / size : 1.2,
      align: JUSTIFY[t.paragraphStyle?.justification ?? 'left'] ?? 'left',
      fill: solid(fill),
    }),
  });
}

// ---------------------------------------------------------------------------
// Shape layers

function vectorPaint(content: { type: string; color?: Color } | undefined, warn: (w: string) => void): Paint {
  if (!content) return NO_PAINT;
  if (content.type === 'color') {
    const c = psdColorHex(content.color);
    return c ? solid(c) : NO_PAINT;
  }
  warn('Gradient or pattern shape fills were imported as solid grey');
  return solid('#808080');
}

function shapeNode(layer: Layer, warn: (w: string) => void): SceneNode | null {
  if (!layer.vectorMask || !layer.vectorFill) return null;
  const world = bezierToPath(layer.vectorMask.paths);
  if (!world.length) return null;
  const c = centrePath(world);
  const vs = layer.vectorStroke;
  let stroke: Stroke = makeStroke();
  if (vs?.strokeEnabled && vs.content) {
    const p = vectorPaint(vs.content, warn);
    stroke = { ...makeStroke(), paint: p, width: vs.lineWidth?.value ?? 1, cap: vs.lineCapType ?? 'butt', join: vs.lineJoinType ?? 'miter' };
  }
  const fill = vs?.fillEnabled === false ? NO_PAINT : vectorPaint(layer.vectorFill, warn);
  return make.path({ name: layer.name || 'Shape', d: c.d, x: c.cx, y: c.cy, closed: world.some((x) => x[0] === 'Z'), fill, stroke });
}

// ---------------------------------------------------------------------------
// Layer tree

interface Ctx {
  out: ImportResult;
  warn: (w: string) => void;
}

function common(layer: Layer, ctx: Ctx) {
  const { blend, exact } = blendFromPsd(layer.blendMode);
  if (!exact) ctx.warn(`Blend mode “${layer.blendMode}” was mapped to “${blend}”`);
  if (layer.clipping) ctx.warn('Clipping masks were imported as normal layers');
  if (layer.effects && Object.keys(layer.effects).some((k) => k !== 'scale' && k !== 'disabled')) ctx.warn('Layer effects (shadows, strokes, glows) were not imported');
  return {
    visible: !layer.hidden,
    opacity: (layer.opacity ?? 1) * (layer.fillOpacity ?? 1),
    blend,
    locked: !!(layer.protected?.position || layer.protected?.composite),
  };
}

function withVectorMask(node: SceneNode, layer: Layer): SceneNode {
  if (!layer.vectorMask || node.type === 'path') return node;
  const world = bezierToPath(layer.vectorMask.paths);
  if (!world.length) return node;
  return { ...node, mask: { d: translatePath(world, -node.x, -node.y), inverted: !!layer.vectorMask.invert, enabled: !layer.vectorMask.disable } };
}

function convertLayer(layer: Layer, ctx: Ctx): SceneNode | null {
  const base = common(layer, ctx);
  if (layer.children) {
    const kids = convertList(layer.children, ctx);
    if (layer.mask && !layer.mask.disabled && (layer.mask.imageData || layer.mask.canvas)) ctx.warn('Pixel masks on groups were not imported');
    const g = make.group(kids, { name: layer.name || 'Group', ...base });
    return withVectorMask(g, layer);
  }
  if (layer.adjustment) {
    ctx.warn('Adjustment layers were not imported');
    return null;
  }
  if (layer.text) {
    const t = textNode(layer, ctx.warn);
    return t ? withVectorMask({ ...t, ...base }, layer) : null;
  }
  const shape = shapeNode(layer, ctx.warn);
  if (shape) return { ...shape, ...base };
  const img = layer.imageData;
  if (!img || !img.width || !img.height) {
    if (layer.canvas) ctx.warn('A layer could not be read as pixels');
    return null;
  }
  const px = toPixels(img);
  const left = layer.left ?? 0, top = layer.top ?? 0;
  if (layer.mask && !layer.mask.disabled && layer.mask.imageData) {
    applyPixelMask(px, left, top, layer.mask);
    ctx.warn('Pixel masks were applied to layer transparency');
  }
  const id = newId('a');
  ctx.out.pixels.set(id, px);
  const name = layer.name || 'Layer';
  ctx.out.doc.assets[id] = { id, name, mime: 'image/png', width: px.width, height: px.height };
  const r = make.raster({ name, assetId: id, w: px.width, h: px.height, x: left + px.width / 2, y: top + px.height / 2, ...base });
  return withVectorMask(r, layer);
}

/** PSD lists bottom-most first, like our model. */
function convertList(layers: Layer[], ctx: Ctx): SceneNode[] {
  const out: SceneNode[] = [];
  for (const l of layers) {
    const n = convertLayer(l, ctx);
    if (n) out.push(n);
  }
  return out;
}

/** Re-centre group nodes on their content so they rotate/scale around it. */
function centreGroups(nodes: SceneNode[]): SceneNode[] {
  return nodes.map((n) => {
    if (n.type !== 'group') return n;
    const kids = centreGroups(n.children);
    const pts: PathCommand[] = kids.map((k) => ['M', k.x, k.y] as PathCommand);
    if (!pts.length) return { ...n, children: kids };
    const b = pathBounds(pts);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return {
      ...n,
      x: n.x + cx,
      y: n.y + cy,
      mask: n.mask ? { ...n.mask, d: translatePath(n.mask.d, -cx, -cy) } : undefined,
      children: kids.map((k) => ({ ...k, x: k.x - cx, y: k.y - cy })),
    };
  });
}

export function psdToDocument(psd: Psd, title: string): ImportResult {
  const res = psd.imageResources?.resolutionInfo;
  const dpi = res ? Math.round(res.horizontalResolutionUnit === 'PPCM' ? res.horizontalResolution * 2.54 : res.horizontalResolution) : 72;
  const doc = createDocument({ title, studio: 'photo', settings: { width: psd.width, height: psd.height, background: null, dpi } });
  const out = emptyResult(doc);
  const warnings: string[] = [];
  const ctx: Ctx = { out, warn: (w) => warnings.push(w) };
  let nodes = convertList(psd.children ?? [], ctx);
  if (!nodes.length && psd.imageData) {
    // flattened PSD: a single background layer from the composite
    const px = toPixels(psd.imageData);
    const id = newId('a');
    out.pixels.set(id, px);
    out.doc.assets[id] = { id, name: 'Background', mime: 'image/png', width: px.width, height: px.height };
    nodes = [make.raster({ name: 'Background', assetId: id, w: px.width, h: px.height, x: px.width / 2, y: px.height / 2 })];
  }
  nodes = centreGroups(nodes);
  const page = out.doc.pages[0];
  out.doc = { ...out.doc, pages: [{ ...page, nodes }] };
  if ((psd.bitsPerChannel ?? 8) > 8) warnings.push(`${psd.bitsPerChannel}-bit channels were reduced to 8-bit`);
  if (psd.colorMode === 4) warnings.push('CMYK pixels were converted to RGB');
  out.warnings = summariseWarnings(warnings);
  return out;
}

/** Outside a browser (tests, workers) ag-psd needs plain ImageData objects. */
function ensurePixelFactory(): void {
  if (typeof document !== 'undefined') return;
  initializeCanvas(
    () => { throw new Error('No canvas outside the renderer'); },
    (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }) as ImageData,
  );
}

export function importPsd(bytes: Uint8Array, title: string): ImportResult {
  ensurePixelFactory();
  const psd = readPsd(bytes, { useImageData: true, skipThumbnail: true, skipCompositeImageData: false });
  return psdToDocument(psd, title);
}
