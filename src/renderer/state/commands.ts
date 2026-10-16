/**
 * Command registry. Every menu item, toolbar button and shortcut runs through
 * runCommand(id), so behaviour is identical however a command is invoked and
 * end-to-end tests can drive the app by id.
 */
import {
  addMaster, addPage, alignNodes, arrange, convertToCurves, cropDocument, distributeNodes, duplicateNodes,
  duplicatePage, flipNodes, groupNodes, linkFrames, nudgeNodes, pathNodeFromWorld, releaseMask, removeNodes,
  removePage, rotateNodes, setMaskFromWorldPath, ungroup, unlinkFrame, updateNodes, worldPath, addNodes, updateNode,
  type AlignMode,
} from '../../core/commands';
import { booleanPaths, type BooleanOp } from '../../core/boolean';
import { composeTransform, invert } from '../../core/geometry';
import { cloneNode, findNode, getContainer, make } from '../../core/document';
import { pathBounds, rectPath, translatePath } from '../../core/path';
import { newId } from '../../core/ids';
import type { QuvreloDocument, Id, PathNode, RasterNode, SceneNode } from '../../core/types';
import { editor, type ToolId } from './editor';
import { closeDialog, openDialog, toast } from './bus';
import * as io from './io';
import type { Viewport } from '../engine/Viewport';
import { isEditable } from '../engine/Viewport';
import { cycleTool, groupOf, toolForKeyIn, toolName, TOOL_KEYS } from './toolGroups';
import { activeRaster, commitRasterCanvas, createPixelLayer, editRaster, selectionInPixels } from '../engine/pixelOps';
import { createCanvas, ctx2d, cloneCanvas } from '../engine/assets';
import { rasterView, resultToWorldPath, runSelectSubject } from '../engine/mlSelect';
import { markStep } from './onboarding';
import { drawNodeTransformed } from '../engine/draw';
import { applyCrop, cancelCrop } from './crop';
import { registerVectorCommands } from './vectorCommands';

let viewport: Viewport | null = null;
export function setViewport(v: Viewport | null): void {
  viewport = v;
}
export function getViewport(): Viewport | null {
  return viewport;
}

type Handler = () => unknown;
const handlers = new Map<string, Handler>();

function reg(id: string, fn: Handler) {
  handlers.set(id, fn);
}

export function hasCommand(id: string): boolean {
  return handlers.has(id);
}

export async function runCommand(id: string): Promise<void> {
  const h = handlers.get(id);
  if (!h) {
    console.warn('Unknown command', id);
    return;
  }
  try {
    await h();
  } catch (e) {
    console.error(e);
    toast(`${(e as Error).message}`, 'error');
  }
}

const sel = () => editor.ui.selection;
const needDoc = () => !!editor.doc;
const bounds = (n: SceneNode) => (viewport ? viewport.boundsOf(n) : { x: n.x, y: n.y, w: 0, h: 0 });

function editingText(): boolean {
  return isEditable(document.activeElement);
}

// ---------------------------------------------------------------------------
// File

reg('file.new', () => openDialog('new'));
reg('file.open', () => io.openDialogAndLoad());
reg('file.close', async () => {
  if (!editor.session) return;
  if (editor.history?.dirty) {
    openDialog('confirm', {
      // name the object in the question (Figma / macOS pattern, critique 3 P2-7)
      title: `Save changes to “${editor.doc?.title || 'Untitled'}” before closing?`,
      message: "Your changes will be lost if you don't save them.",
      actions: [
        { label: 'Save', primary: true, run: async () => { if (await io.save()) editor.closeSession(); } },
        { label: "Don't save", run: () => { void window.quvrelo.deleteRecovery(editor.session!.recoveryId); editor.closeSession(); } },
        { label: 'Cancel', run: () => undefined },
      ],
    });
    return;
  }
  editor.closeSession();
});
reg('file.save', () => void io.save(false));
reg('file.save-as', () => void io.save(true));
reg('file.save-and-quit', async () => {
  if (await io.save(false)) window.quvrelo.quitNow();
});
reg('file.place', () => io.placeImages());
reg('file.import-svg', () => io.importSvgFile());
reg('file.export', () => {
  if (!needDoc()) return;
  if (!io.enabledExportFormats().length) return toast('Export is turned off by your administrator');
  openDialog('export', { format: io.exportFormatFor() });
});
reg('file.export-again', () => needDoc() && io.exportAgain());
for (const f of ['png', 'jpg', 'svg', 'pdf'] as const) reg(`file.export-${f}`, () => needDoc() && openDialog('export', { format: f }));
reg('file.document-setup', () => needDoc() && openDialog('document-setup'));
reg('file.assignment', () => needDoc() && openDialog('assignment'));
reg('file.hand-in', () => needDoc() && openDialog('hand-in'));
reg('app.preferences', () => openDialog('preferences'));

