/**
 * Photo parity commands: adjustment layers, pixel masks, clipping masks,
 * filters with live preview, selection refinements (feather, refine edge,
 * colour range, save to mask), canvas size, straighten and liquify.
 *
 * Registered after state/commands.ts (imported by ui/App.tsx). A few
 * selection commands are re-registered here so they honour the selection's
 * feather (soft edge); with no feather they behave exactly as before.
 */
import { addNodes, updateNode, updateNodes } from '../../core/commands';
import { cloneNode, findNode, make } from '../../core/document';
import { newId } from '../../core/ids';
import { ADJUSTMENTS, adjustmentSpec, defaultParams } from '../../core/pixels';
import { DEFAULT_GRADIENT_MAP } from '../../core/photoFilters';
import type { Adjustment, AdjustmentType, RasterNode, SceneNode } from '../../core/types';
import { editor } from './editor';
import { openDialog, toast } from './bus';
import { registerCommand as reg, runCommand } from './commands';
import { activeRaster, commitRasterCanvas, createPixelLayer } from '../engine/pixelOps';
import { cloneCanvas, createCanvas, ctx2d } from '../engine/assets';
import { invert } from '../../core/geometry';
import { blendThroughSelection, selectionCanvasFor, softSelectionFrom } from '../engine/selectionPixels';
import { bakeMask, canvasSize, makeMaskCanvas, maskCoverage, setPixelMask } from '../engine/photoDoc';
import { applyLiquify, cancelLiquify } from '../engine/photoTools';

const photo = () => editor.ui.studio === 'photo';

/** The layer Photo commands act on: the selected layer, else the active layer. */
function targetLayer(): SceneNode | null {
  return editor.selectedNodes()[0] ?? editor.activeLayer();
}

// ---------------------------------------------------------------------------
// Adjustment layers

export const ADJUSTMENT_LAYER_TYPES: AdjustmentType[] = ADJUSTMENTS.filter((a) => !a.filter).map((a) => a.type);

export function newAdjustment(type: AdjustmentType): Adjustment {
  return { id: newId('adj'), type, enabled: true, params: defaultParams(type), stops: type === 'gradient-map' ? DEFAULT_GRADIENT_MAP.map((s) => ({ ...s })) : undefined };
}

/** Add an adjustment layer above the active layer (masked to the selection when there is one). */
export function addAdjustmentLayer(type: AdjustmentType): SceneNode | null {
  const doc = editor.doc;
  const c = editor.activeContainer;
  if (!doc || !c) return null;
  const W = doc.settings.width;
  const H = doc.settings.height;
  const spec = adjustmentSpec(type);
  const node = make.adjustment({ adjustment: newAdjustment(type), w: W, h: H, x: W / 2, y: H / 2, name: spec.label.replace(/ ([A-Z])/g, (m) => m.toLowerCase()) });
  let assetPatch: Record<string, ReturnType<typeof editor.assets.ref>> = {};
  if (editor.ui.pixelSelection) {
    const m = makeMaskCanvas(doc, node, editor.assets, editor.ui.pixelSelection, editor.ui.pixelSelectionFeather);
    if (m) {
      const id = editor.assets.add(m, 'image/png');
      node.pixelMask = { assetId: id, enabled: true, inverted: false };
      assetPatch = { [id]: editor.assets.ref(id, `${node.name} mask`) };
    }
  }
  const active = editor.activeLayer();
  const idx = active ? c.nodes.findIndex((n) => n.id === active.id) : -1;
  // inherit the clip of the layer it sits on, so it stays inside a clip run
  if (active?.clipped) node.clipped = true;
  editor.commit(`New ${spec.label.toLowerCase()} layer`, (d) => addNodes({ ...d, assets: { ...d.assets, ...assetPatch } }, c.id, [node], idx >= 0 ? idx + 1 : undefined));
  editor.select([node.id]);
  editor.setUi({ pixelSelection: null, pixelSelectionFeather: 0 });
  return node;
}

for (const t of ADJUSTMENT_LAYER_TYPES) reg(`layer.adjust-${t}`, () => photo() && editor.doc && void addAdjustmentLayer(t));

/** Merge an adjustment layer into the pixel layer below it (bake). */
reg('layer.merge-adjustment', () => {
  const n = targetLayer();
  if (n?.type !== 'adjustment') return toast('Select an adjustment layer');
  void runCommand('layer.merge-down');
});

// ---------------------------------------------------------------------------
// Pixel masks

