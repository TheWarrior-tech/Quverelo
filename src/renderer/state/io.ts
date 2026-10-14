/** File operations: new/open/save, import/place, export, autosave & recovery, hand-in. */
import { packEasel, unpackEasel } from '../../core/serialization';
import { createDocument, findNode, make, structuredCloneSafe } from '../../core/document';
import { addNodes, updateNode } from '../../core/commands';
import { templateById } from '../../core/templates';
import type { EaselDocument, ImageFrameNode, SceneNode, StudioKind } from '../../core/types';
import type { FileFilter } from '../../shared/api';
import { canvasToBytes, createCanvas, ctx2d } from '../engine/assets';
import { exportPdf, exportRaster, exportSvg, renderPageCanvas } from '../engine/export';
import { importSvg } from '../engine/svgImport';
import { editor } from './editor';
import { toast } from './bus';

const EASEL_FILTER: FileFilter[] = [{ name: 'Easel Studio Document', extensions: ['easel'] }];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/png';
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function refreshTitle(): void {
  const doc = editor.doc;
  const dirty = editor.history?.dirty ?? false;
  const org = editor.policy.organizationName ? ` — ${editor.policy.organizationName}` : '';
  window.easel?.setTitle(doc ? `${doc.title}${dirty ? ' •' : ''} — Easel Studio${org}` : `Easel Studio${org}`);
  window.easel?.setDirty(dirty);
}

let titleHooked = false;
export function hookTitle(): void {
  if (titleHooked) return;
  titleHooked = true;
  editor.subscribe(refreshTitle);
}

export function newFromTemplate(id: string): void {
  const t = templateById(id);
  if (!t) return;
  editor.assets.clear();
  const doc = t.build();
  editor.openSession(doc, null, t.studio);
}

export function newBlank(opts: { title: string; width: number; height: number; unit: EaselDocument['settings']['unit']; pages: number; studio: StudioKind; margins: number; bleed: number; background: string | null; dpi: number }): void {
  editor.assets.clear();
  const doc = createDocument({
    title: opts.title,
    studio: opts.studio,
    pages: opts.pages,
    settings: {
      width: opts.width,
      height: opts.height,
      unit: opts.unit,
      bleed: opts.bleed,
      margins: { top: opts.margins, right: opts.margins, bottom: opts.margins, left: opts.margins },
      background: opts.background,
      dpi: opts.dpi,
    },
  });
  editor.openSession(doc, null, opts.studio);
}

async function loadEaselBytes(data: Uint8Array, path: string | null): Promise<void> {
  const { doc, assets } = await unpackEasel(data);
  editor.assets.clear();
  for (const [id, blob] of assets) await editor.assets.addBytes(blob.bytes, blob.mime, id);
  editor.openSession(doc, path);
}

/** Open a new photo document from an image file. */
async function openImageAsDocument(bytes: Uint8Array, name: string, path: string | null): Promise<void> {
  editor.assets.clear();
  if (mimeFor(name) === 'image/svg+xml') {
    const text = new TextDecoder().decode(bytes);
    const r = importSvg(text);
    const w = Math.max(1, Math.round(r.width || 800));
    const h = Math.max(1, Math.round(r.height || 600));
    const doc = createDocument({ title: baseName(name), studio: 'vector', settings: { width: w, height: h } });
    editor.openSession(addNodes(doc, doc.pages[0].id, r.nodes), null, 'vector');
    return;
  }
  const { id, width, height } = await editor.assets.addBytes(bytes, mimeFor(name));
  let doc = createDocument({ title: baseName(name), studio: 'photo', settings: { width, height, background: null, dpi: 300 } });
  const node = make.raster({ assetId: id, w: width, h: height, x: width / 2, y: height / 2, name: 'Background' });
  doc = { ...doc, assets: { [id]: editor.assets.ref(id, name) } };
  doc = addNodes(doc, doc.pages[0].id, [node]);
  editor.openSession(doc, null, 'photo');
  void path;
}

