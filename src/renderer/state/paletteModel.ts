/**
 * Pure rules behind the command palette: why a command is unavailable right
 * now, and synonyms for tools. No editor or DOM imports, so it is unit-tested.
 */
import type { ToolId } from './editor';

export interface PaletteContext {
  hasDoc: boolean;
  selection: number;
  /** Number of selected groups / text frames. */
  groups: number;
  textFrames: number;
  pixelSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  pages: number;
  pageIndex: number;
  studio: 'photo' | 'vector' | 'layout';
}

/** Commands that work with no document open. */
const NO_DOC_OK = /^(file\.(new|open)|app\.preferences|help\.|view\.(theme-|ui-))/;

/**
 * One short line saying why `id` can't run right now ("Needs a pixel
 * selection"), or null when it can. Advisory: handlers stay defensive.
 */
export function disabledReason(id: string, c: PaletteContext): string | null {
  if (!c.hasDoc) return NO_DOC_OK.test(id) ? null : 'Open or create a document first';
  const needSel = (n = 1, what = n > 1 ? `Select ${n} or more objects` : 'Select an object first') => (c.selection < n ? what : null);
  switch (id) {
    case 'edit.undo':
      return c.canUndo ? null : 'Nothing to undo';
    case 'edit.redo':
      return c.canRedo ? null : 'Nothing to redo';
    case 'edit.cut':
    case 'edit.copy':
    case 'edit.duplicate':
    case 'layer.lock':
    case 'layer.hide':
    case 'layer.convert-curves':
    case 'layer.rasterize':
      return needSel();
    case 'edit.delete':
      return c.selection || (c.pixelSelection && c.studio === 'photo') ? null : 'Select an object first';
    case 'arrange.group':
      return needSel(2);
    case 'arrange.ungroup':
      return c.groups ? null : 'Select a group first';
    case 'arrange.distribute-h':
    case 'arrange.distribute-v':
      return needSel(3);
    case 'layer.bool-add':
    case 'layer.bool-subtract':
    case 'layer.bool-intersect':
    case 'layer.bool-exclude':
    case 'layer.bool-divide':
      return needSel(2, 'Select two or more shapes');
    case 'layer.mask-shape':
      return needSel(2, 'Select an image and the shape above it');
    case 'layer.mask-selection':
    case 'select.crop':
    case 'select.fill':
    case 'select.clear':
    case 'select.copy-to-layer':
    case 'select.none':
      return c.pixelSelection ? null : 'Needs a pixel selection';
    case 'text.link':
      return c.textFrames === 2 ? null : 'Select two text frames';
    case 'text.unlink':
      return c.textFrames ? null : 'Select a text frame';
    case 'page.delete':
      return c.pages > 1 ? null : 'The document has only one page';
    case 'page.prev':
      return c.pageIndex > 0 ? null : 'Already on the first page';
    case 'page.next':
      return c.pageIndex >= 0 && c.pageIndex < c.pages - 1 ? null : 'Already on the last page';
  }
  if (/^arrange\.(front|forward|backward|back|align-|flip-|rotate-)/.test(id)) return needSel();
  return null;
}

/** What people call each tool, so "bucket" finds Flood Fill and "circle" finds Ellipse. */
export const TOOL_KEYWORDS: Partial<Record<ToolId, string[]>> = {
  move: ['select', 'pointer', 'arrow', 'transform', 'resize'],
  node: ['direct selection', 'edit points', 'anchor', 'handles'],
  hand: ['pan', 'scroll', 'grab'],
  zoom: ['magnify', 'magnifier'],
  'marquee-rect': ['select', 'selection', 'rectangle select', 'box select'],
  'marquee-ellipse': ['select', 'selection', 'circle select', 'oval'],
  lasso: ['lasso', 'freehand selection', 'select'],
  crop: ['trim', 'cut', 'straighten'],
  brush: ['paint', 'draw', 'pen'],
  eraser: ['rubber', 'erase', 'delete pixels'],
  fill: ['bucket', 'paint bucket', 'flood'],
  eyedropper: ['colour picker', 'color picker', 'sample', 'pipette'],
  text: ['type', 'font', 'words', 'heading', 'title'],
  textframe: ['text box', 'columns', 'paragraph', 'story'],
  imageframe: ['picture', 'image', 'placeholder', 'photo frame'],
  pen: ['bezier', 'path', 'curve'],
  pencil: ['freehand', 'sketch', 'draw'],
  rect: ['square', 'box', 'rectangle'],
  ellipse: ['circle', 'oval'],
  polygon: ['hexagon', 'triangle', 'pentagon'],
  star: ['burst', 'badge'],
  line: ['rule', 'divider', 'stroke'],
};

/** Most recent first, deduplicated, capped. */
export function pushRecent(list: readonly string[], id: string, max = 5): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
