/**
 * Export persona: renders every enabled slice in each of its outputs (PNG /
 * JPEG at @1x, @2x…, SVG, PDF) and writes them into one folder.
 */
import { plannedFiles, sliceDocument } from '../../core/slices';
import type { QuvreloDocument, Slice } from '../../core/types';
import { editor } from './editor';
import { toast } from './bus';
import { exportPdf, exportRaster, exportSvg } from '../engine/export';
import { renderLocalBounds } from '../engine/draw';

export interface SliceFile {
  name: string;
  data: Uint8Array;
}

/** Render the files for the given slices (all enabled ones by default). */
export async function renderSlices(doc: QuvreloDocument, slices: Slice[] = doc.slices ?? []): Promise<SliceFile[]> {
  const out: SliceFile[] = [];
  for (const { slice, output, file } of plannedFiles(slices)) {
    const sd = sliceDocument(doc, slice, renderLocalBounds);
    if (!sd) continue;
    let data: Uint8Array;
    switch (output.format) {
      case 'png':
      case 'jpg':
        data = await exportRaster(sd, editor.assets, { pageIndex: 0, scale: output.scale, includeBleed: false, transparent: output.format === 'png', format: output.format, quality: 0.92 });
        break;
      case 'svg':
        data = new TextEncoder().encode(exportSvg(sd, editor.assets, 0, false));
        break;
      case 'pdf':
        data = (await exportPdf(sd, editor.assets, { pages: [0], includeBleed: false, cropMarks: false, quality: 0.9, fallbackDpi: 300 })).bytes;
        break;
    }
    out.push({ name: file, data });
  }
  return out;
}

/** File ▸ Export Slices: every enabled slice, every output, into a folder. */
export async function exportSlices(only?: string[]): Promise<string | null> {
  const doc = editor.doc;
  if (!doc) return null;
  const slices = (doc.slices ?? []).filter((s) => s.enabled && (!only || only.includes(s.id)));
  if (!slices.length) {
    toast('No slices to export yet. Add one in the Export tab');
    return null;
  }
  const files = await renderSlices(doc, slices);
  const dir = await window.quvrelo.saveFilesToFolder({ files, title: 'Export slices to folder' });
  if (dir) toast(`Exported ${files.length} file${files.length === 1 ? '' : 's'}`);
  return dir;
}
