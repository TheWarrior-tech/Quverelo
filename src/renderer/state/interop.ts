/**
 * File-format interop in the renderer: open/place PSD, AI/PDF and IDML, export
 * PSD, classroom assignment packs and hand-in bundles, and running scripts.
 * The format logic lives in core/interop and core/classroom (pure, tested);
 * this module registers decoded pixels with the AssetStore and talks to the UI.
 */
import { importPsd } from '../../core/interop/psd';
import { importPdfVectors } from '../../core/interop/pdfImport';
import { importIdml } from '../../core/interop/idml';
import type { ImportResult } from '../../core/interop/types';
import { ASSIGNMENT_EXT, assignmentPackName, buildAssignmentPack, buildHandInBundle, isHandInBundle, readAssignmentPack, readHandInBundle, teacherBrief } from '../../core/classroom';
import { packQuvrelo, unpackQuvrelo } from '../../core/serialization';
import { make } from '../../core/document';
import { addNodes } from '../../core/commands';
import type { FeatureId } from '../../core/policy';
import type { Id, QuvreloDocument, SceneNode } from '../../core/types';
import { runScript, type ScriptRunResult } from '../../core/scripting/runner';
import { pixelsToCanvas } from '../engine/assets';
import { exportImagePdf } from '../engine/export';
import { exportPsd } from '../engine/psdExport';
import { editor } from './editor';
import { openDialog, toast } from './bus';
import { markStep } from './onboarding';

export type InteropKind = 'psd' | 'ai' | 'pdf' | 'idml' | 'assignment' | 'zip';

const EXT_KIND: Record<string, InteropKind> = { psd: 'psd', psb: 'psd', ai: 'ai', pdf: 'pdf', idml: 'idml', [ASSIGNMENT_EXT]: 'assignment', zip: 'zip' };
const KIND_FEATURE: Partial<Record<InteropKind, FeatureId>> = { psd: 'import-psd', ai: 'import-ai', pdf: 'import-ai', idml: 'import-idml', assignment: 'assignments', zip: 'assignments' };
const KIND_LABEL: Record<InteropKind, string> = { psd: 'Photoshop file', ai: 'Illustrator file', pdf: 'PDF', idml: 'InDesign file', assignment: 'assignment pack', zip: 'hand-in' };

export function interopKind(name: string): InteropKind | null {
  const m = /\.([a-z0-9-]+)$/i.exec(name);
  return m ? EXT_KIND[m[1].toLowerCase()] ?? null : null;
}

/** Extensions for the Open dialog, limited to what the policy allows. */
export function openableInteropExtensions(): string[] {
  return Object.entries(EXT_KIND)
    .filter(([ext, k]) => ext !== 'zip' && (!KIND_FEATURE[k] || editor.feature(KIND_FEATURE[k]!)))
    .map(([ext]) => ext);
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, '').replace(/\.quvrelo-assignment$/i, '');
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');

/** Register an importer's pixels/encoded images in the asset store (ids are kept). */
async function registerAssets(r: ImportResult): Promise<QuvreloDocument> {
  let doc = r.doc;
  for (const [id, px] of r.pixels) editor.assets.add(pixelsToCanvas(px), 'image/png', null, id);
  for (const [id, e] of r.encoded) {
    try {
      const { width, height } = await editor.assets.addBytes(e.bytes, e.mime, id);
      doc = { ...doc, assets: { ...doc.assets, [id]: { ...doc.assets[id], width, height } } };
    } catch {
      r.warnings.push('An image could not be decoded and was left out');
    }
  }
  return doc;
}

function report(name: string, warnings: string[]): void {
  if (!warnings.length) {
    toast(`Opened ${name}`, 'success');
    return;
  }
  toast(`Opened ${name} — ${warnings.length} thing${warnings.length > 1 ? 's' : ''} changed on import`, 'info', {
    action: { label: 'Details', run: () => openDialog('import-report', { name, warnings }) },
    duration: 10000,
  });
}

async function linkResolver(idmlPath: string | null) {
  return async (uri: string): Promise<Uint8Array | null> => {
    const raw = decodeURIComponent(uri.replace(/^file:(\/\/)?/i, ''));
    const file = raw.split(/[\\/]/).pop() ?? raw;
    const candidates = [raw, ...(idmlPath ? [`${dirOf(idmlPath)}/Links/${file}`, `${dirOf(idmlPath)}/${file}`] : [])];
    if (/^\/[A-Za-z]:/.test(raw)) candidates.unshift(raw.slice(1)); // file:/C:/…
    for (const c of candidates) {
      try {
        return (await window.quvrelo.readFile(c)).data;
      } catch {
        /* try the next location */
      }
    }
    return null;
  };
}

