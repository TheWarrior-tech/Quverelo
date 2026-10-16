/**
 * Preflight: checks a document for print problems before export, like
 * InDesign's Preflight panel. Built-in checks cover overset text (frames and
 * table cells), missing fonts, low-resolution and missing images, and items
 * left entirely off the page. Other specialists add checks through
 * registerPreflightCheck (the colour specialist registers RGB-in-CMYK there).
 */
import { imageFrameContentRect } from './svg';
import { firstFamily } from './pdfFonts';
import { nodeBounds } from './document';
import { styledParagraphs, sheetOf } from './typography';
import { oversetCells } from './tables';
import type { FlowResult, MeasureFn } from './textflow';
import type { Id, QuvreloDocument, SceneNode } from './types';

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightIssue {
  /** stable id of the issue (check + subject) */
  id: string;
  check: string;
  severity: PreflightSeverity;
  message: string;
  detail?: string;
  /** page index, or −1 for master pages */
  pageIndex: number;
  containerId?: Id;
  nodeId?: Id;
}

export interface PreflightEnv {
  /** lay out a story in this document */
  flow: (doc: QuvreloDocument, storyId: Id) => FlowResult | null;
  measure: MeasureFn;
  /** whether a font family can be drawn on this machine */
  fontAvailable: (family: string) => boolean;
  /** pixel size of an asset when known (defaults to the document's asset metadata) */
  assetSize?: (assetId: Id) => { width: number; height: number } | null;
  /** effective resolution below which an image is flagged (default 150 ppi; below 72 is an error) */
  minPpi?: number;
}

export interface PreflightCheckDef {
  id: string;
  label: string;
  run: (doc: QuvreloDocument, env: PreflightEnv) => PreflightIssue[];
}

const registry = new Map<string, PreflightCheckDef>();

/** Add (or replace) a preflight check. Returns an unregister function. */
export function registerPreflightCheck(def: PreflightCheckDef): () => void {
  registry.set(def.id, def);
  return () => {
    if (registry.get(def.id) === def) registry.delete(def.id);
  };
}

export function preflightChecks(): PreflightCheckDef[] {
  return [...registry.values()];
}

/** Run every registered check (minus `disabled`), errors first, then by page. */
export function runPreflight(doc: QuvreloDocument, env: PreflightEnv, disabled: string[] = []): PreflightIssue[] {
  const off = new Set(disabled);
  const out: PreflightIssue[] = [];
  for (const c of registry.values()) {
    if (off.has(c.id)) continue;
    try {
      out.push(...c.run(doc, env));
    } catch (e) {
      out.push({ id: `${c.id}:crash`, check: c.id, severity: 'warning', message: `${c.label} could not run`, detail: (e as Error).message, pageIndex: -1 });
    }
  }
  const rank: Record<PreflightSeverity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || pageSort(a.pageIndex) - pageSort(b.pageIndex));
}
const pageSort = (i: number) => (i < 0 ? 1e9 : i);

/** Visit every node with its page index (−1 = master) and container id. */
export function eachNode(doc: QuvreloDocument, fn: (n: SceneNode, pageIndex: number, containerId: Id, scale: number) => void): void {
  const visit = (nodes: SceneNode[], pi: number, cid: Id, scale: number) => {
    for (const n of nodes) {
      const s = scale * Math.max(Math.abs(n.scaleX), Math.abs(n.scaleY));
      fn(n, pi, cid, s);
      if (n.type === 'group') visit(n.children, pi, cid, s);
    }
  };
  doc.pages.forEach((p, i) => visit(p.nodes, i, p.id, 1));
  doc.masters.forEach((m) => visit(m.nodes, -1, m.id, 1));
}

function containerOfFrame(doc: QuvreloDocument, frameId: Id): { pageIndex: number; containerId: Id } {
  let found = { pageIndex: -1, containerId: '' };
  eachNode(doc, (n, pi, cid) => {
    if (n.id === frameId) found = { pageIndex: pi, containerId: cid };
  });
  return found;
}

const short = (s: string, n = 32) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
};

// ---------------------------------------------------------------------------
// Built-in checks

registerPreflightCheck({
  id: 'overset-text',
  label: 'Overset text',
  run(doc, env) {
    const out: PreflightIssue[] = [];
    for (const story of Object.values(doc.stories)) {
      if (!story.chain.length || !story.text.trim()) continue;
      const r = env.flow(doc, story.id);
      if (!r || !r.overflow) continue;
      const last = story.chain[story.chain.length - 1];
      const where = containerOfFrame(doc, last);
      const hidden = story.text.slice(r.overflowAt);
      const words = hidden.trim() ? hidden.trim().split(/\s+/).length : 0;
      out.push({
        id: `overset-text:${story.id}`, check: 'overset-text', severity: 'error',
        message: 'Overset text', detail: `${words} word${words === 1 ? '' : 's'} hidden after “${short(story.text.slice(Math.max(0, r.overflowAt - 24), r.overflowAt))}”`,
        pageIndex: where.pageIndex, containerId: where.containerId, nodeId: last,
      });
    }
    const sheet = sheetOf(doc);
    eachNode(doc, (n, pi, cid) => {
      if (n.type !== 'table') return;
      const cells = oversetCells(n, sheet, env.measure);
      if (cells.length) {
        out.push({
          id: `overset-text:${n.id}`, check: 'overset-text', severity: 'error', message: 'Overset table cell' + (cells.length > 1 ? 's' : ''),
          detail: cells.slice(0, 4).map(({ r, c }) => `row ${r + 1}, column ${c + 1}`).join('; ') + (cells.length > 4 ? '…' : ''),
          pageIndex: pi, containerId: cid, nodeId: n.id,
        });
      }
    });
    return out;
  },
});