export async function openPath(path: string): Promise<void> {
  try {
    const f = await window.easel.readFile(path);
    await openFileData(f.data, f.name, f.path);
  } catch (e) {
    toast(`Could not open ${path}: ${(e as Error).message}`, 'error');
  }
}

export async function openFileData(data: Uint8Array, name: string, path: string | null): Promise<void> {
  if (name.toLowerCase().endsWith('.easel')) {
    await loadEaselBytes(data, path);
    if (path) void window.easel.addRecent(path);
  } else {
    await openImageAsDocument(data, name, path);
  }
  toast(`Opened ${name}`, 'success');
}

export async function openDialogAndLoad(): Promise<void> {
  const files = await window.easel.openFileDialog({
    title: 'Open',
    filters: [
      { name: 'All supported', extensions: ['easel', ...IMAGE_EXT, 'svg'] },
      ...EASEL_FILTER,
      { name: 'Images', extensions: IMAGE_EXT },
      { name: 'SVG', extensions: ['svg'] },
    ],
  });
  if (!files.length) return;
  try {
    await openFileData(files[0].data, files[0].name, files[0].path);
  } catch (e) {
    toast(`Could not open ${files[0].name}: ${(e as Error).message}`, 'error');
  }
}

async function thumbnail(): Promise<Uint8Array | undefined> {
  const doc = editor.doc;
  if (!doc) return undefined;
  try {
    const s = 256 / Math.max(doc.settings.width, doc.settings.height);
    const c = renderPageCanvas(doc, editor.assets, { pageIndex: 0, scale: s, includeBleed: false, transparent: false });
    return await canvasToBytes(c, 'image/png');
  } catch {
    return undefined;
  }
}

export async function packCurrent(): Promise<Uint8Array> {
  const doc = editor.doc!;
  return packEasel(doc, (id) => editor.assets.blob(id), await thumbnail());
}

