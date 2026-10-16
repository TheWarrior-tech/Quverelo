/**
 * The single scene renderer used by the editor viewport, page thumbnails and
 * every raster export (PNG, JPEG, PDF). Draws model nodes onto a 2D context
 * in node-local coordinates.
 */
import { composeTransform } from '../../core/geometry';
import { docColour } from '../../core/colour/profiles';
import { nodeToPath, estimateTextSize } from '../../core/document';
import { drawnStyle, flowRichStory, lineHeightPx, type FlowFrame, type FlowResult, type LaidOutLine, type MeasureFn } from '../../core/textflow';
import { sheetOf } from '../../core/typography';
import { fieldContext, frameExclusions, masterItemsFor } from '../../core/layout';
import { cellRect, isCovered, layoutCell, colCount, rowCount } from '../../core/tables';
import { familyFor } from './otFonts';
import { composeTransform as _ct, multiply as _mul } from '../../core/geometry';
import { baselineOffset, imageFrameContentRect } from '../../core/svg';
import { pathToString } from '../../core/path';
import type { QuvreloDocument, Id, Paint, PathCommand, SceneNode, Story, Stroke, TextStyle } from '../../core/types';
import type { AssetStore } from './assets';
import { drawAdjustmentLayer, drawLayered, drawNodeList, needsLayer } from './compose';

export interface DrawEnv {
  doc: QuvreloDocument;
  assets: AssetStore;
  /** editor chrome: placeholders, overflow markers */
  editor: boolean;
  /** use preview-quality adjustment rendering */
  preview: boolean;
  hiddenNodeId?: Id | null;
  /** in-progress paint stroke; `mask` = the canvas is the layer's pixel mask being painted */
  /**
   * A stroke / preview in progress on one layer. `canvas` is the layer's raw
   * pixels (or its mask when `mask`); the layer's live adjustments are applied
   * to it on the fly unless `adjusted` says the canvas already has them.
   */
  livePaint?: { nodeId: Id; canvas: HTMLCanvasElement; mask?: boolean; adjusted?: boolean } | null;
  zoom: number;
  /** page being drawn (fields in master items show this page's number) */
  pageIndex?: number;
  /** rich text editing: the edited frame stays drawn (the caret/selection are overlay chrome) */
  richEdit?: boolean;
  /** table cell being edited / selected (editor chrome) */
  tableCell?: { nodeId: Id; r: number; c: number } | null;
}

// ---------------------------------------------------------------------------
// Text measurement

let measureCtx: CanvasRenderingContext2D | null = null;

