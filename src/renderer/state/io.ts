/** File operations: new/open/save, import/place, export, autosave & recovery, hand-in. */
import { packQuvrelo, unpackQuvrelo } from '../../core/serialization';
import { createDocument, findNode, make, structuredCloneSafe } from '../../core/document';
import { addNodes, updateNode } from '../../core/commands';
import { templateById } from '../../core/templates';
import type { QuvreloDocument, ImageFrameNode, SceneNode, StudioKind } from '../../core/types';
import type { FileFilter } from '../../shared/api';
import { canvasToBytes, createCanvas, ctx2d } from '../engine/assets';
import { exportImagePdf, exportPdf, exportRaster, exportSelectionRaster, exportSvg, renderPageCanvas } from '../engine/export';
import { importSvg } from '../engine/svgImport';
import { defaultExportFormat, pagesStillValid, type ExportFormat } from '../../core/exportDefaults';
import { editor } from './editor';
import { openDialog, toast } from './bus';
import { markStep } from './onboarding';
import { handInBundle, interopKind, openInterop, openableInteropExtensions, placeInterop } from './interop';

const QUVRELO_FILTER: FileFilter[] = [{ name: 'Quvrelo Document', extensions: ['quvrelo'] }];
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
  window.quvrelo?.setTitle(doc ? `${doc.title}${dirty ? ' •' : ''} — Quvrelo${org}` : `Quvrelo${org}`);
  window.quvrelo?.setDirty(dirty);
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
  markStep('create');
}

export function newBlank(opts: { title: string; width: number; height: number; unit: QuvreloDocument['settings']['unit']; pages: number; studio: StudioKind; margins: number; bleed: number; background: string | null; dpi: number }): void {
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
  markStep('create');
}

async function loadQuvreloBytes(data: Uint8Array, path: string | null): Promise<void> {
  const { doc, assets } = await unpackQuvrelo(data);
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
  markStep('place');
  void path;
}

export async function openPath(path: string): Promise<void> {
  try {
    const f = await window.quvrelo.readFile(path);
    await openFileData(f.data, f.name, f.path);
  } catch (e) {
    toast(`Could not open ${path}: ${(e as Error).message}`, 'error');
  }
}

export async function openFileData(data: Uint8Array, name: string, path: string | null): Promise<void> {
  if (/\.(quvrelo|easel)$/i.test(name)) {
    await loadQuvreloBytes(data, path);
    if (path) void window.quvrelo.addRecent(path);
  } else if (interopKind(name)) {
    await openInterop(data, name, path); // PSD, AI/PDF, IDML, assignment packs, hand-ins (shows its own toast)
    return;
  } else {
    await openImageAsDocument(data, name, path);
  }
  toast(`Opened ${name}`, 'success');
}

/**
 * "Edit a photo…" on Welcome (UX audit P0-3a): an image-only open dialog. The
 * picked photo becomes a new Photo document with the image as its background
 * layer. Resolves true when a photo was opened.
 */
export async function openPhotoDialog(): Promise<boolean> {
  const files = await window.quvrelo.openFileDialog({
    title: 'Edit a Photo',
    filters: [{ name: 'Images', extensions: IMAGE_EXT }],
  });
  if (!files.length) return false;
  try {
    await openFileData(files[0].data, files[0].name, files[0].path);
    return true;
  } catch (e) {
    toast(`Could not open ${files[0].name}: ${(e as Error).message}`, 'error');
    return false;
  }
}

export async function openDialogAndLoad(): Promise<void> {
  const files = await window.quvrelo.openFileDialog({
    title: 'Open',
    filters: [
      { name: 'All supported', extensions: ['quvrelo', 'easel', ...IMAGE_EXT, 'svg', ...openableInteropExtensions()] },
      ...QUVRELO_FILTER,
      { name: 'Images', extensions: IMAGE_EXT },
      { name: 'SVG', extensions: ['svg'] },
      ...interopFilters(),
    ],
  });
  if (!files.length) return;
  try {
    await openFileData(files[0].data, files[0].name, files[0].path);
  } catch (e) {
    toast(`Could not open ${files[0].name}: ${(e as Error).message}`, 'error');
  }
}

/** Open-dialog filters for the formats in interop.ts the policy allows. */
function interopFilters(): FileFilter[] {
  const ext = new Set(openableInteropExtensions());
  const f: FileFilter[] = [
    { name: 'Photoshop', extensions: ['psd', 'psb'] },
    { name: 'Illustrator / PDF', extensions: ['ai', 'pdf'] },
    { name: 'InDesign IDML', extensions: ['idml'] },
    { name: 'Quvrelo Assignment', extensions: ['quvrelo-assignment'] },
    { name: 'Hand-in bundle', extensions: ['zip'] },
  ];
  return f.map((x) => ({ ...x, extensions: x.extensions.filter((e) => ext.has(e) || (e === 'zip' && ext.has('quvrelo-assignment'))) })).filter((x) => x.extensions.length);
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
  return packQuvrelo(doc, (id) => editor.assets.blob(id), await thumbnail());
}

