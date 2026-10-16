/**
 * Export slices (Affinity Designer's Export persona): named areas of a page,
 * each following an artboard / object or a fixed rectangle, with its own list
 * of outputs (format × scale, e.g. PNG @1x and @2x plus SVG). Pure model code;
 * rendering each output is done by the renderer's exporters.
 */
import { findNode, worldMatrix, nodeLocalBounds, nodeMatrix, walk } from './document';
import { bakeTransform, cropDocument } from './commands';
import { multiply, type Matrix } from './geometry';
import { transformRect, type Rect } from './geometry';
import { newId } from './ids';
import type { Id, QuvreloDocument, SceneNode, Slice, SliceFormat, SliceOutput } from './types';

export const SLICE_FORMATS: SliceFormat[] = ['png', 'jpg', 'svg', 'pdf'];
export const SLICE_SCALES = [0.5, 1, 1.5, 2, 3, 4];

export const DEFAULT_OUTPUTS: SliceOutput[] = [{ format: 'png', scale: 1 }, { format: 'png', scale: 2 }];

/** File-system safe base name. */
export function safeName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return s || 'slice';
}

/** "icon@2x.png" style file name for one output; vector formats ignore scale. */
export function sliceFileName(slice: Pick<Slice, 'name'>, out: SliceOutput): string {
  const vector = out.format === 'svg' || out.format === 'pdf';
  const suffix = !vector && out.scale !== 1 ? `@${out.scale}x` : '';
  return `${safeName(slice.name)}${suffix}.${out.format}`;
}

/** All output file names of the enabled slices, made unique ("name (2).png"). */
export function plannedFiles(slices: Slice[]): { slice: Slice; output: SliceOutput; file: string }[] {
  const used = new Map<string, number>();
  const out: { slice: Slice; output: SliceOutput; file: string }[] = [];
  for (const s of slices) {
    if (!s.enabled) continue;
    // duplicate outputs in one slice are written once
    const seen = new Set<string>();
    for (const o of s.outputs) {
      let file = sliceFileName(s, o);
      if (seen.has(file)) continue;
      seen.add(file);
      const n = used.get(file.toLowerCase()) ?? 0;
      used.set(file.toLowerCase(), n + 1);
      if (n) file = file.replace(/(\.[a-z]+)$/, ` (${n + 1})$1`);
      out.push({ slice: s, output: o, file });
    }
  }
  return out;
}

/** World-space bounds of a node (document model metrics). */
export function worldBounds(doc: QuvreloDocument, id: Id, local: (n: SceneNode) => Rect = nodeLocalBounds): Rect | null {
  const loc = findNode(doc, id);
  if (!loc) return null;
  return transformRect(worldMatrix(loc), local(loc.node));
}

/** The area a slice exports right now (follows its node when it has one). */
export function sliceRect(doc: QuvreloDocument, s: Slice, local?: (n: SceneNode) => Rect): Rect {
  if (s.nodeId) {
    const r = worldBounds(doc, s.nodeId, local);
    if (r) return r;
  }
  return s.rect;
}

export function addSlice(doc: QuvreloDocument, init: { name: string; pageId: Id; nodeId?: Id | null; rect: Rect; outputs?: SliceOutput[] }): { doc: QuvreloDocument; id: Id } {
  const slice: Slice = {
    id: newId('slice'),
    name: init.name,
    pageId: init.pageId,
    nodeId: init.nodeId ?? null,
    rect: { ...init.rect },
    outputs: (init.outputs ?? DEFAULT_OUTPUTS).map((o) => ({ ...o })),
    enabled: true,
  };
  return { doc: { ...doc, slices: [...(doc.slices ?? []), slice] }, id: slice.id };
}

export function updateSlice(doc: QuvreloDocument, id: Id, patch: Partial<Omit<Slice, 'id'>>): QuvreloDocument {
  return { ...doc, slices: (doc.slices ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function removeSlice(doc: QuvreloDocument, id: Id): QuvreloDocument {
  return { ...doc, slices: (doc.slices ?? []).filter((s) => s.id !== id) };
}

/** Artboards on a page (top level). */
export function pageArtboards(doc: QuvreloDocument, pageId: Id): Extract<SceneNode, { type: 'group' }>[] {
  const page = doc.pages.find((p) => p.id === pageId);
  const out: Extract<SceneNode, { type: 'group' }>[] = [];
  if (page) walk(page.nodes, (n) => { if (n.type === 'group' && n.artboard) out.push(n); });
  return out;
}

/** Add a slice for every artboard on the page that doesn't have one yet. */
export function slicesFromArtboards(doc: QuvreloDocument, pageId: Id): QuvreloDocument {
  let out = doc;
  const have = new Set((doc.slices ?? []).map((s) => s.nodeId).filter(Boolean));
  for (const a of pageArtboards(doc, pageId)) {
    if (have.has(a.id)) continue;
    const r = worldBounds(out, a.id) ?? { x: 0, y: 0, w: 0, h: 0 };
    out = addSlice(out, { name: a.name, pageId, nodeId: a.id, rect: r }).doc;
  }
  return out;
}

/** Drop slices whose page or node has gone (after deletes). */
export function pruneSlices(doc: QuvreloDocument): QuvreloDocument {
  if (!doc.slices?.length) return doc;
  const pages = new Set(doc.pages.map((p) => p.id));
  const keep = doc.slices.filter((s) => pages.has(s.pageId) && (!s.nodeId || findNode(doc, s.nodeId)));
  return keep.length === doc.slices.length ? doc : { ...doc, slices: keep };
}

/**
 * A one-page document holding exactly what a slice exports, sized to it: a
 * slice that follows an artboard or object exports just that (on a
 * transparent background, the board brings its own); a fixed-area slice
 * exports everything on the page in that area.
 */
export function sliceDocument(doc: QuvreloDocument, s: Slice, local?: (n: SceneNode) => Rect): QuvreloDocument | null {
  const page = doc.pages.find((p) => p.id === s.pageId);
  if (!page) return null;
  const r = sliceRect(doc, s, local);
  if (r.w <= 0 || r.h <= 0) return null;
  let one: QuvreloDocument;
  const loc = s.nodeId ? findNode(doc, s.nodeId) : null;
  if (loc) {
    let m: Matrix = [1, 0, 0, 1, 0, 0];
    for (const g of loc.ancestors) m = multiply(m, nodeMatrix(g));
    const node = loc.ancestors.length ? bakeTransform(loc.node, m) : loc.node;
    one = { ...doc, settings: { ...doc.settings, background: null, bleed: 0 }, pages: [{ ...page, masterId: null, nodes: [node] }] };
  } else {
    one = { ...doc, settings: { ...doc.settings, bleed: 0 }, pages: [page] };
  }
  const out = cropDocument(one, r);
  // keep fractional sizes exact for vector output
  return { ...out, title: s.name, settings: { ...out.settings, width: Math.max(1, r.w), height: Math.max(1, r.h) } };
}