/** Every font family the document uses, with one node that uses it. */
export function fontsUsed(doc: QuvreloDocument): Map<string, { nodeId?: Id; pageIndex: number; containerId?: Id }> {
  const used = new Map<string, { nodeId?: Id; pageIndex: number; containerId?: Id }>();
  const add = (stack: string | undefined, where: { nodeId?: Id; pageIndex: number; containerId?: Id }) => {
    if (!stack) return;
    const fam = firstFamily(stack);
    if (fam && !used.has(fam)) used.set(fam, where);
  };
  const sheet = sheetOf(doc);
  const frameWhere = new Map<Id, { nodeId: Id; pageIndex: number; containerId: Id }>();
  eachNode(doc, (n, pi, cid) => {
    if (n.type === 'textframe') frameWhere.set(n.storyId, { nodeId: n.id, pageIndex: pi, containerId: cid });
    if (n.type === 'text') add(n.style.fontFamily, { nodeId: n.id, pageIndex: pi, containerId: cid });
    if (n.type === 'table') {
      for (const row of n.cells) for (const c of row) {
        add(c.props?.text?.fontFamily, { nodeId: n.id, pageIndex: pi, containerId: cid });
        const named = c.styleId ? sheet.cell.find((s) => s.id === c.styleId) : null;
        add(named?.props.text?.fontFamily, { nodeId: n.id, pageIndex: pi, containerId: cid });
      }
    }
  });
  for (const story of Object.values(doc.stories)) {
    const where = frameWhere.get(story.id) ?? { pageIndex: -1 };
    if (!story.text) {
      add(story.style.fontFamily, where);
      continue;
    }
    for (const p of styledParagraphs(story, sheet)) {
      if (!p.runs.length) add(p.style.fontFamily, where);
      for (const r of p.runs) add(r.style.fontFamily, where);
    }
  }
  return used;
}

registerPreflightCheck({
  id: 'missing-fonts',
  label: 'Missing fonts',
  run(doc, env) {
    const out: PreflightIssue[] = [];
    for (const [fam, where] of fontsUsed(doc)) {
      if (env.fontAvailable(fam)) continue;
      out.push({ id: `missing-fonts:${fam}`, check: 'missing-fonts', severity: 'error', message: `Missing font: ${fam}`, detail: 'Text set in it is drawn with a fallback font', pageIndex: where.pageIndex, containerId: where.containerId, nodeId: where.nodeId });
    }
    return out;
  },
});

/** Effective resolution (pixels per inch at print size) of a placed image. */
export function effectivePpi(pixelsW: number, pixelsH: number, displayW: number, displayH: number): number {
  const inchesW = Math.abs(displayW) / 96;
  const inchesH = Math.abs(displayH) / 96;
  if (inchesW <= 0 || inchesH <= 0) return Infinity;
  return Math.min(pixelsW / inchesW, pixelsH / inchesH);
}

registerPreflightCheck({
  id: 'images',
  label: 'Image resolution',
  run(doc, env) {
    const out: PreflightIssue[] = [];
    const min = env.minPpi ?? 150;
    const sizeOf = (id: Id) => env.assetSize?.(id) ?? (doc.assets[id] ? { width: doc.assets[id].width, height: doc.assets[id].height } : null);
    eachNode(doc, (n, pi, cid, scale) => {
      if (n.type !== 'imageframe' && n.type !== 'raster') return;
      if (n.type === 'imageframe' && !n.assetId) {
        out.push({ id: `images:empty:${n.id}`, check: 'images', severity: 'info', message: 'Empty picture frame', pageIndex: pi, containerId: cid, nodeId: n.id });
        return;
      }
      const assetId = n.assetId!;
      const px = sizeOf(assetId);
      if (!px || !px.width) {
        out.push({ id: `images:missing:${n.id}`, check: 'images', severity: 'error', message: 'Missing image', detail: 'The picture this frame links to is not in the document', pageIndex: pi, containerId: cid, nodeId: n.id });
        return;
      }
      let dw = n.w * scale;
      let dh = n.h * scale;
      if (n.type === 'imageframe') {
        const r = imageFrameContentRect(n, px.width, px.height);
        dw = r.w * scale;
        dh = r.h * scale;
      }
      const ppi = effectivePpi(px.width, px.height, dw, dh);
      if (ppi < min) {
        out.push({
          id: `images:lowres:${n.id}`, check: 'images', severity: ppi < 72 ? 'error' : 'warning', message: 'Low-resolution image',
          detail: `${Math.round(ppi)} ppi at this size (${min} ppi or more recommended for print)`, pageIndex: pi, containerId: cid, nodeId: n.id,
        });
      }
    });
    return out;
  },
});

registerPreflightCheck({
  id: 'off-page',
  label: 'Items off the page',
  run(doc) {
    const out: PreflightIssue[] = [];
    const { width: W, height: H, bleed } = doc.settings;
    doc.pages.forEach((p, pi) => {
      for (const n of p.nodes) {
        if (!n.visible) continue;
        const b = nodeBounds(n);
        if (b.x > W + bleed || b.y > H + bleed || b.x + b.w < -bleed || b.y + b.h < -bleed) {
          out.push({ id: `off-page:${n.id}`, check: 'off-page', severity: 'warning', message: 'Item on the pasteboard', detail: `${n.name} is outside the page and won’t print`, pageIndex: pi, containerId: p.id, nodeId: n.id });
        }
      }
    });
    return out;
  },
});