function maskable(n: SceneNode | null): n is SceneNode & { w: number; h: number } {
  return !!n && 'w' in n && 'h' in n && n.type !== 'textframe';
}

function addMask(hideAll: boolean, fromSelection: boolean): boolean {
  const doc = editor.doc;
  const n = targetLayer();
  if (!doc || !maskable(n)) {
    toast('Select a pixel or adjustment layer to mask');
    return false;
  }
  if (fromSelection && !editor.ui.pixelSelection) {
    toast('Make a selection first');
    return false;
  }
  const c = makeMaskCanvas(doc, n, editor.assets, fromSelection ? editor.ui.pixelSelection : null, editor.ui.pixelSelectionFeather, hideAll);
  if (!c) return false;
  const id = editor.assets.add(c, 'image/png');
  editor.commit(n.pixelMask ? 'Replace mask' : 'Add mask', (d) => setPixelMask({ ...d, assets: { ...d.assets, [id]: editor.assets.ref(id, `${n.name} mask`) } }, n.id, { assetId: id, enabled: true, inverted: false }));
  editor.setUi({ maskEditId: n.id, ...(fromSelection ? { pixelSelection: null, pixelSelectionFeather: 0 } : {}) });
  editor.select([n.id]);
  return true;
}

reg('layer.mask-add', () => addMask(false, !!editor.ui.pixelSelection));
reg('layer.mask-hide-all', () => addMask(true, false));
reg('select.save-to-mask', () => addMask(false, true));
reg('layer.mask-edit', () => {
  const n = targetLayer();
  if (!n?.pixelMask) return toast('This layer has no pixel mask');
  editor.setUi({ maskEditId: editor.ui.maskEditId === n.id ? null : n.id });
});
reg('layer.mask-enable', () => {
  const n = targetLayer();
  if (!n?.pixelMask) return;
  editor.commit(n.pixelMask.enabled ? 'Disable mask' : 'Enable mask', (d) => setPixelMask(d, n.id, { ...n.pixelMask!, enabled: !n.pixelMask!.enabled }));
});
reg('layer.mask-invert', () => {
  const n = targetLayer();
  if (!n?.pixelMask) return;
  editor.commit('Invert mask', (d) => setPixelMask(d, n.id, { ...n.pixelMask!, inverted: !n.pixelMask!.inverted }));
});
reg('layer.mask-delete', () => {
  const n = targetLayer();
  if (!n?.pixelMask) return;
  editor.commit('Delete mask', (d) => setPixelMask(d, n.id, undefined));
  if (editor.ui.maskEditId === n.id) editor.setUi({ maskEditId: null });
});
reg('layer.mask-apply', () => {
  const n = targetLayer();
  if (n?.type !== 'raster' || !n.pixelMask) return toast('Apply mask works on a masked pixel layer');
  const c = bakeMask(n, editor.assets);
  if (!c) return;
  const id = editor.assets.add(c, 'image/png');
  editor.commit('Apply mask', (d) => updateNode({ ...d, assets: { ...d.assets, [id]: editor.assets.ref(id, n.name) } }, n.id, { assetId: id, pixelMask: undefined } as Partial<SceneNode>));
  editor.setUi({ maskEditId: null });
});
reg('layer.mask-to-selection', () => {
  const doc = editor.doc;
  const n = targetLayer();
  if (!doc || !n?.pixelMask) return toast('This layer has no pixel mask');
  const m = maskCoverage(doc, n, editor.assets);
  if (!m) return;
  // grey mask levels become partly selected pixels
  editor.setUi({ pixelSelection: softSelectionFrom(m.cover, { width: m.w, height: m.h, toWorld: m.toWorld, toPixel: invert(m.toWorld) }), pixelSelectionFeather: 0 });
});

// ---------------------------------------------------------------------------
// Clipping masks

reg('layer.clip', () => {
  const c = editor.activeContainer;
  const ids = editor.ui.selection.length ? editor.ui.selection : editor.activeLayer() ? [editor.ui.activeLayerId!] : [];
  if (!c || !ids.length) return;
  const nodes = ids.map((id) => findNode(editor.doc!, id)?.node).filter((n): n is SceneNode => !!n);
  const on = !nodes.every((n) => n.clipped);
  editor.commit(on ? 'Clip to layer below' : 'Release clipping', (d) => updateNodes(d, ids, (n) => ({ ...n, clipped: on })));
});

// ---------------------------------------------------------------------------
// Selection refinements