export function cssFont(style: TextStyle, size = style.fontSize): string {
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${size}px ${familyFor(style)}`;
}

type TypoCtx = CanvasRenderingContext2D & { fontKerning?: string; fontVariantCaps?: string };

/** OpenType basics on a canvas context (kerning, small caps), so measuring and drawing agree. */
function setTypo(ctx: CanvasRenderingContext2D, style: TextStyle) {
  const c = ctx as TypoCtx;
  c.fontKerning = style.kerning === false ? 'none' : 'normal';
  c.fontVariantCaps = style.caps ?? 'normal';
}

const widthCache = new Map<string, number>();

export const measureText: MeasureFn = (text, style) => {
  if (!text) return 0;
  const key = cssFont(style) + (style.kerning === false ? '|nk' : '') + (style.caps && style.caps !== 'normal' ? '|' + style.caps : '') + '\u0000' + text;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  measureCtx.font = cssFont(style);
  setTypo(measureCtx, style);
  const w = measureCtx.measureText(text).width;
  if (widthCache.size > 20000) widthCache.clear();
  widthCache.set(key, w);
  return w;
};

/** Clear cached widths (call after web fonts finish loading). */
export function resetMeasureCache(): void {
  widthCache.clear();
  flowCache.clear();
}

export function artisticTextSize(text: string, style: TextStyle): { w: number; h: number } {
  if (typeof document === 'undefined') return estimateTextSize(text, style);
  const lines = text.split('\n');
  const tracking = (style.letterSpacing / 1000) * style.fontSize;
  const w = Math.max(style.fontSize * 0.3, ...lines.map((l) => measureText(l, style) + tracking * l.length));
  return { w, h: lines.length * lineHeightPx(style) };
}

// ---------------------------------------------------------------------------
// Story flow cache

const flowCache = new Map<string, { story: Story; key: string; result: FlowResult }>();

type FrameNode = Extract<SceneNode, { type: 'textframe' }>;

interface FrameInfo {
  node: FrameNode;
  /** page index, −1 on a master */
  pageIndex: number;
  /** page y of the frame's top edge */
  pageTop: number;
}

export function frameChain(doc: QuvreloDocument, story: Story): FrameNode[] {
  const out: FrameNode[] = [];
  const index = frameIndex(doc);
  for (const id of story.chain) {
    const f = index.get(id);
    if (f) out.push(f.node);
  }
  return out;
}

const frameIndexCache = new WeakMap<QuvreloDocument, Map<Id, FrameInfo>>();
function frameIndex(doc: QuvreloDocument): Map<Id, FrameInfo> {
  let m = frameIndexCache.get(doc);
  if (m) return m;
  m = new Map();
  const visit = (nodes: SceneNode[], pi: number, parent: [number, number, number, number, number, number]) => {
    for (const n of nodes) {
      if (n.type === 'textframe') {
        const w = _mul(parent, _ct(n));
        m!.set(n.id, { node: n, pageIndex: pi, pageTop: w[1] * (-n.w / 2) + w[3] * (-n.h / 2) + w[5] });
      } else if (n.type === 'group') visit(n.children, pi, _mul(parent, _ct(n)));
    }
  };
  doc.pages.forEach((p, i) => visit(p.nodes, i, [1, 0, 0, 1, 0, 0]));
  doc.masters.forEach((p) => visit(p.nodes, -1, [1, 0, 0, 1, 0, 0]));
  frameIndexCache.set(doc, m);
  return m;
}

const exclusionCache = new WeakMap<QuvreloDocument, Map<string, FlowFrame['exclusions']>>();
function exclusionsFor(doc: QuvreloDocument, frameId: Id, pageIndex: number | undefined): FlowFrame['exclusions'] {
  let m = exclusionCache.get(doc);
  if (!m) {
    m = new Map();
    exclusionCache.set(doc, m);
  }
  const k = `${frameId}|${pageIndex ?? ''}`;
  let ex = m.get(k);
  if (!ex) {
    ex = frameExclusions(doc, frameId, renderLocalBounds, pageIndex);
    m.set(k, ex);
  }
  return ex;
}

/** Whether any item in the document has text wrap (skips exclusion work otherwise). */
const wrapCache = new WeakMap<QuvreloDocument, boolean>();
function docHasWrap(doc: QuvreloDocument): boolean {
  let v = wrapCache.get(doc);
  if (v === undefined) {
    v = false;
    const visit = (nodes: SceneNode[]) => {
      for (const n of nodes) {
        if (n.wrap && n.wrap.mode !== 'none') v = true;
        if (n.type === 'group') visit(n.children);
      }
    };
    doc.pages.forEach((p) => visit(p.nodes));
    doc.masters.forEach((p) => visit(p.nodes));
    wrapCache.set(doc, v);
  }
  return v;
}

/**
 * Lay out a story with everything that affects it: frame geometry, text wrap,
 * the baseline grid, styles and page-number fields. `pageIndex` is the page a
 * master item is being drawn on (fields in master frames show its number).
 */
export function storyFlow(doc: QuvreloDocument, storyId: Id, pageIndex?: number): FlowResult | null {
  const story = doc.stories[storyId];
  if (!story) return null;
  const index = frameIndex(doc);
  const wrap = docHasWrap(doc);
  const frames: FlowFrame[] = [];
  for (const id of story.chain) {
    const info = index.get(id);
    if (!info) continue;
    const f = info.node;
    const pi = info.pageIndex >= 0 ? info.pageIndex : pageIndex;
    frames.push({
      id: f.id, w: f.w, h: f.h, padding: f.padding, columns: f.columns, columnGap: f.columnGap,
      pageTop: info.pageTop,
      fields: pi !== undefined && pi >= 0 && doc.pages[pi] ? fieldContext(doc, pi) : null,
      exclusions: wrap ? exclusionsFor(doc, f.id, info.pageIndex >= 0 ? undefined : pageIndex) : undefined,
    });
  }
  const g = doc.settings.baselineGrid;
  const grid = g && g.enabled ? { start: g.start, increment: g.increment } : null;
  const sheet = sheetOf(doc);
  const key = JSON.stringify([frames, grid]) + '|' + sheetKey(sheet);
  const cacheKey = storyId + '|' + (pageIndex ?? '');
  const hit = flowCache.get(cacheKey);
  if (hit && hit.story === story && hit.key === key) return hit.result;
  const result = flowRichStory(story, sheet, frames, measureText, { grid });
  if (flowCache.size > 4000) flowCache.clear();
  flowCache.set(cacheKey, { story, key, result });
  return result;
}

const sheetKeys = new WeakMap<object, string>();
let sheetSeq = 0;
function sheetKey(sheet: object): string {
  let k = sheetKeys.get(sheet);
  if (!k) {
    k = String(++sheetSeq);
    sheetKeys.set(sheet, k);
  }
  return k;
}

// ---------------------------------------------------------------------------
// Paint helpers

function makeFillStyle(ctx: CanvasRenderingContext2D, p: Paint, box: { x: number; y: number; w: number; h: number }): string | CanvasGradient | null {
  switch (p.type) {
    case 'none':
      return null;
    case 'solid':
      return p.color;
    case 'linear': {
      const a = (p.angle * Math.PI) / 180;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const dx = (Math.cos(a) * box.w) / 2;
      const dy = (Math.sin(a) * box.h) / 2;
      const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      for (const s of p.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color);
      return g;
    }
    case 'radial': {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const r = Math.max(box.w, box.h) / 2;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      for (const s of p.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color);
      return g;
    }
  }
}

function applyStroke(ctx: CanvasRenderingContext2D, s: Stroke, box: { x: number; y: number; w: number; h: number }): boolean {
  if (s.width <= 0 || s.paint.type === 'none') return false;
  const style = makeFillStyle(ctx, s.paint, box);
  if (!style) return false;
  ctx.strokeStyle = style;
  ctx.lineWidth = s.width;
  ctx.lineCap = s.cap;
  ctx.lineJoin = s.join;
  ctx.setLineDash(s.dash);
  return true;
}

const pathCache = new WeakMap<PathCommand[], Path2D>();
export function toPath2D(d: PathCommand[]): Path2D {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(pathToString(d));
    pathCache.set(d, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Node drawing

export function nodeBox(n: SceneNode): { x: number; y: number; w: number; h: number } {
  if ('w' in n && 'h' in n) return { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h };
  if (n.type === 'text') {
    const s = artisticTextSize(n.text, n.style);
    return { x: -s.w / 2, y: -s.h / 2, w: s.w, h: s.h };
  }
  return { x: -50, y: -50, w: 100, h: 100 };
}

/** Draw a child node: applies its transform, opacity and blend mode. */
export function drawNodeTransformed(ctx: CanvasRenderingContext2D, n: SceneNode, env: DrawEnv): void {
  if (!n.visible) return;
  ctx.save();
  const m = composeTransform(n);
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  if (needsLayer(n)) {
    // isolated group, pixel mask or a per-pixel blend mode (engine/compose.ts)
    drawLayered(ctx, n, env, ctx.globalAlpha * n.opacity, n.blend, (x) => drawNodeContent(x, n, env), n.type === 'group' ? undefined : renderLocalBounds(n));
  } else {
    ctx.globalAlpha *= n.opacity;
    if (n.blend !== 'normal') ctx.globalCompositeOperation = n.blend as GlobalCompositeOperation;
    drawNodeContent(ctx, n, env);
  }
  ctx.restore();
}

/** Draw a node's content in its local space (transform already applied by the caller). */
export function drawNodeContent(ctx: CanvasRenderingContext2D, n: SceneNode, env: DrawEnv): void {
  if (env.hiddenNodeId === n.id && (n.type === 'text' || n.type === 'textframe') && !env.richEdit) {
    if (n.type === 'textframe') drawFrameBox(ctx, n, env);
    return;
  }
  ctx.save();
  if (n.mask?.enabled && n.mask.d.length) {
    const clip = toPath2D(n.mask.d);
    if (n.mask.inverted) {
      const p = new Path2D();
      p.rect(-1e6, -1e6, 2e6, 2e6);
      p.addPath(clip);
      ctx.clip(p, 'evenodd');
    } else ctx.clip(clip, 'evenodd');
  }
  switch (n.type) {
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'star':
    case 'path': {
      const d = nodeToPath(n)!;
      const p = toPath2D(d);
      const b = n.type === 'path' ? pathBox(d) : nodeBox(n);
      const fill = makeFillStyle(ctx, n.fill, b);
      if (fill && (n.type !== 'path' || n.closed || n.fill.type !== 'none')) {
        ctx.fillStyle = fill;
        ctx.fill(p, 'evenodd');
      }
      if (applyStroke(ctx, n.stroke, b)) ctx.stroke(p);
      break;
    }
    case 'text':
      drawArtisticText(ctx, n);
      break;
    case 'textframe':
      drawTextFrame(ctx, n, env);
      break;
    case 'imageframe':
      drawImageFrame(ctx, n, env);
      break;
    case 'table':
      drawTable(ctx, n, env);
      break;
    case 'raster': {
      const lp = env.livePaint && env.livePaint.nodeId === n.id && !env.livePaint.mask ? env.livePaint : null;
      // live adjustments stay visible while a stroke is in progress
      const live = lp ? (lp.adjusted ? lp.canvas : env.assets.adjustLive(lp.canvas, n.adjustments)) : null;
      const img = live ?? env.assets.rendered(n.assetId, n.adjustments, env.preview, docColour(env.doc.settings).bitDepth === 16);
      if (img) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, -n.w / 2, -n.h / 2, n.w, n.h);
      } else if (env.editor) {
        ctx.fillStyle = 'rgba(128,128,128,0.2)';
        ctx.fillRect(-n.w / 2, -n.h / 2, n.w, n.h);
      }
      break;
    }
    case 'adjustment':
      drawAdjustmentLayer(ctx, n, env);
      break;
    case 'group':
      drawNodeList(ctx, n.children, env, drawNodeTransformed);
      break;
  }
  ctx.restore();
}

const pathBoxCache = new WeakMap<PathCommand[], { x: number; y: number; w: number; h: number }>();
function pathBox(d: PathCommand[]) {
  let b = pathBoxCache.get(d);
  if (!b) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of d) {
      for (let i = 1; i < c.length; i += 2) {
        const x = c[i] as number;
        const y = c[i + 1] as number;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    b = isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
    pathBoxCache.set(d, b);
  }
  return b;
}

function setTextCtx(ctx: CanvasRenderingContext2D, style: TextStyle) {
  ctx.font = cssFont(style);
  setTypo(ctx, style);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const tracking = (style.letterSpacing / 1000) * style.fontSize;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${tracking}px`;
}