// ---------------------------------------------------------------------------
// Edit

reg('edit.undo', () => {
  if (editingText()) return window.quvrelo.nativeEdit('undo');
  viewport?.textEdit.end();
  editor.history?.undo();
});
reg('edit.redo', () => {
  if (editingText()) return window.quvrelo.nativeEdit('redo');
  editor.history?.redo();
});
reg('edit.copy', () => {
  if (editingText()) return window.quvrelo.nativeEdit('copy');
  const c = io.cloneForClipboard(sel());
  if (c && c.nodes.length) {
    editor.clipboard = c;
    toast(`Copied ${c.nodes.length} object${c.nodes.length > 1 ? 's' : ''}`);
  }
});
reg('edit.cut', () => {
  if (editingText()) return window.quvrelo.nativeEdit('cut');
  const c = io.cloneForClipboard(sel());
  if (!c || !c.nodes.length) return;
  editor.clipboard = c;
  editor.commit('Cut', (d) => removeNodes(d, sel()));
  editor.select([]);
  editor.ensureActiveLayer();
});
reg('edit.paste', async () => {
  if (editingText()) return window.quvrelo.nativeEdit('paste');
  if (!editor.doc) return;
  const clip = editor.clipboard;
  if (!clip) {
    if (!(await io.pasteSystemImage())) toast('Nothing to paste');
    return;
  }
  const container = editor.activeContainer!;
  // fresh ids; text frames get fresh stories so pasted copies don't join the original chain
  const storyMap = new Map<Id, Id>();
  const stories: QuvreloDocument['stories'] = {};
  const nodes = clip.nodes.map((n) => {
    const c = cloneNode(n);
    const fix = (x: SceneNode) => {
      if (x.type === 'textframe') {
        const src = clip.stories[x.storyId];
        const sid = newId('st');
        storyMap.set(x.storyId, sid);
        stories[sid] = { id: sid, text: src?.text ?? '', style: src?.style ?? editor.doc!.stories[x.storyId]?.style, chain: [x.id] } as QuvreloDocument['stories'][string];
        (x as { storyId: Id }).storyId = sid;
      }
      if (x.type === 'group') x.children.forEach(fix);
    };
    fix(c);
    const onSame = clip.nodes.length && findNode(editor.doc!, n.id)?.container.id === container.id;
    if (onSame) {
      c.x += 16;
      c.y += 16;
    }
    return c;
  });
  editor.commit('Paste', (d) => addNodes({ ...d, stories: { ...d.stories, ...stories } }, container.id, nodes));
  editor.select(nodes.map((n) => n.id));
  // next paste offsets again
  editor.clipboard = { nodes: nodes.map((n) => JSON.parse(JSON.stringify(n))), stories: { ...clip.stories, ...stories } };
});
reg('edit.duplicate', () => {
  if (!sel().length) return;
  let ids: Id[] = [];
  editor.commit('Duplicate', (d) => {
    const r = duplicateNodes(d, sel());
    ids = r.ids;
    return r.doc;
  });
  editor.select(ids);
});
reg('edit.delete', () => {
  if (editingText()) return;
  if (!sel().length) {
    if (editor.ui.pixelSelection && editor.ui.studio === 'photo') return runCommand('select.clear');
    return;
  }
  editor.commit('Delete', (d) => removeNodes(d, sel()));
  editor.select([]);
  editor.ensureActiveLayer();
});
reg('edit.select-all', () => {
  if (editingText()) return window.quvrelo.nativeEdit('selectAll');
  const c = editor.activeContainer;
  if (!c) return;
  editor.select(c.nodes.filter((n) => !n.locked && n.visible).map((n) => n.id));
});
reg('edit.deselect', () => {
  editor.select([]);
  editor.setUi({ pixelSelection: null });
});