async function importAny(kind: InteropKind, data: Uint8Array, name: string, path: string | null): Promise<ImportResult> {
  switch (kind) {
    case 'psd': return importPsd(data, baseName(name));
    case 'ai': case 'pdf': return importPdfVectors(data, baseName(name));
    case 'idml': return importIdml(data, baseName(name), await linkResolver(path));
    default: throw new Error(`Cannot import ${name}`);
  }
}

function ensureAllowed(kind: InteropKind): void {
  const f = KIND_FEATURE[kind];
  if (f && !editor.feature(f)) throw new Error(`Opening ${KIND_LABEL[kind]}s is turned off by your administrator`);
}

/** Open a PSD / AI / PDF / IDML / assignment pack / hand-in bundle as a new document. Returns false if not ours. */
export async function openInterop(data: Uint8Array, name: string, path: string | null): Promise<boolean> {
  const kind = interopKind(name);
  if (!kind) return false;
  if (kind === 'zip' && !(await isHandInBundle(data))) throw new Error('This zip file is not a Quvrelo hand-in');
  ensureAllowed(kind);
  if (kind === 'assignment') {
    await openAssignmentPack(data);
    return true;
  }
  if (kind === 'zip') {
    const h = await readHandInBundle(data);
    await openQuvreloData(h.work, null);
    toast(`${h.manifest.student} — ${h.manifest.assignment}, handed in ${new Date(h.manifest.submittedAt).toLocaleString()}${h.intact ? '' : ' (warning: the work file does not match its checksum)'}`, h.intact ? 'success' : 'error', { duration: 10000 });
    return true;
  }
  const r = await importAny(kind, data, name, path);
  editor.assets.clear();
  const doc = await registerAssets(r);
  editor.openSession(doc, null, doc.studio);
  markStep('place');
  report(name, r.warnings);
  return true;
}

async function openQuvreloData(bytes: Uint8Array, path: string | null): Promise<QuvreloDocument> {
  const { doc, assets } = await unpackQuvrelo(bytes);
  editor.assets.clear();
  for (const [id, blob] of assets) await editor.assets.addBytes(blob.bytes, blob.mime, id);
  editor.openSession(doc, path);
  return doc;
}

/** Place a PSD / AI / PDF into the current document as one group. Returns false if not ours. */
export async function placeInterop(data: Uint8Array, name: string): Promise<boolean> {
  const kind = interopKind(name);
  if (!kind || kind === 'idml' || kind === 'assignment' || kind === 'zip') return false;
  ensureAllowed(kind);
  const container = editor.activeContainer;
  if (!editor.doc || !container) return false;
  const r = await importAny(kind, data, name, null);
  const imported = await registerAssets(r);
  const nodes: SceneNode[] = imported.pages[0].nodes;
  if (!nodes.length) {
    toast(`${name} has nothing to place`, 'info');
    return true;
  }
  const W = editor.doc.settings.width, H = editor.doc.settings.height;
  const iw = imported.settings.width, ih = imported.settings.height;
  const fit = Math.min(1, (W * 0.9) / iw, (H * 0.9) / ih);
  const g = make.group(nodes.map((n) => ({ ...n, x: n.x - iw / 2, y: n.y - ih / 2 })), { name: baseName(name), x: W / 2, y: H / 2, scaleX: fit, scaleY: fit });
  editor.commit(`Place ${KIND_LABEL[kind]}`, (d) => addNodes({ ...d, assets: { ...d.assets, ...imported.assets } }, container.id, [g]));
  editor.select([g.id]);
  markStep('place');
  if (r.warnings.length) toast(`Placed ${name} — ${r.warnings.length} thing${r.warnings.length > 1 ? 's' : ''} changed`, 'info', { action: { label: 'Details', run: () => openDialog('import-report', { name, warnings: r.warnings }) } });
  return true;
}

// ---------------------------------------------------------------------------
// PSD export