export async function save(saveAs = false): Promise<boolean> {
  const s = editor.session;
  if (!s) return false;
  const before = editor.doc!;
  try {
    const data = await packCurrent();
    const path = await window.quvrelo.saveFile({
      path: saveAs ? null : s.filePath,
      data,
      defaultName: `${before.title || 'Untitled'}.quvrelo`,
      filters: QUVRELO_FILTER,
      title: saveAs ? 'Save As' : 'Save',
    });
    if (!path) return false;
    s.filePath = path;
    const title = baseName(path.split(/[\\/]/).pop() ?? before.title);
    if (title !== before.title) editor.preview((d) => ({ ...d, title }));
    editor.history!.markSaved();
    void window.quvrelo.addRecent(path);
    void window.quvrelo.deleteRecovery(s.recoveryId);
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
  const extra = openableInteropExtensions().filter((e) => ['psd', 'psb', 'ai', 'pdf'].includes(e));
  const files = await window.quvrelo.openFileDialog({ title: 'Place image', filters: [{ name: 'Images', extensions: [...IMAGE_EXT, 'svg', ...extra] }], multi: true });
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
    if (interopKind(f.name)) {
      try {
        await placeInterop(f.data, f.name);
      } catch (e) {
        toast(`Could not place ${f.name}: ${(e as Error).message}`, 'error');
      }
      continue;
    }
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
  if (added.length) editor.select(added);
  if (list.some((f) => mimeFor(f.name) !== 'image/svg+xml' && !interopKind(f.name))) markStep('place');
}

export async function importSvgFile(): Promise<void> {
  const files = await window.quvrelo.openFileDialog({ title: 'Import SVG', filters: [{ name: 'SVG', extensions: ['svg'] }] });
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
  /** PDF only: 'vector' (default) keeps shapes and text as vectors; 'image' makes one picture per page */
  pdfKind?: 'vector' | 'image';
  /** PNG/JPEG only: export just these objects, cropped to their bounds */
  selection?: string[];
  /** file name offered in the save dialog (without extension); defaults to the document title */
  fileName?: string;
}

/** What the last vector PDF had to place as images (for the toast), or null. */
let lastPdfNote: string | null = null;
export function takePdfNote(): string | null {
  const n = lastPdfNote;
  lastPdfNote = null;
  return n;
}

/**
 * Writes the export and returns every path written (null when cancelled).
 * `targets` overwrites known files without asking ("Export again"); a missing
 * or disallowed target falls back to the save dialog in the main process.
 */
export async function runExportFiles(req: ExportRequest, targets: (string | null)[] = []): Promise<string[] | null> {
  const doc = editor.doc;
  if (!doc) return null;
  const title = req.fileName?.trim() || doc.title || 'Untitled';
  const written: string[] = [];
  if (req.format === 'pdf') {
    let data: Uint8Array;
    lastPdfNote = null;
    if (req.pdfKind === 'image') {
      data = await exportImagePdf(doc, editor.assets, { dpi: req.dpi, includeBleed: req.includeBleed, cropMarks: req.cropMarks, quality: req.quality, pages: req.pages });
    } else {
      const out = await exportPdf(doc, editor.assets, { pages: req.pages, includeBleed: req.includeBleed, cropMarks: req.cropMarks, quality: req.quality, fallbackDpi: Math.max(150, req.dpi) });
      data = out.bytes;
      const r = out.report.rasterised;
      if (r.length) lastPdfNote = r.length === 1 ? `“${r[0].name}” was placed as an image: ${r[0].reason}` : `${r.length} objects were placed as images (${r[0].reason}…)`;
    }
    const p = await window.quvrelo.saveFile({ path: targets[0] ?? null, data, defaultName: `${title}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }], title: 'Export PDF' });
    if (!p) return null;
    written.push(p);
  } else {
    for (const [k, i] of req.pages.entries()) {
      const suffix = req.pages.length > 1 || doc.pages.length > 1 ? ` - ${doc.pages[i].name}` : '';
      let p: string | null;
      if (req.format === 'svg') {
        const svg = exportSvg(doc, editor.assets, i, req.includeBleed);
        p = await window.quvrelo.saveFile({ path: targets[k] ?? null, data: new TextEncoder().encode(svg), defaultName: `${title}${suffix}.svg`, filters: [{ name: 'SVG', extensions: ['svg'] }], title: 'Export SVG' });
      } else if (req.selection?.length) {
        const data = await exportSelectionRaster(doc, editor.assets, req.selection, { scale: req.scale, transparent: req.transparent, format: req.format, quality: req.quality });
        const ext = req.format === 'jpg' ? 'jpg' : 'png';
        p = await window.quvrelo.saveFile({ path: targets[k] ?? null, data, defaultName: `${title} - selection.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }], title: `Export ${ext.toUpperCase()}` });
        if (!p) return null;
        written.push(p); // one image of the selection, whatever the page range
        break;
      } else {
        const data = await exportRaster(doc, editor.assets, { pageIndex: i, scale: req.scale, includeBleed: req.includeBleed, transparent: req.transparent, format: req.format, quality: req.quality });
        const ext = req.format === 'jpg' ? 'jpg' : 'png';
        p = await window.quvrelo.saveFile({ path: targets[k] ?? null, data, defaultName: `${title}${suffix}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }], title: `Export ${ext.toUpperCase()}` });
      }
      if (!p) return null;
      written.push(p);
    }
  }
  lastExports.set(doc.id, { req: { ...req, pages: [...req.pages] }, paths: written });
  markStep('export');
  return written;
}

export async function runExport(req: ExportRequest): Promise<string | null> {
  const paths = await runExportFiles(req);
  return paths ? paths[paths.length - 1] : null;
}

/** Last export per document (by id) for this run of the app: settings and the files written. */
const lastExports = new Map<string, { req: ExportRequest; paths: string[] }>();

export function lastExportFor(docId: string | undefined): { req: ExportRequest; paths: string[] } | null {
  return (docId && lastExports.get(docId)) || null;
}

const EXPORT_FORMATS: ExportFormat[] = ['png', 'jpg', 'svg', 'pdf'];

/** Formats the policy allows, in menu order. */
export function enabledExportFormats(): ExportFormat[] {
  return EXPORT_FORMATS.filter((f) => editor.feature(`export-${f}` as never));
}

/** The format Export… opens on: last used for this document, PDF for Layout documents, else PNG. */
export function exportFormatFor(): ExportFormat {
  const doc = editor.doc;
  return defaultExportFormat(doc?.studio, lastExportFor(doc?.id)?.req.format, enabledExportFormats());
}

/**
 * "Export again" (UX audit P0-5): repeats the last export of this document with
 * the same settings and files, skipping the dialog. With nothing to repeat it
 * opens the Export dialog instead.
 */
export async function exportAgain(): Promise<string[] | null> {
  const doc = editor.doc;
  if (!doc) return null;
  const last = lastExportFor(doc.id);
  const pages = last ? pagesStillValid(last.req.pages, doc.pages.length) : null;
  // a selection export whose objects are gone opens the dialog instead
  const selGone = !!last?.req.selection?.length && !last.req.selection.some((id) => findNode(doc, id));
  if (!last || !pages || selGone || !enabledExportFormats().includes(last.req.format)) {
    openDialog('export', { format: exportFormatFor() });
    return null;
  }
  const same = pages.length === last.req.pages.length;
  try {
    const paths = await runExportFiles({ ...last.req, pages }, same ? last.paths : []);
    if (paths) toast(paths.length === 1 ? `Exported again: ${paths[0].split(/[\\/]/).pop()}` : `Exported ${paths.length} files again`, 'success');
    const note = takePdfNote();
    if (paths && note) toast(note, 'info');
    return paths;
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, 'error');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Autosave & recovery

let autosaveTimer: number | null = null;
let lastAutosaved: QuvreloDocument | null = null;

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
    const data = await packQuvrelo(doc, (id) => editor.assets.blob(id));
    await window.quvrelo.writeRecovery({ id: s.recoveryId, title: doc.title, savedAt: new Date().toISOString(), originalPath: s.filePath }, data);
    lastAutosaved = doc;
    editor.collectGarbage();
  } catch (e) {
    console.warn('Autosave failed', e);
  }
}

export async function restoreRecovery(id: string): Promise<void> {
  const data = await window.quvrelo.readRecovery(id);
  if (!data) {
    toast('Recovery file is no longer available', 'error');
    return;
  }
  const { doc, assets } = await unpackQuvrelo(data);
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
  if (!editor.doc) return null;
  const path = await handInBundle(studentName, packCurrent);
  markStep('export');
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

export function cloneForClipboard(ids: string[]): { nodes: SceneNode[]; stories: QuvreloDocument['stories'] } | null {
  const doc = editor.doc;
  if (!doc) return null;
  const nodes = ids.map((id) => findNode(doc, id)?.node).filter((n): n is SceneNode => !!n).map((n) => structuredCloneSafe(n));
  const stories: QuvreloDocument['stories'] = {};
  const visit = (list: SceneNode[]) => list.forEach((n) => {
    if (n.type === 'textframe' && doc.stories[n.storyId]) stories[n.storyId] = structuredCloneSafe(doc.stories[n.storyId]);
    if (n.type === 'group') visit(n.children);
  });
  visit(nodes);
  return { nodes, stories };
}
