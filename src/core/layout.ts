/**
 * Layout studio document operations: page numbering and sections, master
 * pages applied per page with per-item overrides, inserting pages, text-wrap
 * exclusions for a frame and auto-flow of overset stories onto new pages.
 * Pure functions over the immutable document model.
 */
import { cloneNode, createPage, createStory, findNode, getContainer, nodeMatrix } from './document';
import { addNodes, linkFrames, removeNodes } from './commands';
import { composeTransform, invert, multiply, type Matrix } from './geometry';
import { nodeToPath } from './document';
import type { Id, MasterPage, Page, PageNumberStyle, PageSection, QuvreloDocument, SceneNode, Story } from './types';
import type { Exclusion, FlowResult } from './textflow';
import type { FieldContext } from './typography';

// ---------------------------------------------------------------------------
// Page numbering & sections

export function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of t) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}

export function toAlpha(n: number): string {
  if (n <= 0) return String(n);
  let out = '';
  while (n > 0) {
    n--;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

export function formatPageNumber(n: number, style: PageNumberStyle): string {
  switch (style) {
    case 'roman': return toRoman(n);
    case 'ROMAN': return toRoman(n).toUpperCase();
    case 'alpha': return toAlpha(n);
    case 'ALPHA': return toAlpha(n).toUpperCase();
    default: return String(n);
  }
}

const DEFAULT_SECTION: PageSection = { name: '', startAt: 1, style: 'arabic' };

/** The section a page belongs to, and the index of the page that starts it. */
export function sectionOf(doc: Pick<QuvreloDocument, 'pages'>, pageIndex: number): { section: PageSection; startIndex: number } {
  for (let i = Math.min(pageIndex, doc.pages.length - 1); i >= 0; i--) {
    const s = doc.pages[i]?.section;
    if (s) return { section: s, startIndex: i };
  }
  return { section: DEFAULT_SECTION, startIndex: 0 };
}

/** Label of a page as page-number fields show it ("iv", "A-3", "12"). */
export function pageLabel(doc: Pick<QuvreloDocument, 'pages'>, pageIndex: number): string {
  const { section, startIndex } = sectionOf(doc, pageIndex);
  return (section.prefix ?? '') + formatPageNumber(section.startAt + (pageIndex - startIndex), section.style);
}

/** Field values for a page (page number, page count, section name). */
export function fieldContext(doc: Pick<QuvreloDocument, 'pages'>, pageIndex: number): FieldContext {
  return { page: pageLabel(doc, pageIndex), pageCount: String(doc.pages.length), section: sectionOf(doc, pageIndex).section.name };
}

/** Start (or update) a section at a page; `null` removes it. */
export function setPageSection(doc: QuvreloDocument, pageId: Id, section: PageSection | null): QuvreloDocument {
  return {
    ...doc,
    pages: doc.pages.map((p) => {
      if (p.id !== pageId) return p;
      const next: Page = { ...p };
      if (section) next.section = { ...section, startAt: Math.max(1, Math.round(section.startAt || 1)) };
      else delete next.section;
      return next;
    }),
  };
}

// ---------------------------------------------------------------------------
// Pages

/** Insert `count` pages after `afterIndex` (−1 = at the start), each with `masterId`. */
export function insertPages(doc: QuvreloDocument, afterIndex: number, count: number, masterId: Id | null): { doc: QuvreloDocument; pageIds: Id[] } {
  const n = Math.max(1, Math.min(500, Math.round(count)));
  const fresh = Array.from({ length: n }, () => createPage('Page 0', masterId));
  const pages = [...doc.pages];
  pages.splice(Math.max(0, afterIndex + 1), 0, ...fresh);
  return { doc: renumber({ ...doc, pages }), pageIds: fresh.map((p) => p.id) };
}

function renumber(doc: QuvreloDocument): QuvreloDocument {
  return { ...doc, pages: doc.pages.map((p, i) => (/^Page \d+( copy)?$/.test(p.name) ? { ...p, name: `Page ${i + 1}` } : p)) };
}

/** Apply a master (or none) to several pages at once. */
export function applyMasterToPages(doc: QuvreloDocument, masterId: Id | null, pageIds: Id[]): QuvreloDocument {
  const set = new Set(pageIds);
  return {
    ...doc,
    pages: doc.pages.map((p) => {
      if (!set.has(p.id) || p.masterId === masterId) return p;
      // overrides belong to the old master: drop the hidden list, keep the page copies as plain items
      const next: Page = { ...p, masterId, nodes: p.nodes.map((n) => (n.overrideOf ? stripOverride(n) : n)) };
      delete next.overrides;
      return next;
    }),
  };
}

function stripOverride(n: SceneNode): SceneNode {
  const c = { ...n };
  delete c.overrideOf;
  return c;
}

/** Spread grouping for facing pages: page 1 alone (right), then pairs. */
export function spreadsOf(count: number, facing: boolean): number[][] {
  if (!facing) return Array.from({ length: count }, (_, i) => [i]);
  const out: number[][] = [];
  if (count > 0) out.push([0]);
  for (let i = 1; i < count; i += 2) out.push(i + 1 < count ? [i, i + 1] : [i]);
  return out;
}

/** Index of the facing partner of a page in a spread (or −1). */
export function spreadPartner(count: number, facing: boolean, index: number): number {
  if (!facing || index <= 0) return -1;
  const p = index % 2 === 1 ? index + 1 : index - 1;
  return p >= 1 && p < count ? p : -1;
}

// ---------------------------------------------------------------------------
// Master pages and overrides

/** Master items drawn on a page (not hidden by an override). */
export function masterItemsFor(doc: QuvreloDocument, page: Page): SceneNode[] {
  const master = page.masterId ? doc.masters.find((m) => m.id === page.masterId) : null;
  if (!master) return [];
  if (!page.overrides?.length) return master.nodes;
  const hidden = new Set(page.overrides);
  return master.nodes.filter((n) => !hidden.has(n.id));
}

/**
 * Override a master item on one page: the item is copied onto the page (at
 * the bottom of its stack, where master items draw) and hidden from the
 * master on that page. A text frame gets its own copy of the story so the
 * page can say something different from the master.
 */
export function overrideMasterItem(doc: QuvreloDocument, pageId: Id, masterNodeId: Id): { doc: QuvreloDocument; nodeId: Id | null } {
  const page = doc.pages.find((p) => p.id === pageId);
  const master = page?.masterId ? doc.masters.find((m) => m.id === page.masterId) : null;
  const src = master?.nodes.find((n) => n.id === masterNodeId);
  if (!page || !master || !src || page.overrides?.includes(masterNodeId)) return { doc, nodeId: null };
  let out = doc;
  const copy = cloneNode(src);
  copy.overrideOf = masterNodeId;
  out = copyStoriesForClone(out, copy);
  const already = page.nodes.filter((n) => n.overrideOf).length;
  out = addNodes(out, pageId, [copy], already);
  out = { ...out, pages: out.pages.map((p) => (p.id === pageId ? { ...p, overrides: [...(p.overrides ?? []), masterNodeId] } : p)) };
  return { doc: out, nodeId: copy.id };
}

/** Override every master item on a page. */
export function overrideAllMasterItems(doc: QuvreloDocument, pageId: Id): QuvreloDocument {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  let out = doc;
  for (const n of masterItemsFor(doc, page)) out = overrideMasterItem(out, pageId, n.id).doc;
  return out;
}

/** Remove overrides (all, or for the given master items): page copies go, master items show again. */
export function removeMasterOverrides(doc: QuvreloDocument, pageId: Id, masterNodeIds?: Id[]): QuvreloDocument {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  const which = new Set(masterNodeIds ?? page.overrides ?? []);
  const copies: Id[] = page.nodes.filter((n) => n.overrideOf && which.has(n.overrideOf)).map((n) => n.id);
  let out = removeNodes(doc, copies);
  // stories that belonged only to removed copies
  out = pruneStories(out);
  return {
    ...out,
    pages: out.pages.map((p) => {
      if (p.id !== pageId) return p;
      const left = (p.overrides ?? []).filter((id) => !which.has(id));
      const next: Page = { ...p };
      if (left.length) next.overrides = left;
      else delete next.overrides;
      return next;
    }),
  };
}

/** Drop stories no frame refers to any more. */
export function pruneStories(doc: QuvreloDocument): QuvreloDocument {
  const used = new Set<Id>();
  const visit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      if (n.type === 'textframe') used.add(n.storyId);
      if (n.type === 'group') visit(n.children);
    }
  };
  doc.pages.forEach((p) => visit(p.nodes));
  doc.masters.forEach((m) => visit(m.nodes));
  const ids = Object.keys(doc.stories);
  if (ids.every((id) => used.has(id))) return doc;
  return { ...doc, stories: Object.fromEntries(ids.filter((id) => used.has(id)).map((id) => [id, doc.stories[id]])) };
}