export async function save(saveAs = false): Promise<boolean> {
  const s = editor.session;
  if (!s) return false;
  const before = editor.doc!;
  try {
    const data = await packCurrent();
    const path = await window.easel.saveFile({
      path: saveAs ? null : s.filePath,
      data,
      defaultName: `${before.title || 'Untitled'}.easel`,
      filters: EASEL_FILTER,
      title: saveAs ? 'Save As' : 'Save',
    });
    if (!path) return false;
    s.filePath = path;
    const title = baseName(path.split(/[\\/]/).pop() ?? before.title);
    if (title !== before.title) editor.preview((d) => ({ ...d, title }));
    editor.history!.markSaved();
    void window.easel.addRecent(path);
    void window.easel.deleteRecovery(s.recoveryId);
    toast(`Saved ${path.split(/[\\/]/).pop()}`, 'success');
    return true;
  } catch (e) {
    toast(`Save failed: ${(e as Error).message}`, 'error');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Import & place

async function pickImages(): Promise<{ data: Uint8Array; name: string }[]> {
  const files = await window.easel.openFileDialog({ title: 'Place Image', filters: [{ name: 'Images', extensions: [...IMAGE_EXT, 'svg'] }], multi: true });
  return files.map((f) => ({ data: f.data, name: f.name }));
}

export async function placeImages(files?: { data: Uint8Array; name: string }[]): Promise<void> {
  const doc = editor.doc;
  if (!doc) return;
  const list = files ?? (await pickImages());
  if (!list.length) return;
  const container = editor.activeContainer!;
  const sel = editor.selectedNodes();
  const frame = sel.find((n): n is ImageFrameNode => n.type === 'imageframe');
  const W = doc.settings.width;
  const H = doc.settings.height;
  const added: string[] = [];
  for (const f of list) {
    if (mimeFor(f.name) === 'image/svg+xml') {
      const r = importSvg(new TextDecoder().decode(f.data));
      const g = make.group(r.nodes.map((n) => ({ ...n })), { name: baseName(f.name) });
      // centre imported artwork on the page
      const cx = r.nodes.reduce((s, n) => s + n.x, 0) / Math.max(1, r.nodes.length);
      const cy = r.nodes.reduce((s, n) => s + n.y, 0) / Math.max(1, r.nodes.length);
      g.children = g.children.map((n) => ({ ...n, x: n.x - cx, y: n.y - cy }));
      g.x = W / 2;
      g.y = H / 2;
      editor.commit('Import SVG', (d) => addNodes(d, container.id, [g]));
      added.push(g.id);
      continue;
    }
    const { id, width, height } = await editor.assets.addBytes(f.data, mimeFor(f.name));
    const ref = editor.assets.ref(id, f.name);
    if (frame && list.length === 1) {
      editor.commit('Place image in frame', (d) =>
        updateNode<ImageFrameNode>({ ...d, assets: { ...d.assets, [id]: ref } }, frame.id, { assetId: id, contentX: 0, contentY: 0, contentScale: 1 }),
      );
      added.push(frame.id);
      continue;
    }
    const fit = Math.min(1, (W * 0.9) / width, (H * 0.9) / height);
    let node: SceneNode;
    if (editor.ui.studio === 'layout') {
      node = make.imageframe({ assetId: id, w: width * fit, h: height * fit, x: W / 2, y: H / 2, fit: 'fill', name: baseName(f.name) });
    } else {
      node = make.raster({ assetId: id, w: width, h: height, x: W / 2, y: H / 2, scaleX: fit, scaleY: fit, name: baseName(f.name) });
    }
    editor.commit('Place image', (d) => addNodes({ ...d, assets: { ...d.assets, [id]: ref } }, container.id, [node]));
    added.push(node.id);
  }
  editor.select(added);
}

export async function importSvgFile(): Promise<void> {
  const files = await window.easel.openFileDialog({ title: 'Import SVG', filters: [{ name: 'SVG', extensions: ['svg'] }] });
  if (!files.length) return;
  await placeImages(files.map((f) => ({ data: f.data, name: f.name })));
}

/** Paste an image from the system clipboard. Returns true when one was found. */
export async function pasteSystemImage(): Promise<boolean> {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await it.getType(type);
      const data = new Uint8Array(await blob.arrayBuffer());
      await placeImages([{ data, name: `Pasted image.${type.split('/')[1] || 'png'}` }]);
      return true;
    }
  } catch {
    /* clipboard unavailable */
  }
  return false;
}

// ---------------------------------------------------------------------------
// Export

export interface ExportRequest {
  format: 'png' | 'jpg' | 'svg' | 'pdf';
  pages: number[];
  scale: number;
  dpi: number;
  quality: number;
  transparent: boolean;
  includeBleed: boolean;
  cropMarks: boolean;
}

export async function runExport(req: ExportRequest): Promise<string | null> {
  const doc = editor.doc;
  if (!doc) return null;
  const title = doc.title || 'Untitled';
  if (req.format === 'pdf') {
    const data = await exportPdf(doc, editor.assets, { dpi: req.dpi, includeBleed: req.includeBleed, cropMarks: req.cropMarks, quality: req.quality, pages: req.pages });
    return window.easel.saveFile({ path: null, data, defaultName: `${title}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }], title: 'Export PDF' });
  }
  let last: string | null = null;
  for (const i of req.pages) {
    const suffix = req.pages.length > 1 || doc.pages.length > 1 ? ` - ${doc.pages[i].name}` : '';
    if (req.format === 'svg') {
      const svg = exportSvg(doc, editor.assets, i, req.includeBleed);
      last = await window.easel.saveFile({ path: null, data: new TextEncoder().encode(svg), defaultName: `${title}${suffix}.svg`, filters: [{ name: 'SVG', extensions: ['svg'] }], title: 'Export SVG' });
    } else {
      const data = await exportRaster(doc, editor.assets, { pageIndex: i, scale: req.scale, includeBleed: req.includeBleed, transparent: req.transparent, format: req.format, quality: req.quality });
      const ext = req.format === 'jpg' ? 'jpg' : 'png';
      last = await window.easel.saveFile({ path: null, data, defaultName: `${title}${suffix}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }], title: `Export ${ext.toUpperCase()}` });
    }
    if (!last) return null;
  }
  return last;
}