// ---------------------------------------------------------------------------
// Arrange

for (const op of ['front', 'forward', 'backward', 'back'] as const) {
  reg(`arrange.${op}`, () => sel().length && editor.commit('Arrange', (d) => arrange(d, sel(), op)));
}
reg('arrange.group', () => {
  if (sel().length < 2) return;
  let gid: Id | null = null;
  editor.commit('Group', (d) => {
    const r = groupNodes(d, sel(), bounds);
    gid = r.groupId;
    return r.doc;
  });
  if (gid) editor.select([gid]);
});
reg('arrange.ungroup', () => {
  const groups = editor.selectedNodes().filter((n) => n.type === 'group');
  if (!groups.length) return;
  let ids: Id[] = [];
  editor.commit('Ungroup', (d) => {
    let out = d;
    for (const g of groups) {
      const r = ungroup(out, g.id);
      out = r.doc;
      ids = ids.concat(r.ids);
    }
    return out;
  });
  editor.select(ids);
});
for (const mode of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as AlignMode[]) {
  reg(`arrange.align-${mode}`, () => {
    const doc = editor.doc;
    if (!doc || !sel().length) return;
    // a single object aligns to the page (or its margins in layout); Align to can pick the page, the first or last selected
    const to = editor.ui.toolOptions.alignTo;
    const ids = sel();
    const keyOf = (id: string) => {
      const loc = findNode(doc, id);
      return loc ? bounds(loc.node) : null;
    };
    const target = to === 'page' || (to === 'auto' && ids.length === 1) ? pageRect(doc)
      : to === 'first' && ids.length > 1 ? keyOf(ids[0])
      : to === 'last' && ids.length > 1 ? keyOf(ids[ids.length - 1])
      : null;
    editor.commit('Align', (d) => alignNodes(d, sel(), mode, target, bounds));
  });
}
function pageRect(doc: QuvreloDocument) {
  if (editor.ui.studio === 'layout') {
    const m = doc.settings.margins;
    return { x: m.left, y: m.top, w: doc.settings.width - m.left - m.right, h: doc.settings.height - m.top - m.bottom };
  }
  return { x: 0, y: 0, w: doc.settings.width, h: doc.settings.height };
}
reg('arrange.distribute-h', () => editor.commit('Distribute', (d) => distributeNodes(d, sel(), 'h', bounds)));
reg('arrange.distribute-v', () => editor.commit('Distribute', (d) => distributeNodes(d, sel(), 'v', bounds)));
reg('arrange.flip-h', () => sel().length && editor.commit('Flip', (d) => flipNodes(d, sel(), 'h')));
reg('arrange.flip-v', () => sel().length && editor.commit('Flip', (d) => flipNodes(d, sel(), 'v')));
reg('arrange.rotate-cw', () => sel().length && editor.commit('Rotate', (d) => rotateNodes(d, sel(), 90)));
reg('arrange.rotate-ccw', () => sel().length && editor.commit('Rotate', (d) => rotateNodes(d, sel(), -90)));
for (const [dir, dx, dy] of [['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]] as const) {
  reg(`nudge.${dir}`, () => sel().length && editor.commit('Nudge', (d) => nudgeNodes(d, sel(), dx, dy), 'nudge'));
  reg(`nudge.${dir}-10`, () => sel().length && editor.commit('Nudge', (d) => nudgeNodes(d, sel(), dx * 10, dy * 10), 'nudge'));
}

// ---------------------------------------------------------------------------
// Layer

reg('layer.new-pixel', () => needDoc() && void createPixelLayer(editor));
reg('layer.rasterize', () => {
  const doc = editor.doc;
  const n = editor.selectedNodes()[0];
  if (!doc || !n) return;
  if (n.type === 'raster' && n.adjustments.length) {
    // bake the adjustment stack into the pixels
    const c = editor.assets.rendered(n.assetId, n.adjustments, false);
    if (!c) return;
    const id = editor.assets.add(cloneCanvas(c));
    editor.commit('Apply adjustments', (d) => updateNode({ ...d, assets: { ...d.assets, [id]: editor.assets.ref(id, n.name) } }, n.id, { assetId: id, adjustments: [] } as Partial<SceneNode>));
    return;
  }
  if (n.type === 'raster') return;
  const b = bounds(n);
  const pad = 2;
  const w = Math.ceil(b.w + pad * 2);
  const h = Math.ceil(b.h + pad * 2);
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.translate(-b.x + pad, -b.y + pad);
  drawNodeTransformed(ctx, { ...n, opacity: 1, blend: 'normal' }, { doc, assets: editor.assets, editor: false, preview: false, zoom: 1 });
  const id = editor.assets.add(c);
  const raster = make.raster({ assetId: id, w, h, x: b.x - pad + w / 2, y: b.y - pad + h / 2, name: n.name, opacity: n.opacity, blend: n.blend });
  raster.id = n.id;
  editor.commit('Rasterise', (d) => updateNode({ ...d, assets: { ...d.assets, [id]: editor.assets.ref(id, n.name) } }, n.id, () => raster));
});
reg('layer.merge-down', () => {
  const doc = editor.doc;
  const c = editor.activeContainer;
  const n = editor.selectedNodes()[0];
  if (!doc || !c || !n) return;
  const i = c.nodes.findIndex((x) => x.id === n.id);
  const below = c.nodes[i - 1];
  if (i <= 0 || !below || below.type !== 'raster') {
    toast('Merging down needs a pixel layer underneath');
    return;
  }
  const base = editor.assets.rendered(below.assetId, below.adjustments, false);
  if (!base) return;
  const work = cloneCanvas(base);
  const ctx = ctx2d(work);
  // draw the upper node into the lower layer's pixel space
  const m = invert(composeTransform(below));
  ctx.setTransform(work.width / below.w, 0, 0, work.height / below.h, 0, 0);
  ctx.translate(below.w / 2, below.h / 2);
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  drawNodeTransformed(ctx, n, { doc, assets: editor.assets, editor: false, preview: false, zoom: 1 });
  const id = editor.assets.add(work);
  editor.commit('Merge down', (d) => {
    let out = removeNodes(d, [n.id]);
    out = { ...out, assets: { ...out.assets, [id]: editor.assets.ref(id, below.name) } };
    return updateNode(out, below.id, { assetId: id, adjustments: [], w: below.w, h: below.h } as Partial<SceneNode>);
  });
  editor.select([below.id]);
});
/** The layer pixel-selection actions apply to: the selected layer, else the topmost visible photo layer. */
function selectionTargetLayer(): SceneNode | null {
  const n = editor.selectedNodes()[0] ?? editor.activeLayer();
  if (n) return n;
  const c = editor.activeContainer;
  return (c && [...c.nodes].reverse().find((x) => x.type === 'raster' && x.visible !== false)) || null;
}
/** The photo layer for pixel commands: the selected pixel layer, else the topmost visible one. */
function photoLayer(): RasterNode | null {
  const r = activeRaster(editor);
  if (r) return r;
  const c = editor.activeContainer;
  return ((c && [...c.nodes].reverse().find((x) => x.type === 'raster' && x.visible !== false)) as RasterNode | undefined) ?? null;
}
reg('layer.mask-selection', () => {
  const s = editor.ui.pixelSelection;
  const n = selectionTargetLayer();
  if (!s || !n) {
    toast('Make a pixel selection and select a layer first');
    return;
  }
  editor.commit('Mask to selection', (d) => setMaskFromWorldPath(d, n.id, s));
  editor.setUi({ pixelSelection: null });
});
reg('layer.mask-shape', () => {
  // use the selected shape (topmost) as a mask for the object directly below it
  const doc = editor.doc;
  const c = editor.activeContainer;
  const n = editor.selectedNodes()[0];
  if (!doc || !c || !n) return;
  const i = c.nodes.findIndex((x) => x.id === n.id);
  const below = c.nodes[i - 1];
  const wp = worldPath(doc, n.id);
  if (!below || !wp) {
    toast('Select a shape that sits above the object to mask');
    return;
  }
  editor.commit('Mask with shape', (d) => removeNodes(setMaskFromWorldPath(d, below.id, wp), [n.id]));
  editor.select([below.id]);
});
reg('layer.release-mask', () => {
  const ids = editor.selectedNodes().filter((n) => n.mask).map((n) => n.id);
  if (!ids.length) return;
  editor.commit('Release mask', (d) => ids.reduce((acc, id) => releaseMask(acc, id), d));
});
reg('layer.convert-curves', () => {
  const ids = sel();
  if (!ids.length) return;
  editor.commit('Convert to curves', (d) => ids.reduce((acc, id) => convertToCurves(acc, id), d));
});
for (const op of ['add', 'subtract', 'intersect', 'exclude', 'divide'] as BooleanOp[]) {
  reg(`layer.bool-${op}`, () => {
    const doc = editor.doc;
    const c = editor.activeContainer;
    if (!doc || !c) return;
    // order by stacking (bottom first) so subtract removes upper shapes from the lowest
    const ids = c.nodes.filter((n) => sel().includes(n.id)).map((n) => n.id);
    const paths = ids.map((id) => worldPath(doc, id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (paths.length < 2) {
      toast('Select two or more shapes');
      return;
    }
    const result = booleanPaths(paths, op);
    const first = findNode(doc, ids[0])!.node as PathNode;
    const style = { fill: 'fill' in first ? first.fill : make.path().fill, stroke: 'stroke' in first ? first.stroke : make.path().stroke };
    const nodes = result.map((d) => pathNodeFromWorld(d, { ...style, name: op === 'divide' ? 'Piece' : 'Compound' }));
    const index = c.nodes.findIndex((n) => n.id === ids[0]);
    editor.commit(`Boolean ${op}`, (d) => addNodes(removeNodes(d, ids), c.id, nodes, index));
    editor.select(nodes.map((n) => n.id));
  });
}
reg('layer.lock', () => sel().length && editor.commit('Lock', (d) => updateNodes(d, sel(), (n) => ({ ...n, locked: !n.locked }))));
reg('layer.hide', () => sel().length && editor.commit('Visibility', (d) => updateNodes(d, sel(), (n) => ({ ...n, visible: !n.visible }))));

// ---------------------------------------------------------------------------
// Pixel selection

function pageSelection(doc: QuvreloDocument) {
  return translatePath(rectPath(doc.settings.width, doc.settings.height), doc.settings.width / 2, doc.settings.height / 2);
}
reg('select.all-pixels', () => {
  const doc = editor.doc;
  if (doc) editor.setUi({ pixelSelection: pageSelection(doc) });
});
reg('select.none', () => editor.setUi({ pixelSelection: null }));
reg('select.invert', () => {
  const doc = editor.doc;
  if (!doc) return;
  const s = editor.ui.pixelSelection;
  if (!s) return editor.setUi({ pixelSelection: pageSelection(doc) });
  const r = booleanPaths([pageSelection(doc), s], 'subtract')[0] ?? null;
  editor.setUi({ pixelSelection: r });
});
reg('select.crop', () => {
  const s = editor.ui.pixelSelection;
  if (!s) return toast('Make a selection first');
  const b = pathBounds(s);
  editor.commit('Crop to selection', (d) => cropDocument(d, b));
  editor.setUi({ pixelSelection: null });
  editor.ensureActiveLayer();
  viewport?.zoomToFit();
});
reg('crop.apply', () => {
  if (!applyCrop(() => viewport?.zoomToFit())) return;
  editor.ensureActiveLayer();
  toast('Cropped', 'info', { action: { label: 'Undo', run: () => void runCommand('edit.undo') } });
});
reg('crop.cancel', () => cancelCrop());
reg('select.fill', () => {
  const doc = editor.doc;
  const s = editor.ui.pixelSelection;
  if (!doc || !s) return toast('Make a selection first');
  const r = activeRaster(editor) ?? createPixelLayer(editor);
  if (!r) return;
  editRaster(editor, r.id, 'Fill selection', (ctx) => {
    const p = selectionInPixels(editor.doc!, r.id, s);
    if (!p) return;
    ctx.fillStyle = editor.ui.fillColor;
    ctx.fill(p, 'evenodd');
  });
});
reg('select.clear', () => {
  const s = editor.ui.pixelSelection;
  const r = activeRaster(editor);
  if (!s || !r) return toast('Select a pixel layer and make a selection');
  editRaster(editor, r.id, 'Clear', (ctx) => {
    const p = selectionInPixels(editor.doc!, r.id, s);
    if (!p) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(p, 'evenodd');
    ctx.restore();
  });
});
// Select Subject: on-device QuvSelect model (ml/), with a non-ML fallback
let subjectBusy = false;
async function selectSubject(): Promise<boolean> {
  const doc = editor.doc;
  const container = editor.activeContainer;
  if (!doc || !container || subjectBusy || editor.ui.mlBusy) return false;
  const r = photoLayer();
  if (!r) {
    toast('Add or select a photo layer first');
    return false;
  }
  const view = rasterView(editor, r);
  if (!view) return false;
  subjectBusy = true;
  editor.setUi({ status: 'Selecting subject…', mlBusy: true });
  try {
    const res = await runSelectSubject(view);
    const path = resultToWorldPath(view, res);
    if (!path) {
      editor.setUi({ status: '' });
      toast('No clear subject found');
      return false;
    }
    markStep('subject');
    editor.setUi({ pixelSelection: path, status: `Subject selected (${res.source === 'ml' ? 'on-device model' : 'basic fallback'}, ${Math.round(res.ms)} ms)` });
    return true;
  } finally {
    subjectBusy = false;
    editor.setUi({ mlBusy: false });
  }
}
reg('select.subject', () => selectSubject());
/**
 * Remove background: keep the subject (the current selection, or Select
 * Subject when there is none) and hide the rest with a layer mask, so it can
 * be undone or the mask edited/released later. Non-destructive.
 */
reg('select.remove-background', async () => {
  if (!editor.ui.pixelSelection && !(await selectSubject())) return;
  const s = editor.ui.pixelSelection;
  const r = photoLayer();
  if (!s || !r) return toast('Add or select a photo layer first');
  editor.commit('Remove background', (d) => setMaskFromWorldPath(d, r.id, s));
  editor.setUi({ pixelSelection: null });
  editor.select([r.id]);
  toast('Background removed', 'success', { action: { label: 'Undo', run: () => void runCommand('edit.undo') } });
});
reg('select.copy-to-layer', () => {
  const doc = editor.doc;
  const s = editor.ui.pixelSelection;
  const r = photoLayer();
  if (!doc || !s || !r) return toast('Select a pixel layer and make a selection');
  const base = editor.assets.rendered(r.assetId, r.adjustments, false);
  const p = selectionInPixels(doc, r.id, s);
  if (!base || !p) return;
  const c = createCanvas(base.width, base.height);
  const ctx = ctx2d(c);
  ctx.save();
  ctx.clip(p, 'evenodd');
  ctx.drawImage(base, 0, 0);
  ctx.restore();
  const node = { ...cloneNode(r), adjustments: [], name: r.name + ' (copy)', mask: undefined };
  const container = editor.activeContainer!;
  const idx = container.nodes.findIndex((n) => n.id === r.id);
  editor.commit('Copy selection to layer', (d) => addNodes(d, container.id, [node], idx + 1));
  commitRasterCanvas(editor, node.id, c, 'Copy selection to layer');
  editor.select([node.id]);
});

// ---------------------------------------------------------------------------
// Pages, masters, text frames

reg('page.add', () => {
  const doc = editor.doc;
  if (!doc) return;
  const i = Math.max(0, editor.activePageIndex);
  let pid = '';
  editor.commit('Add page', (d) => {
    const r = addPage(d, i);
    pid = r.pageId;
    return r.doc;
  });
  editor.setUi({ activeContainerId: pid, selection: [] });
});
reg('page.duplicate', () => {
  const doc = editor.doc;
  const i = editor.activePageIndex;
  if (!doc || i < 0) return;
  let pid = '';
  editor.commit('Duplicate page', (d) => {
    const r = duplicatePage(d, d.pages[i].id);
    pid = r.pageId;
    return r.doc;
  });
  editor.setUi({ activeContainerId: pid, selection: [] });
});
reg('page.delete', () => {
  const doc = editor.doc;
  const i = editor.activePageIndex;
  if (!doc || i < 0 || doc.pages.length < 2) return;
  const id = doc.pages[i].id;
  editor.commit('Delete page', (d) => removePage(d, id));
  const next = editor.doc!.pages[Math.min(i, editor.doc!.pages.length - 1)];
  editor.setUi({ activeContainerId: next.id, selection: [] });
});
reg('page.prev', () => gotoPage(-1));
reg('page.next', () => gotoPage(1));
function gotoPage(delta: number) {
  const doc = editor.doc;
  if (!doc) return;
  const i = Math.max(0, editor.activePageIndex);
  const j = Math.min(doc.pages.length - 1, Math.max(0, i + delta));
  viewport?.textEdit.end();
  editor.setUi({ activeContainerId: doc.pages[j].id, selection: [] });
}
reg('master.add', () => {
  let mid = '';
  editor.commit('Add master', (d) => {
    const r = addMaster(d);
    mid = r.masterId;
    return r.doc;
  });
  editor.setUi({ activeContainerId: mid, selection: [] });
  toast('Editing master page — content here appears on every page that uses it');
});
reg('text.link', () => {
  const frames = editor.selectedNodes().filter((n) => n.type === 'textframe');
  if (frames.length !== 2) return toast('Select two text frames to link (first, then second)');
  editor.commit('Link frames', (d) => linkFrames(d, frames[0].id, frames[1].id));
});
reg('text.unlink', () => {
  const f = editor.selectedNodes().find((n) => n.type === 'textframe');
  if (f) editor.commit('Unlink frame', (d) => unlinkFrame(d, f.id));
});
reg('doc.resize', () => needDoc() && openDialog('resize'));
reg('doc.clear-guides', () => editor.commit('Clear guides', (d) => ({ ...d, guides: [] })));

// ---------------------------------------------------------------------------
// View & studios

reg('view.zoom-in', () => viewport?.zoomBy(1.25));
reg('view.zoom-out', () => viewport?.zoomBy(0.8));
reg('view.zoom-fit', () => viewport?.zoomToFit());
reg('view.zoom-100', () => viewport?.zoomTo(1));
reg('view.rulers', () => setSetting({ showRulers: !editor.settings.showRulers }));
reg('view.snapping', () => {
  setSetting({ snapping: !editor.settings.snapping });
  toast(`Snapping ${editor.settings.snapping ? 'on' : 'off'}`);
});
reg('studio.photo', () => editor.setStudio('photo'));
reg('studio.vector', () => editor.setStudio('vector'));
reg('studio.layout', () => editor.setStudio('layout'));
reg('view.theme-dark', () => setSetting({ theme: 'dark' }));
reg('view.theme-light', () => setSetting({ theme: 'light' }));
reg('view.theme-contrast', () => setSetting({ theme: 'high-contrast' }));
reg('view.ui-bigger', () => setSetting({ uiScale: Math.min(2, Math.round((editor.settings.uiScale + 0.1) * 10) / 10) }));
reg('view.ui-smaller', () => setSetting({ uiScale: Math.max(0.75, Math.round((editor.settings.uiScale - 0.1) * 10) / 10) }));
reg('view.ui-reset', () => setSetting({ uiScale: 1 }));

registerVectorCommands(reg);

export async function setSetting(patch: Partial<typeof editor.settings>): Promise<void> {
  if (editor.policy.forceTheme && patch.theme) {
    toast('The theme is set by your administrator');
    delete patch.theme;
  }
  if (editor.policy.lockUiScale && patch.uiScale) {
    toast('Interface size is set by your administrator');
    delete patch.uiScale;
  }
  editor.settings = { ...editor.settings, ...patch };
  editor.emit();
  try {
    editor.settings = await window.quvrelo.setSettings(patch);
    editor.emit();
  } catch {
    /* settings persistence unavailable */
  }
}

// ---------------------------------------------------------------------------
// Help

reg('help.command-palette', () => import('./palette').then((m) => m.openPalette()));
reg('help.shortcuts', () => openDialog('shortcuts'));
reg('help.guide', () => openDialog('guide'));
reg('help.about', () => openDialog('about'));
reg('help.check-updates', () => openDialog('updates'));
reg('dialog.close', () => closeDialog());

// ---------------------------------------------------------------------------
// Keyboard shortcuts that are not menu accelerators (tool keys, nudges)

export function toolForKey(key: string): string | null {
  return toolForKeyIn(editor.ui.studio, key);
}

export function shortcutTable(): { group: string; items: [string, string][] }[] {
  return [
    { group: 'Tools (all studios)', items: Object.entries(TOOL_KEYS.common).map(([k, t]) => [k.toUpperCase(), toolName(t as ToolId)]) },
    { group: 'Photo studio tools', items: Object.entries(TOOL_KEYS.photo).map(([k, t]) => [k.toUpperCase(), toolName(t as ToolId)]) },
    { group: 'Vector studio tools', items: Object.entries(TOOL_KEYS.vector).map(([k, t]) => [k.toUpperCase(), toolName(t as ToolId)]) },
    { group: 'Layout studio tools', items: Object.entries(TOOL_KEYS.layout).map(([k, t]) => [k.toUpperCase(), toolName(t as ToolId)]) },
    {
      group: 'Canvas',
      items: [
        ['Space + drag', 'Pan'], ['Ctrl/⌘ + scroll', 'Zoom at pointer'], ['Arrow keys', 'Nudge 1 px'], ['Shift + arrows', 'Nudge 10 px'],
        ['Shift + drag', 'Constrain proportions / angle'], ['Alt + drag', 'Draw from centre / disable snapping'],
        ['Double-click', 'Edit text, place image, or edit nodes'], ['Enter (pen/crop)', 'Finish / apply crop'], ['Esc', 'Cancel / leave text editing / reset crop'],
        ['Alt + click (Object select)', 'Remove part of the selection'], ['Ctrl/⌘ + Alt + S', 'Select subject'],
        ['[ / ]', 'Brush size'], ['Page Up / Down', 'Previous / next page'], ['Tab', 'Hide / show panels'],
        ['Shift + tool key', 'Cycle the tools in that flyout group'], ['Right-click / hold a tool', 'Open its flyout'],
      ],
    },
  ];
}

export function handleKeydown(e: KeyboardEvent): boolean {
  if (isEditable(e.target)) return false;
  const vp = viewport;
  if (vp?.activeTool.onKey?.(e)) {
    e.preventDefault();
    return true;
  }
  const mod = e.ctrlKey || e.metaKey;
  // Ctrl/Cmd+Alt+S: Select Subject. Also a menu accelerator; handled here so it
  // works wherever the native menu is hidden (and the page consumes it first).
  if (mod && e.altKey && !e.shiftKey && e.code === 'KeyS' && editor.ui.studio === 'photo') {
    void runCommand('select.subject');
    return true;
  }
  if (!mod && !e.altKey) {
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        void runCommand('edit.delete');
        return true;
      case 'ArrowLeft': void runCommand(e.shiftKey ? 'nudge.left-10' : 'nudge.left'); return true;
      case 'ArrowRight': void runCommand(e.shiftKey ? 'nudge.right-10' : 'nudge.right'); return true;
      case 'ArrowUp': void runCommand(e.shiftKey ? 'nudge.up-10' : 'nudge.up'); return true;
      case 'ArrowDown': void runCommand(e.shiftKey ? 'nudge.down-10' : 'nudge.down'); return true;
      case 'PageUp': void runCommand('page.prev'); return true;
      case 'PageDown': void runCommand('page.next'); return true;
      case 'Escape':
        if (editor.ui.selection.length) editor.select([]);
        else if (editor.ui.pixelSelection) editor.setUi({ pixelSelection: null });
        return true;
      case '[':
      case ']': {
        const o = editor.ui.toolOptions;
        const f = e.key === ']' ? 1.2 : 1 / 1.2;
        editor.setToolOptions({ brushSize: Math.max(1, Math.round(o.brushSize * f)), eraserSize: Math.max(1, Math.round(o.eraserSize * f)) });
        vp?.drawOverlay();
        return true;
      }
    }
    if (e.key.length === 1 && !e.shiftKey) {
      const t = toolForKey(e.key);
      if (t) {
        editor.setTool(t as never);
        return true;
      }
    }
    // Shift + a tool key cycles through that tool's flyout group (Shift+M: marquees / shapes)
    if (e.key.length === 1 && e.shiftKey) {
      const t = toolForKey(e.key) as ToolId | null;
      const group = t && groupOf(editor.ui.studio, t);
      if (group) {
        editor.setTool(cycleTool(group, editor.ui.tool, editor.ui.railTools));
        return true;
      }
    }
  }
  return false;
}


export function containerName(id: Id): string {
  const doc = editor.doc;
  if (!doc) return '';
  return getContainer(doc, id)?.name ?? '';
}