function copyStoriesForClone(doc: QuvreloDocument, node: SceneNode): QuvreloDocument {
  let out = doc;
  const visit = (n: SceneNode) => {
    if (n.type === 'textframe') {
      const src = out.stories[n.storyId];
      const story: Story = createStory(src?.text ?? '', src?.style ?? {});
      if (src?.spans) story.spans = src.spans.map((x) => ({ ...x }));
      if (src?.paras) story.paras = src.paras.map((x) => (x ? { ...x } : null));
      story.chain = [n.id];
      (n as { storyId: Id }).storyId = story.id;
      out = { ...out, stories: { ...out.stories, [story.id]: story } };
    }
    if (n.type === 'group') n.children.forEach(visit);
  };
  visit(node);
  return out;
}

/** Page index that holds a node (−1 for master items / not found). */
export function pageIndexOf(doc: QuvreloDocument, nodeId: Id): number {
  const loc = findNode(doc, nodeId);
  if (!loc || loc.container.kind !== 'page') return -1;
  return doc.pages.findIndex((p) => p.id === loc.container.id);
}

// ---------------------------------------------------------------------------
// Text wrap exclusions

/** World (page) matrix of a top-level or grouped node. */
function worldOf(doc: QuvreloDocument, id: Id): Matrix | null {
  const loc = findNode(doc, id);
  if (!loc) return null;
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  for (const g of loc.ancestors) m = multiply(m, nodeMatrix(g));
  return multiply(m, nodeMatrix(loc.node));
}