// ---------------------------------------------------------------------------
// Autosave & recovery

let autosaveTimer: number | null = null;
let lastAutosaved: EaselDocument | null = null;

export function startAutosave(): void {
  if (autosaveTimer) window.clearInterval(autosaveTimer);
  const secs = editor.policy.autosaveIntervalSeconds;
  if (!secs || !editor.feature('autosave')) return;
  autosaveTimer = window.setInterval(() => void autosaveNow(), secs * 1000);
}

export async function autosaveNow(): Promise<void> {
  const s = editor.session;
  const doc = editor.doc;
  if (!s || !doc || !editor.history!.dirty || doc === lastAutosaved) return;
  try {
    const data = await packEasel(doc, (id) => editor.assets.blob(id));
    await window.easel.writeRecovery({ id: s.recoveryId, title: doc.title, savedAt: new Date().toISOString(), originalPath: s.filePath }, data);
    lastAutosaved = doc;
    editor.collectGarbage();
  } catch (e) {
    console.warn('Autosave failed', e);
  }
}

export async function restoreRecovery(id: string): Promise<void> {
  const data = await window.easel.readRecovery(id);
  if (!data) {
    toast('Recovery file is no longer available', 'error');
    return;
  }
  const { doc, assets } = await unpackEasel(data);
  editor.assets.clear();
  for (const [aid, blob] of assets) await editor.assets.addBytes(blob.bytes, blob.mime, aid);
  editor.openSession(doc, null);
  // mark as unsaved so the user is prompted to save it somewhere
  editor.history!.replace({ ...editor.doc! });
  editor.session!.recoveryId = id;
  toast('Recovered document — remember to save it', 'success');
}

// ---------------------------------------------------------------------------
// Assignments

export async function handIn(studentName: string): Promise<string | null> {
  const doc = editor.doc;
  if (!doc) return null;
  const info = doc.assignment;
  const className = info?.className || 'Class';
  const stamped: EaselDocument = {
    ...doc,
    assignment: { ...(info ?? { title: doc.title, className, teacher: '', dueDate: '', instructions: '' }), studentName, submittedAt: new Date().toISOString() },
  };
  editor.commit('Hand in', () => stamped);
  const data = await packCurrent();
  const path = await window.easel.handIn({ data, fileName: info?.title || doc.title, className, studentName });
  toast(`Handed in to ${path}`, 'success');
  return path;
}

export function exportSnapshotCanvas(pageIndex: number, maxSize: number): HTMLCanvasElement | null {
  const doc = editor.doc;
  if (!doc) return null;
  const s = maxSize / Math.max(doc.settings.width, doc.settings.height);
  try {
    return renderPageCanvas(doc, editor.assets, { pageIndex, scale: s, includeBleed: false, transparent: false });
  } catch {
    const c = createCanvas(1, 1);
    ctx2d(c);
    return c;
  }
}

export function cloneForClipboard(ids: string[]): { nodes: SceneNode[]; stories: EaselDocument['stories'] } | null {
  const doc = editor.doc;
  if (!doc) return null;
  const nodes = ids.map((id) => findNode(doc, id)?.node).filter((n): n is SceneNode => !!n).map((n) => structuredCloneSafe(n));
  const stories: EaselDocument['stories'] = {};
  const visit = (list: SceneNode[]) => list.forEach((n) => {
    if (n.type === 'textframe' && doc.stories[n.storyId]) stories[n.storyId] = structuredCloneSafe(doc.stories[n.storyId]);
    if (n.type === 'group') visit(n.children);
  });
  visit(nodes);
  return { nodes, stories };
}