function drawUnderline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, style: TextStyle) {
  if (!style.underline || w <= 0) return;
  const t = Math.max(1, style.fontSize / 16);
  ctx.fillRect(x, y + style.fontSize * 0.12, w, t);
}

function drawLineText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, wordSpacing: number, style: TextStyle, stroke = false) {
  if (wordSpacing > 0) {
    const words = text.split(' ');
    let cx = x;
    const space = measureText(' ', style) + (style.letterSpacing / 1000) * style.fontSize;
    for (const w of words) {
      if (stroke) ctx.strokeText(w, cx, y);
      else ctx.fillText(w, cx, y);
      cx += measureText(w, style) + (style.letterSpacing / 1000) * style.fontSize * w.length + space + wordSpacing;
    }
  } else if (stroke) ctx.strokeText(text, x, y);
  else ctx.fillText(text, x, y);
}

function drawArtisticText(ctx: CanvasRenderingContext2D, n: Extract<SceneNode, { type: 'text' }>) {
  const s = n.style;
  const size = artisticTextSize(n.text, s);
  const lh = lineHeightPx(s);
  const box = { x: -size.w / 2, y: -size.h / 2, w: size.w, h: size.h };
  setTextCtx(ctx, s);
  const fill = makeFillStyle(ctx, s.fill, box);
  const lines = n.text.split('\n');
  const tracking = (s.letterSpacing / 1000) * s.fontSize;
  const hasStroke = applyStroke(ctx, n.stroke, box);
  lines.forEach((line, i) => {
    const w = measureText(line, s) + tracking * line.length;
    let x = box.x;
    if (s.align === 'center') x = -w / 2;
    else if (s.align === 'right') x = box.x + box.w - w;
    const y = box.y + i * lh + baselineOffset(s);
    if (hasStroke) drawLineText(ctx, line, x, y, 0, s, true);
    if (fill) {
      ctx.fillStyle = fill;
      drawLineText(ctx, line, x, y, 0, s);
      drawUnderline(ctx, x, y, w, s);
    }
  });
}