/** Outline of a node sampled into a polygon in its local space. */
function outlinePolygon(n: SceneNode, mode: 'box' | 'contour' | 'jump', boundsFn?: (n: SceneNode) => { x: number; y: number; w: number; h: number }): { x: number; y: number }[] {
  const b = boundsFn ? boundsFn(n) : null;
  if (mode !== 'contour' || n.type === 'group' || n.type === 'text') {
    const r = b ?? ('w' in n ? { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h } : { x: -50, y: -50, w: 100, h: 100 });
    return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  }
  const d = nodeToPath(n) ?? [];
  const pts: { x: number; y: number }[] = [];
  let cx = 0;
  let cy = 0;
  for (const c of d) {
    if (c[0] === 'M' || c[0] === 'L') {
      cx = c[1];
      cy = c[2];
      pts.push({ x: cx, y: cy });
    } else if (c[0] === 'C') {
      for (let t = 0.125; t <= 1.0001; t += 0.125) {
        const u = 1 - t;
        pts.push({
          x: u * u * u * cx + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
          y: u * u * u * cy + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
        });
      }
      cx = c[5];
      cy = c[6];
    } else if (c[0] === 'Q') {
      for (let t = 0.125; t <= 1.0001; t += 0.125) {
        const u = 1 - t;
        pts.push({ x: u * u * cx + 2 * u * t * c[1] + t * t * c[3], y: u * u * cy + 2 * u * t * c[2] + t * t * c[4] });
      }
      cx = c[3];
      cy = c[4];
    }
  }
  return pts.length >= 3 ? pts : outlinePolygon(n, 'box', boundsFn);
}

/**
 * Text-wrap exclusions affecting a text frame, in the frame's local space
 * with the origin at its top-left corner. Every other visible item on the
 * same page (and the page's master) with a wrap set takes part, like
 * InDesign's default where wrap ignores stacking order.
 */