reg('select.none', () => editor.setUi({ pixelSelection: null, pixelSelectionFeather: 0 }));
reg('select.feather', () => (editor.ui.pixelSelection ? openDialog('feather') : toast('Make a selection first')));
reg('select.refine', () => (editor.ui.pixelSelection ? openDialog('refine-edge') : toast('Make a selection first')));
reg('select.color-range', () => editor.doc && openDialog('color-range'));
reg('select.magic-wand', () => editor.setTool('magic-wand'));

/** Run a pixel edit on a layer copy, then keep it only inside the (feathered) selection. */
function editInSelection(r: RasterNode, label: string, fn: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => void): void {
  const base = editor.assets.get(r.assetId);
  if (!base) return;
  const edited = cloneCanvas(base);
  fn(ctx2d(edited), edited);
  const cover = selectionCanvasFor(editor, r.id, base.width, base.height);
  commitRasterCanvas(editor, r.id, blendThroughSelection(base, edited, cover), label);
}

reg('select.fill', () => {
  const s = editor.ui.pixelSelection;
  if (!editor.doc || !s) return toast('Make a selection first');
  const r = activeRaster(editor) ?? createPixelLayer(editor);
  if (!r) return;
  if (r.locked) return toast(`${r.name} is locked`);
  editInSelection(r, 'Fill selection', (ctx, c) => {
    ctx.fillStyle = editor.ui.fillColor;
    ctx.fillRect(0, 0, c.width, c.height);
  });
});
reg('select.clear', () => {
  const s = editor.ui.pixelSelection;
  const r = activeRaster(editor);
  if (!s || !r) return toast('Select a pixel layer and make a selection');
  if (r.locked) return toast(`${r.name} is locked`);
  editInSelection(r, 'Clear', (ctx, c) => ctx.clearRect(0, 0, c.width, c.height));
});
reg('select.copy-to-layer', () => {
  const doc = editor.doc;
  const s = editor.ui.pixelSelection;
  const r = activeRaster(editor) ?? (editor.activeContainer?.nodes.slice().reverse().find((x) => x.type === 'raster' && x.visible) as RasterNode | undefined) ?? null;
  if (!doc || !s || !r) return toast('Select a pixel layer and make a selection');
  const base = editor.assets.rendered(r.assetId, r.adjustments, false);
  if (!base) return;
  const cover = selectionCanvasFor(editor, r.id, base.width, base.height);
  const c = createCanvas(base.width, base.height);
  const ctx = ctx2d(c);
  ctx.drawImage(base, 0, 0);
  if (cover) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(cover, 0, 0);
  }
  const node = { ...cloneNode(r), adjustments: [], name: r.name + ' (copy)', mask: undefined, pixelMask: undefined };
  const container = editor.activeContainer!;
  const idx = container.nodes.findIndex((n) => n.id === r.id);
  editor.commit('Copy selection to layer', (d) => addNodes(d, container.id, [node], idx + 1));
  commitRasterCanvas(editor, node.id, c, 'Copy selection to layer');
  editor.select([node.id]);
});

// ---------------------------------------------------------------------------
// Filters (live preview dialog; Liquify is a modal tool)

export const FILTER_TYPES: AdjustmentType[] = ['blur', 'motion-blur', 'sharpen', 'noise', 'reduce-noise'];
const FILTER_IDS: Record<string, AdjustmentType> = {
  'filter.gaussian-blur': 'blur', 'filter.motion-blur': 'motion-blur', 'filter.unsharp-mask': 'sharpen', 'filter.add-noise': 'noise', 'filter.reduce-noise': 'reduce-noise',
  'filter.vignette': 'vignette',
};
for (const [id, type] of Object.entries(FILTER_IDS)) {
  reg(id, () => {
    if (!photo()) return;
    const r = activeRaster(editor);
    if (!r) return toast('Select a pixel layer to filter');
    if (r.locked) return toast(`${r.name} is locked`);
    openDialog('photo-filter', { type });
  });
}
reg('filter.liquify', () => {
  if (!activeRaster(editor)) return toast('Select a pixel layer to liquify');
  editor.setTool('liquify');
  editor.setUi({ status: 'Liquify: drag to warp · Enter applies · Esc cancels' });
});
reg('liquify.apply', () => {
  applyLiquify(editor);
  editor.setTool('move');
});
reg('liquify.cancel', () => {
  cancelLiquify();
  editor.setTool('move');
});

// ---------------------------------------------------------------------------
// Canvas size, straighten

reg('doc.canvas-size', () => editor.doc && openDialog('canvas-size'));

export { canvasSize };
export { straighten } from './straighten';