/**
 * Whether an unstroked frame gets the dashed editor guide. Text frames that
 * hold text show none at rest (the hover / selection outline on the overlay
 * covers hover and selection); they get it only while their text is being
 * edited, or when empty so an empty frame never becomes invisible. Image
 * frames keep it (their empty placeholder needs a boundary).
 */
export function frameGuideVisible(n: Extract<SceneNode, { type: 'textframe' | 'imageframe' }>, env: Pick<DrawEnv, 'doc' | 'hiddenNodeId'>): boolean {
  if (n.type !== 'textframe') return true;
  if (env.hiddenNodeId === n.id) return true;
  const story = env.doc.stories[n.storyId];
  return !story || !story.text.trim();
}

function drawFrameBox(ctx: CanvasRenderingContext2D, n: Extract<SceneNode, { type: 'textframe' | 'imageframe' }>, env: DrawEnv) {
  const box = { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h };
  const fill = makeFillStyle(ctx, n.fill, box);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  if (applyStroke(ctx, n.stroke, box)) ctx.strokeRect(box.x, box.y, box.w, box.h);
  else if (env.editor && frameGuideVisible(n, env)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(80,140,255,0.45)';
    ctx.lineWidth = 1 / Math.max(0.01, env.zoom);
    ctx.setLineDash([4 / env.zoom, 3 / env.zoom]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }
}

/** Draw laid-out lines (styled runs) with the frame's top-left corner at (ox, oy). */
export function drawFlowLines(ctx: CanvasRenderingContext2D, lines: LaidOutLine[], ox: number, oy: number, fallback: TextStyle, box: { x: number; y: number; w: number; h: number }): void {
  for (const l of lines) {
    const runs = l.runs ?? [{ text: l.text, x: l.x, width: l.width, style: fallback, start: l.start, end: l.end, wordSpacing: l.wordSpacing, rise: 0 }];
    const base = l.baseline ?? l.y + baselineOffset(fallback);
    for (const r of runs) {
      if (!r.text) continue;
      const ds = drawnStyle(r.style);
      setTextCtx(ctx, ds);
      const fill = makeFillStyle(ctx, ds.fill, box);
      if (!fill) continue;
      ctx.fillStyle = fill;
      const x = ox + r.x;
      const y = oy + base - r.rise;
      drawLineText(ctx, r.text, x, y, r.wordSpacing, ds);
      drawUnderline(ctx, x, y, r.width, ds);
      if (ds.strike) ctx.fillRect(x, y - ds.fontSize * 0.28, r.width, Math.max(1, ds.fontSize / 16));
    }
  }
}

function drawTextFrame(ctx: CanvasRenderingContext2D, n: Extract<SceneNode, { type: 'textframe' }>, env: DrawEnv) {
  drawFrameBox(ctx, n, env);
  const story = env.doc.stories[n.storyId];
  if (!story) return;
  const flow = storyFlow(env.doc, n.storyId, env.pageIndex);
  const layout = flow?.frames[n.id];
  ctx.save();
  ctx.beginPath();
  ctx.rect(-n.w / 2 - 2, -n.h / 2 - 2, n.w + 4, n.h + 4);
  ctx.clip();
  if (layout) drawFlowLines(ctx, layout.lines, -n.w / 2, -n.h / 2, story.style, { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h });
  ctx.restore();
  if (env.editor && flow) {
    const isLast = story.chain[story.chain.length - 1] === n.id;
    const z = Math.max(0.01, env.zoom);
    const sz = 10 / z;
    const x = n.w / 2 - sz - 2 / z;
    const y = n.h / 2 - sz - 2 / z;
    if (isLast && flow.overflow) drawOversetMarker(ctx, x, y, sz, z);
    else if (!isLast) {
      ctx.fillStyle = '#2fb8a6';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + sz, y + sz / 2);
      ctx.lineTo(x, y + sz);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** The red "+" out-port shown on a frame or cell whose text does not fit. */
function drawOversetMarker(ctx: CanvasRenderingContext2D, x: number, y: number, sz: number, z: number) {
  ctx.fillStyle = '#e63946';
  ctx.fillRect(x, y, sz, sz);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5 / z;
  ctx.beginPath();
  ctx.moveTo(x + sz / 2, y + 2 / z);
  ctx.lineTo(x + sz / 2, y + sz - 2 / z);
  ctx.moveTo(x + 2 / z, y + sz / 2);
  ctx.lineTo(x + sz - 2 / z, y + sz / 2);
  ctx.stroke();
}

function drawTable(ctx: CanvasRenderingContext2D, n: Extract<SceneNode, { type: 'table' }>, env: DrawEnv) {
  const sheet = sheetOf(env.doc);
  const ox = -n.w / 2;
  const oy = -n.h / 2;
  const z = Math.max(0.01, env.zoom);
  const cells: { r: number; c: number; lay: ReturnType<typeof layoutCell> }[] = [];
  for (let r = 0; r < rowCount(n); r++) for (let c = 0; c < colCount(n); c++) {
    if (isCovered(n, r, c)) continue;
    cells.push({ r, c, lay: layoutCell(n, sheet, r, c, measureText) });
  }
  // fills
  for (const { lay } of cells) {
    const box = { x: ox + lay.rect.x, y: oy + lay.rect.y, w: lay.rect.w, h: lay.rect.h };
    const fill = makeFillStyle(ctx, lay.props.fill, box);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
  }
  // text (clipped per cell)
  for (const { r, c, lay } of cells) {
    const box = { x: ox + lay.rect.x, y: oy + lay.rect.y, w: lay.rect.w, h: lay.rect.h };
    const editing = !env.richEdit && env.hiddenNodeId === n.id && env.tableCell?.nodeId === n.id && env.tableCell.r === r && env.tableCell.c === c;
    if (!editing) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      drawFlowLines(ctx, lay.flow.frames.cell.lines, box.x, box.y, lay.style, box);
      ctx.restore();
    }
    if (env.editor && lay.flow.overflow) {
      const sz = Math.min(8 / z, box.h / 2);
      drawOversetMarker(ctx, box.x + box.w - sz - 1 / z, box.y + box.h - sz - 1 / z, sz, z);
    }
  }
  // borders
  for (const { lay } of cells) {
    const p = lay.props;
    if (p.strokeWidth <= 0 || p.stroke.type === 'none') continue;
    const box = { x: ox + lay.rect.x, y: oy + lay.rect.y, w: lay.rect.w, h: lay.rect.h };
    const st = makeFillStyle(ctx, p.stroke, box);
    if (!st) continue;
    ctx.strokeStyle = st;
    ctx.lineWidth = p.strokeWidth;
    ctx.setLineDash([]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
  if (env.editor && env.tableCell?.nodeId === n.id && n.cells[env.tableCell.r]?.[env.tableCell.c]) {
    const rc = cellRect(n, env.tableCell.r, env.tableCell.c);
    ctx.save();
    ctx.strokeStyle = '#2fb8a6';
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(ox + rc.x, oy + rc.y, rc.w, rc.h);
    ctx.restore();
  }
}

function drawImageFrame(ctx: CanvasRenderingContext2D, n: Extract<SceneNode, { type: 'imageframe' }>, env: DrawEnv) {
  const box = { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h };
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  const fill = makeFillStyle(ctx, n.fill, box);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  const img = n.assetId ? env.assets.get(n.assetId) : null;
  if (img) {
    const r = imageFrameContentRect(n, img.width, img.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  } else if (env.editor) {
    ctx.strokeStyle = 'rgba(120,130,150,0.6)';
    ctx.lineWidth = 1 / Math.max(0.01, env.zoom);
    ctx.beginPath();
    ctx.moveTo(box.x, box.y);
    ctx.lineTo(box.x + box.w, box.y + box.h);
    ctx.moveTo(box.x + box.w, box.y);
    ctx.lineTo(box.x, box.y + box.h);
    ctx.stroke();
    const fs = Math.min(14 / env.zoom, box.h / 4);
    ctx.fillStyle = 'rgba(90,100,120,0.9)';
    ctx.font = `600 ${fs}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Double-click to place an image', 0, 0, box.w * 0.9);
  }
  ctx.restore();
  if (applyStroke(ctx, n.stroke, box)) ctx.strokeRect(box.x, box.y, box.w, box.h);
}

/** Render a whole page (master + nodes) onto a context already scaled to document units. */
export function drawPage(ctx: CanvasRenderingContext2D, doc: QuvreloDocument, pageIndex: number, env: DrawEnv, includeBackground = true): void {
  const page = doc.pages[pageIndex];
  if (!page) return;
  const { width, height, background, bleed } = doc.settings;
  if (includeBackground && background) {
    ctx.fillStyle = background;
    ctx.fillRect(-bleed, -bleed, width + 2 * bleed, height + 2 * bleed);
  }
  // master items (minus those overridden on this page); fields show this page's number
  const penv = env.pageIndex === pageIndex ? env : { ...env, pageIndex };
  drawNodeList(ctx, masterItemsFor(doc, page), penv, drawNodeTransformed);
  drawNodeList(ctx, page.nodes, penv, drawNodeTransformed);
}

/** Local bounds using real font metrics (renderer-side counterpart of nodeLocalBounds). */
export function renderLocalBounds(n: SceneNode): { x: number; y: number; w: number; h: number } {
  if (n.type === 'path') return pathBox(n.d);
  if (n.type === 'group') {
    const rs = n.children.map(renderBounds);
    if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
    const x = Math.min(...rs.map((r) => r.x));
    const y = Math.min(...rs.map((r) => r.y));
    const x2 = Math.max(...rs.map((r) => r.x + r.w));
    const y2 = Math.max(...rs.map((r) => r.y + r.h));
    return { x, y, w: x2 - x, h: y2 - y };
  }
  return nodeBox(n);
}

/** Axis-aligned bounds in the parent's space using real font metrics. */
export function renderBounds(n: SceneNode): { x: number; y: number; w: number; h: number } {
  const m = composeTransform(n);
  const b = renderLocalBounds(n);
  const pts = [
    [b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h],
  ].map(([x, y]) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