export function frameExclusions(doc: QuvreloDocument, frameId: Id, boundsFn?: (n: SceneNode) => { x: number; y: number; w: number; h: number }, pageIndexForMaster?: number): Exclusion[] {
  const loc = findNode(doc, frameId);
  if (!loc || loc.node.type !== 'textframe') return [];
  const frame = loc.node;
  const fm = worldOf(doc, frameId);
  if (!fm) return [];
  const inv = invert(fm);
  const toFrame = (m: Matrix, p: { x: number; y: number }) => {
    const wx = m[0] * p.x + m[2] * p.y + m[4];
    const wy = m[1] * p.x + m[3] * p.y + m[5];
    return { x: inv[0] * wx + inv[2] * wy + inv[4] + frame.w / 2, y: inv[1] * wx + inv[3] * wy + inv[5] + frame.h / 2 };
  };
  let nodes: SceneNode[] = [];
  const container = getContainer(doc, loc.container.id);
  if (loc.container.kind === 'page') {
    const page = container as Page;
    nodes = [...masterItemsFor(doc, page), ...page.nodes];
  } else {
    nodes = (container as MasterPage).nodes;
    if (pageIndexForMaster !== undefined && doc.pages[pageIndexForMaster]) nodes = [...nodes, ...doc.pages[pageIndexForMaster].nodes];
  }
  const out: Exclusion[] = [];
  const visit = (list: SceneNode[], parent: Matrix) => {
    for (const n of list) {
      if (n.id === frameId || !n.visible) continue;
      const m = multiply(parent, composeTransform(n));
      if (n.wrap && n.wrap.mode !== 'none') {
        const poly = outlinePolygon(n, n.wrap.mode, boundsFn).map((p) => toFrame(m, p));
        out.push({ kind: n.wrap.mode, pts: poly, offset: Math.max(0, n.wrap.offset) });
      } else if (n.type === 'group') visit(n.children, m);
    }
  };
  visit(nodes, [1, 0, 0, 1, 0, 0]);
  return out;
}

// ---------------------------------------------------------------------------
// Auto-flow

export interface AutoFlowOptions {
  /** frame geometry for new pages: copy the last frame ('same') or fill the margins ('margins') */
  place?: 'same' | 'margins';
  maxPages?: number;
}

/**
 * Add pages (with the last frame's page master) and linked frames until the
 * story fits, like InDesign's Shift-click autoflow. `flow` lays out the story
 * in the current document. Returns the new document and the pages added.
 */
export function autoFlow(doc: QuvreloDocument, frameId: Id, flow: (d: QuvreloDocument, storyId: Id) => FlowResult | null, opts: AutoFlowOptions = {}): { doc: QuvreloDocument; pagesAdded: number } {
  const start = findNode(doc, frameId)?.node;
  if (!start || start.type !== 'textframe') return { doc, pagesAdded: 0 };
  const storyId = start.storyId;
  let out = doc;
  let added = 0;
  const max = opts.maxPages ?? 300;
  let lastEnd = -1;
  while (added < max) {
    const story = out.stories[storyId];
    const r = flow(out, storyId);
    if (!story || !r || !r.overflow) break;
    if (r.overflowAt === lastEnd) break; // the new frame took nothing (a word too big for it): stop
    lastEnd = r.overflowAt;
    const lastId = story.chain[story.chain.length - 1];
    const last = findNode(out, lastId);
    if (!last || last.node.type !== 'textframe' || last.container.kind !== 'page') break;
    const pi = out.pages.findIndex((p) => p.id === last.container.id);
    const lastFrame = last.node;
    const ins = insertPages(out, pi, 1, out.pages[pi].masterId);
    out = ins.doc;
    const pid = ins.pageIds[0];
    const s = out.settings;
    const geom = opts.place === 'margins'
      ? { x: s.margins.left + (s.width - s.margins.left - s.margins.right) / 2, y: s.margins.top + (s.height - s.margins.top - s.margins.bottom) / 2, w: s.width - s.margins.left - s.margins.right, h: s.height - s.margins.top - s.margins.bottom, rotation: 0 }
      : { x: lastFrame.x, y: lastFrame.y, w: lastFrame.w, h: lastFrame.h, rotation: lastFrame.rotation };
    const empty = createStory('', {});
    const frame = { ...cloneNode(lastFrame), ...geom, storyId: empty.id } as SceneNode;
    delete (frame as { overrideOf?: Id }).overrideOf;
    empty.chain = [frame.id];
    out = { ...out, stories: { ...out.stories, [empty.id]: empty } };
    out = addNodes(out, pid, [frame]);
    out = linkFrames(out, lastId, frame.id);
    added++;
  }
  return { doc: out, pagesAdded: added };
}

// ---------------------------------------------------------------------------
// Baseline grid

/** Grid lines (page y) in [0, height]. */
export function baselineGridLines(grid: { start: number; increment: number }, height: number, max = 5000): number[] {
  const out: number[] = [];
  if (!(grid.increment > 0)) return out;
  for (let y = grid.start; y <= height && out.length < max; y += grid.increment) if (y >= 0) out.push(y);
  return out;
}

/** The grid line nearest to `y` (snapping objects to the baseline grid). */
export function nearestGridLine(grid: { start: number; increment: number }, y: number): number {
  if (!(grid.increment > 0)) return y;
  const k = Math.max(0, Math.round((y - grid.start) / grid.increment));
  return grid.start + k * grid.increment;
}
