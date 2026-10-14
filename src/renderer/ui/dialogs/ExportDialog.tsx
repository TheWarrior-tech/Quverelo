import { useEffect, useMemo, useRef, useState } from 'react';
import { editor } from '../../state/editor';
import { closeDialog, toast } from '../../state/bus';
import { runExport, type ExportRequest } from '../../state/io';
import { exportSvg, renderPageCanvas } from '../../engine/export';
import { createCanvas, ctx2d } from '../../engine/assets';
import { Dialog } from './DialogHost';
import { Check, Field, Segmented, formatBytes } from './controls';

type Format = ExportRequest['format'];

const FORMATS: { id: Format; name: string; sub: string }[] = [
  { id: 'png', name: 'PNG', sub: 'Lossless, transparency' },
  { id: 'jpg', name: 'JPEG', sub: 'Compact, for photos' },
  { id: 'svg', name: 'SVG', sub: 'Scalable vectors' },
  { id: 'pdf', name: 'PDF', sub: 'Print-ready pages' },
];

const SCALES: { v: number; label: string }[] = [
  { v: 0.5, label: '0.5×' },
  { v: 1, label: '1×' },
  { v: 2, label: '2×' },
  { v: 3, label: '3×' },
  { v: 4, label: '4×' },
  { v: 300 / 96, label: 'Print · 300 dpi' },
];

const PREVIEW_MAX = 512;

function toBlobSize(c: HTMLCanvasElement, type: string, quality?: number): Promise<number> {
  return new Promise((res) => c.toBlob((b) => res(b?.size ?? 0), type, quality));
}

function flatten(c: HTMLCanvasElement): HTMLCanvasElement {
  const flat = createCanvas(c.width, c.height);
  const x = ctx2d(flat);
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, flat.width, flat.height);
  x.drawImage(c, 0, 0);
  return flat;
}