export async function exportPsdFile(): Promise<string | null> {
  const doc = editor.doc;
  if (!doc) return null;
  if (!editor.feature('export-psd')) {
    toast('PSD export is turned off by your administrator');
    return null;
  }
  const pageIndex = Math.max(0, editor.activePageIndex);
  try {
    const data = exportPsd(doc, editor.assets, pageIndex);
    const suffix = doc.pages.length > 1 ? ` - ${doc.pages[pageIndex].name}` : '';
    const p = await window.quvrelo.saveFile({ path: null, data, defaultName: `${doc.title || 'Untitled'}${suffix}.psd`, filters: [{ name: 'Photoshop', extensions: ['psd'] }], title: 'Export as PSD' });
    if (p) {
      toast(`Exported ${p.split(/[\\/]/).pop()} — each object is a layer`, 'success');
      markStep('export');
    }
    return p;
  } catch (e) {
    toast(`PSD export failed: ${(e as Error).message}`, 'error');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Classroom

let appVersion = '';
async function version(): Promise<string> {
  if (!appVersion) appVersion = (await window.quvrelo.getAppInfo().catch(() => ({ version: 'unknown' }))).version;
  return appVersion;
}

/** Teacher: save the open document + its assignment details as a pack students open. */
export async function saveAssignmentPack(): Promise<string | null> {
  const doc = editor.doc;
  if (!doc) return null;
  if (!doc.assignment?.title) {
    toast('Add the assignment details first', 'info');
    openDialog('assignment');
    return null;
  }
  const brief = teacherBrief(doc.assignment);
  // the template must not carry a previous student's name
  const clean = { ...doc, assignment: brief };
  const template = await packQuvrelo(clean, (id) => editor.assets.blob(id));
  const data = await buildAssignmentPack(template, brief, await version());
  const p = await window.quvrelo.saveFile({ path: null, data, defaultName: assignmentPackName(brief), filters: [{ name: 'Quvrelo Assignment', extensions: [ASSIGNMENT_EXT] }], title: 'Save assignment pack' });
  if (p) toast(`Saved ${p.split(/[\\/]/).pop()} — share it with the class`, 'success');
  return p;
}

/** Student: open a pack as a new, untitled document with the brief attached. */
export async function openAssignmentPack(data: Uint8Array): Promise<void> {
  const { manifest, template } = await readAssignmentPack(data);
  const doc = await openQuvreloData(template, null);
  const a = manifest.assignment;
  editor.preview((d) => ({ ...d, title: a.title || d.title, assignment: { ...a } }));
  editor.history!.replace({ ...editor.doc! }); // unsaved: the student saves their own copy
  toast(`${a.title}${a.className ? ` · ${a.className}` : ''}${a.dueDate ? ` · due ${a.dueDate}` : ''}. Hand in with File › Hand In when you are done.`, 'success', { duration: 10000 });
  void doc;
}

/** Student: build the hand-in bundle (work + PDF preview + manifest) and copy it to the hand-in folder. */
export async function handInBundle(studentName: string, packWork: () => Promise<Uint8Array>): Promise<string> {
  const doc = editor.doc!;
  const info = doc.assignment ?? { title: doc.title, className: 'Class', teacher: '', dueDate: '', instructions: '' };
  const at = new Date();
  editor.commit('Hand in', (d) => ({ ...d, assignment: { ...info, studentName, submittedAt: at.toISOString() } }));
  const work = await packWork();
  let preview: Uint8Array | null = null;
  if (editor.policy.handInIncludePreview !== false) {
    try {
      preview = await exportImagePdf(editor.doc!, editor.assets, { dpi: 110, includeBleed: false, cropMarks: false, quality: 0.85, pages: editor.doc!.pages.map((_, i) => i) });
    } catch {
      preview = null; // the work file is what matters; never block a hand-in on the preview
    }
  }
  const b = await buildHandInBundle({ work, preview, info, student: studentName, pages: doc.pages.length, appVersion: await version(), at });
  return window.quvrelo.handIn({ data: b.data, fileName: b.name, className: info.className || 'Class', studentName });
}

// ---------------------------------------------------------------------------
// Scripts

export async function runUserScript(name: string, source: string, language: 'js' | 'ts'): Promise<ScriptRunResult | null> {
  const doc = editor.doc;
  if (!doc) return null;
  if (!editor.feature('scripting')) {
    toast('Scripts are turned off by your administrator');
    return null;
  }
  const r = await runScript(source, doc, editor.ui.selection as Id[], { language });
  if (r.ok && r.changed) {
    editor.commit(`Script: ${name}`, () => r.doc);
    editor.select(r.selection);
  } else if (r.ok) editor.select(r.selection);
  return r;
}