export function ExportDialog({ format: initial }: { format: Format }) {
  const doc = editor.doc!;
  const formats = FORMATS.filter((f) => editor.feature(`export-${f.id}` as never));
  const [format, setFormat] = useState<Format>(formats.some((f) => f.id === initial) ? initial : formats[0]?.id ?? 'png');
  const [scale, setScale] = useState(1);
  const [dpi, setDpi] = useState(doc.settings.unit === 'px' ? 150 : 300);
  const [quality, setQuality] = useState(90);
  const [transparent, setTransparent] = useState(!doc.settings.background);
  const [bleed, setBleed] = useState(false);
  const [cropMarks, setCropMarks] = useState(false);
  const [range, setRange] = useState<'current' | 'all'>(initial === 'pdf' ? 'all' : 'current');
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const cur = Math.max(0, editor.activePageIndex);
  const multi = doc.pages.length > 1;
  const pages = range === 'all' ? doc.pages.map((_, i) => i) : [cur];
  const b = bleed ? doc.settings.bleed : 0;
  const k = format === 'pdf' ? dpi / 96 : scale;
  const pxW = Math.round((doc.settings.width + 2 * b) * k);
  const pxH = Math.round((doc.settings.height + 2 * b) * k);
  const isTransparent = format === 'png' && transparent;
  const ext = format === 'jpg' ? 'jpg' : format;
  const title = doc.title || 'Untitled';
  const fileName = format === 'pdf' || pages.length === 1
    ? `${title}${format !== 'pdf' && multi ? ` - ${doc.pages[cur].name}` : ''}.${ext}`
    : `${title} - ${pages.length} files.${ext}`;

  // preview canvas of the current page (re-rendered when bleed/transparency change)
  const preview = useMemo(() => {
    try {
      const s = PREVIEW_MAX / Math.max(doc.settings.width + 2 * b, doc.settings.height + 2 * b);
      const c = renderPageCanvas(doc, editor.assets, { pageIndex: cur, scale: s, includeBleed: bleed, transparent: isTransparent });
      return format === 'png' ? c : flatten(c);
    } catch {
      return null;
    }
  }, [doc, cur, bleed, isTransparent, format, b]);

  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    if (!preview) {
      host.replaceChildren();
      return;
    }
    preview.style.width = '';
    preview.style.height = '';
    preview.className = isTransparent ? 'checker' : '';
    host.replaceChildren(preview);
  }, [preview, isTransparent]);

  // estimated output size: encode the preview in the target format and scale by pixel count
  useEffect(() => {
    let live = true;
    setEstimate(null);
    const t = window.setTimeout(async () => {
      try {
        let bytes = 0;
        if (format === 'svg') {
          for (const i of pages) bytes += new TextEncoder().encode(exportSvg(doc, editor.assets, i, bleed)).length;
        } else if (preview) {
          const ratio = (pxW * pxH) / (preview.width * preview.height);
          const type = format === 'png' ? 'image/png' : 'image/jpeg';
          const sample = await toBlobSize(preview, type, format === 'png' ? undefined : quality / 100);
          // compression gets more efficient as resolution grows; damp the linear extrapolation
          const per = sample * Math.pow(Math.max(ratio, 0.01), format === 'png' ? 0.9 : 0.8);
          bytes = per * pages.length + (format === 'pdf' ? 2000 + 600 * pages.length : 0);
        }
        if (live) setEstimate(bytes);
      } catch {
        if (live) setEstimate(0);
      }
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [format, preview, pxW, pxH, quality, pages.length, bleed]);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const path = await runExport({ format, pages, scale, dpi, quality: quality / 100, transparent, includeBleed: bleed, cropMarks });
      if (path) {
        toast(`Exported ${path.split(/[\\/]/).pop()}`, 'success');
        closeDialog();
      }
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const raster = format === 'png' || format === 'jpg';
  const hasBleed = doc.settings.bleed > 0;

  return (
    <Dialog
      title="Export"
      size="lg"
      split
      onSubmit={go}
      footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" disabled={busy} onClick={go} data-testid="export-go">{busy ? 'Exporting…' : 'Export…'}</button></>}
    >
      <nav className="dlg-side narrow" role="tablist" aria-label="Format" aria-orientation="vertical">
        <h3 className="micro">Format</h3>
        {formats.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={format === f.id}
            className="nav-item two-line"
            onClick={() => setFormat(f.id)}
            data-autofocus={format === f.id ? '' : undefined}
            data-format={f.id}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const i = formats.findIndex((x) => x.id === format);
              const next = formats[(i + d + formats.length) % formats.length];
              setFormat(next.id);
              (e.currentTarget.parentElement?.querySelector(`[data-format="${next.id}"]`) as HTMLElement | null)?.focus();
            }}
          >
            <span>{f.name}</span>
            <span className="sub">{f.sub}</span>
          </button>
        ))}
      </nav>

      <div className="dlg-main ex-form" role="tabpanel" aria-label={`${format.toUpperCase()} settings`}>
        <div className="fgrid">
          {multi && (
            <Field label="Pages">
              <Segmented label="Pages" value={range} onChange={setRange} options={[{ value: 'current', label: 'Current page' }, { value: 'all', label: `All ${doc.pages.length}` }]} />
            </Field>
          )}
          {raster && (
            <Field label="Scale" htmlFor="ex-scale" hint={`${pxW} × ${pxH} px`}>
              <select id="ex-scale" value={scale} onChange={(e) => setScale(parseFloat(e.target.value))}>
                {SCALES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </Field>
          )}
          {format === 'pdf' && (
            <Field label="Resolution" htmlFor="ex-dpi" hint="Pages are rasterised at this resolution">
              <select id="ex-dpi" value={dpi} onChange={(e) => setDpi(parseInt(e.target.value, 10))}>
                <option value={96}>Screen · 96 dpi</option>
                <option value={150}>Standard · 150 dpi</option>
                <option value={300}>Print · 300 dpi</option>
              </select>
            </Field>
          )}
          {(format === 'jpg' || format === 'pdf') && (
            <Field label="Quality" htmlFor="ex-q">
              <div className="range-row">
                <input id="ex-q" type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(parseInt(e.target.value, 10))} aria-valuetext={`${quality}%`} />
                <span className="value-text">{quality}%</span>
              </div>
            </Field>
          )}
          {format === 'png' && (
            <Field label="Background">
              <Segmented label="Background" value={transparent ? 't' : 'p'} onChange={(v) => setTransparent(v === 't')} options={[{ value: 'p', label: 'Page colour' }, { value: 't', label: 'Transparent' }]} />
            </Field>
          )}
          <Field label="Colour">
            <span className="value-text">sRGB · 8-bit</span>
          </Field>
          <Field label="Area" hint={hasBleed ? undefined : 'This document has no bleed. Set one in Document Setup.'}>
            <Check checked={bleed} onChange={setBleed} disabled={!hasBleed}>Include bleed</Check>
          </Field>
          {format === 'pdf' && (
            <Field label="Marks">
              <Check checked={cropMarks} onChange={setCropMarks}>Crop marks</Check>
            </Field>
          )}
          {format === 'svg' && (
            <p className="note" style={{ margin: 0 }}>Shapes and text stay editable vectors. Photos and pixel layers are embedded as PNG.</p>
          )}
        </div>
      </div>

      <aside className="dlg-aside ex-preview" aria-label="Preview">
        <div className="page-preview" ref={previewRef} />
        <div className="ex-file" title={fileName}>{fileName}</div>
        <dl className="kv">
          <dt>Dimensions</dt>
          <dd>{format === 'svg' ? `${Math.round(doc.settings.width + 2 * b)} × ${Math.round(doc.settings.height + 2 * b)} px` : `${pxW} × ${pxH} px`}</dd>
          <dt>{format === 'pdf' ? 'Pages' : 'Files'}</dt>
          <dd>{pages.length}</dd>
          <dt>Estimated size</dt>
          <dd data-testid="export-estimate">{estimate === null ? 'Calculating…' : `≈ ${formatBytes(estimate)}`}</dd>
        </dl>
      </aside>
    </Dialog>
  );
}
