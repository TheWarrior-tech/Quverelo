import { useEffect, useMemo, useRef, useState } from 'react';
import { editor } from '../../state/editor';
import { closeDialog, toast } from '../../state/bus';
import { runExport, takePdfNote, type ExportRequest } from '../../state/io';
import { exportSvg, pagesHaveImages, renderPageCanvas, renderSelectionCanvas, selectionBounds } from '../../engine/export';
import { createCanvas, ctx2d } from '../../engine/assets';
import { formatSize } from '../../../core/units';
import { parsePageRange } from '../../../core/pageRange';
import { NumberField } from '../controls/NumberField';
import { Dialog } from './DialogHost';
import { Check, Field, Segmented, formatBytes } from './controls';

type Format = ExportRequest['format'];
/** Entries in the format list: PDF comes in two kinds. */
type Kind = 'png' | 'jpg' | 'svg' | 'pdf' | 'pdf-image';
type Area = 'current' | 'all' | 'range' | 'selection';

const KINDS: { id: Kind; format: Format; name: string; sub: string }[] = [
  { id: 'png', format: 'png', name: 'PNG', sub: 'Lossless, transparency' },
  { id: 'jpg', format: 'jpg', name: 'JPEG', sub: 'Compact, for photos' },
  { id: 'svg', format: 'svg', name: 'SVG', sub: 'Scalable vectors' },
  { id: 'pdf', format: 'pdf', name: 'PDF', sub: 'Vectors and live text' },
  { id: 'pdf-image', format: 'pdf', name: 'Image PDF', sub: 'One picture per page' },
];

const SCALE_PRESETS: { v: number; label: string }[] = [
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
  const kinds = KINDS.filter((k) => editor.feature(`export-${k.format}` as never));
  const [kind, setKind] = useState<Kind>(kinds.some((k) => k.id === initial) ? (initial as Kind) : kinds[0]?.id ?? 'png');
  const format = KINDS.find((k) => k.id === kind)!.format;
  const isPdf = format === 'pdf';
  const raster = format === 'png' || format === 'jpg';
  const [scale, setScale] = useState(1);
  const [dpi, setDpi] = useState(doc.settings.unit === 'px' ? 150 : 300);
  const [quality, setQuality] = useState(90);
  const [transparent, setTransparent] = useState(!doc.settings.background);
  const [bleed, setBleed] = useState(false);
  const [cropMarks, setCropMarks] = useState(false);
  const [fileName, setFileName] = useState(doc.title || 'Untitled');
  const multi = doc.pages.length > 1;
  const selIds = editor.ui.selection;
  const selBox = useMemo(() => (selIds.length ? selectionBounds(doc, selIds) : null), [doc, selIds]);
  const [area, setArea] = useState<Area>(initial === 'pdf' && multi ? 'all' : 'current');
  const [rangeText, setRangeText] = useState(multi ? `1–${doc.pages.length}` : '1');
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // areas each format offers
  const areaOptions: { value: Area; label: string; disabled?: boolean }[] = [
    ...(isPdf || multi ? [{ value: 'all' as Area, label: multi ? `All ${doc.pages.length}` : 'Whole document' }] : []),
    ...(multi || !isPdf ? [{ value: 'current' as Area, label: multi ? 'Current' : 'Current page' }] : []),
    ...(isPdf && multi ? [{ value: 'range' as Area, label: 'Range' }] : []),
    ...(raster ? [{ value: 'selection' as Area, label: 'Selection', disabled: !selBox }] : []),
  ];
  const effArea: Area = areaOptions.some((o) => o.value === area && !o.disabled) ? area : areaOptions.some((o) => o.value === 'all') && isPdf ? 'all' : 'current';

  const cur = Math.max(0, editor.activePageIndex);
  const range = effArea === 'range' ? parsePageRange(rangeText, doc.pages.length) : null;
  const pages = effArea === 'all' ? doc.pages.map((_, i) => i) : effArea === 'range' ? (range?.ok ? range.pages : []) : [cur];
  const useSel = effArea === 'selection' && !!selBox;
  const b = bleed && !useSel ? doc.settings.bleed : 0;
  const baseW = useSel ? selBox!.w : doc.settings.width + 2 * b;
  const baseH = useSel ? selBox!.h : doc.settings.height + 2 * b;
  const k = kind === 'pdf-image' ? dpi / 96 : scale;
  const pxW = Math.round(baseW * k);
  const pxH = Math.round(baseH * k);
  const isTransparent = format === 'png' && transparent;
  const ext = format === 'jpg' ? 'jpg' : format;
  const title = fileName.trim() || 'Untitled';
  const outName = isPdf || pages.length === 1 || useSel
    ? `${title}${useSel ? ' - selection' : !isPdf && multi ? ` - ${doc.pages[pages[0] ?? cur].name}` : ''}.${ext}`
    : `${title} - ${pages.length} files.${ext}`;
  const hasImages = useMemo(() => pagesHaveImages(doc, pages), [doc, pages.join(',')]);
  const showQuality = format === 'jpg' || kind === 'pdf-image' || (kind === 'pdf' && hasImages);
  // a PDF page is physical: show it in the document unit (mm for a px document), pt in the tooltip (CRITIQUE-3 N1)
  const pageUnit = doc.settings.unit === 'px' ? 'mm' : doc.settings.unit;
  const physical = formatSize(baseW, baseH, pageUnit);
  const physicalPt = formatSize(baseW, baseH, 'pt', 0);

  // preview canvas of the current page or the selection
  const preview = useMemo(() => {
    try {
      if (useSel) {
        const s = PREVIEW_MAX / Math.max(selBox!.w, selBox!.h);
        const c = renderSelectionCanvas(doc, editor.assets, selIds, s, isTransparent);
        return c && (format === 'png' ? c : flatten(c));
      }
      const pv = pages[0] ?? cur;
      const s = PREVIEW_MAX / Math.max(doc.settings.width + 2 * b, doc.settings.height + 2 * b);
      const c = renderPageCanvas(doc, editor.assets, { pageIndex: pv, scale: s, includeBleed: b > 0, transparent: isTransparent });
      return format === 'png' ? c : flatten(c);
    } catch {
      return null;
    }
  }, [doc, cur, b, isTransparent, format, useSel, selBox, pages[0]]);

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

  // estimated output size
  useEffect(() => {
    let live = true;
    setEstimate(null);
    const t = window.setTimeout(async () => {
      try {
        let bytes = 0;
        if (format === 'svg') {
          for (const i of pages) bytes += new TextEncoder().encode(exportSvg(doc, editor.assets, i, b > 0)).length;
        } else if (kind === 'pdf') {
          // vectors are small; photos dominate. A rough per-page figure plus embedded images.
          let img = 0;
          if (hasImages && preview) {
            const sample = await toBlobSize(preview, 'image/jpeg', quality / 100);
            img = sample * 4;
          }
          bytes = 30_000 + pages.length * 6_000 + img * pages.length;
        } else if (preview) {
          const ratio = (pxW * pxH) / (preview.width * preview.height);
          const type = format === 'png' ? 'image/png' : 'image/jpeg';
          const sample = await toBlobSize(preview, type, format === 'png' ? undefined : quality / 100);
          // compression gets more efficient as resolution grows; damp the linear extrapolation
          const per = sample * Math.pow(Math.max(ratio, 0.01), format === 'png' ? 0.9 : 0.8);
          const n = useSel ? 1 : pages.length;
          bytes = per * n + (isPdf ? 2000 + 600 * n : 0);
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
  }, [kind, preview, pxW, pxH, quality, pages.length, b, hasImages]);

  const rangeError = effArea === 'range' && range && !range.ok ? range.error : null;
  const canGo = !busy && !rangeError && pages.length > 0;

  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    try {
      const path = await runExport({
        format, pages, scale, dpi, quality: quality / 100, transparent, includeBleed: b > 0, cropMarks,
        pdfKind: kind === 'pdf-image' ? 'image' : isPdf ? 'vector' : undefined,
        selection: useSel ? [...selIds] : undefined,
        fileName: title,
      });
      if (path) {
        toast(`Exported ${path.split(/[\\/]/).pop()}`, 'success');
        const note = takePdfNote();
        if (note) toast(note, 'info');
        closeDialog();
      }
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const hasBleed = doc.settings.bleed > 0;
  const presetValue = SCALE_PRESETS.find((p) => Math.abs(p.v - scale) < 1e-6)?.v ?? 'custom';

  return (
    <Dialog
      title="Export"
      size="lg"
      split
      className="export-dialog"
      onSubmit={go}
      footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" disabled={!canGo} onClick={go} data-testid="export-go">{busy ? 'Exporting…' : 'Export…'}</button></>}
    >
      <nav className="dlg-side narrow" role="tablist" aria-label="Format" aria-orientation="vertical">
        <h3 className="micro">Format</h3>
        {kinds.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={kind === f.id}
            className="nav-item two-line"
            onClick={() => setKind(f.id)}
            data-autofocus={kind === f.id ? '' : undefined}
            data-format={f.id}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const i = kinds.findIndex((x) => x.id === kind);
              const next = kinds[(i + d + kinds.length) % kinds.length];
              setKind(next.id);
              (e.currentTarget.parentElement?.querySelector(`[data-format="${next.id}"]`) as HTMLElement | null)?.focus();
            }}
          >
            <span>{f.name}</span>
            <span className="sub">{f.sub}</span>
          </button>
        ))}
      </nav>

      <div className="dlg-main ex-form" role="tabpanel" aria-label={`${KINDS.find((x) => x.id === kind)!.name} settings`}>
        <div className="fgrid">
          <Field label="File name" htmlFor="ex-name">
            <input id="ex-name" type="text" value={fileName} spellCheck={false} onChange={(e) => setFileName(e.target.value)} data-testid="export-name" />
          </Field>
          {areaOptions.length > 1 ? (
            <Field label="Area" hint={rangeError ?? (raster && !selBox ? 'Select objects to export just them.' : undefined)}>
              <Segmented label="Area" value={effArea} onChange={(v) => setArea(v as Area)} options={areaOptions} />
              {effArea === 'range' && (
                <input
                  type="text"
                  aria-label="Page range"
                  aria-invalid={!!rangeError}
                  className={rangeError ? 'invalid' : undefined}
                  value={rangeText}
                  placeholder="1–3, 5"
                  spellCheck={false}
                  onChange={(e) => setRangeText(e.target.value)}
                  data-testid="export-range"
                />
              )}
            </Field>
          ) : (
            <Field label="Area"><span className="value-text">{areaOptions[0]?.label ?? 'Current page'}</span></Field>
          )}
          {raster && (
            <Field label="Scale" hint={`${pxW} × ${pxH} px`}>
              <div className="ex-scale">
                <NumberField ariaLabel="Scale" value={scale} unit="×" min={0.05} max={16} step={0.25} digits={2} onCommit={setScale} className="ex-scale-k" />
                <NumberField ariaLabel="Width in pixels" label="W" value={pxW} unit="px" min={1} max={16384} step={1} digits={0} onCommit={(w) => setScale(Math.max(0.01, w / baseW))} className="ex-scale-w" />
                <select aria-label="Scale presets" value={presetValue} onChange={(e) => e.target.value !== 'custom' && setScale(parseFloat(e.target.value))}>
                  {presetValue === 'custom' && <option value="custom">Custom</option>}
                  {SCALE_PRESETS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
              </div>
            </Field>
          )}
          {kind === 'pdf-image' && (
            <Field label="Image resolution" htmlFor="ex-dpi" hint={`Each page becomes one ${pxW} × ${pxH} px picture`}>
              <select id="ex-dpi" value={dpi} onChange={(e) => setDpi(parseInt(e.target.value, 10))}>
                <option value={96}>Screen · 96 dpi</option>
                <option value={150}>Standard · 150 dpi</option>
                <option value={300}>Print · 300 dpi</option>
              </select>
            </Field>
          )}
          {showQuality && (
            <Field label={kind === 'pdf' ? 'Photo quality' : 'Quality'} htmlFor="ex-q">
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
          {!useSel && (
            <Field label="Bleed" hint={hasBleed ? undefined : 'This document has no bleed. Set one in Document setup.'}>
              <Check checked={bleed} onChange={setBleed} disabled={!hasBleed}>Include bleed</Check>
            </Field>
          )}
          {isPdf && (
            <Field label="Marks">
              <Check checked={cropMarks} onChange={setCropMarks}>Crop marks</Check>
            </Field>
          )}
          <Field label="Colour">
            <span className="value-text">{isPdf ? 'RGB · not PDF/X' : 'sRGB · 8-bit'}</span>
          </Field>
          {format === 'svg' && <p className="note ex-note">Shapes and text stay editable vectors. Photos and pixel layers are embedded as PNG.</p>}
          {kind === 'pdf' && <p className="note ex-note" data-testid="export-pdf-note">Shapes and text stay sharp vectors with embedded fonts, so text can be searched and copied. Photos keep their own resolution. Text in system fonts and see-through gradients are placed as images.</p>}
          {kind === 'pdf-image' && <p className="note ex-note" data-testid="export-pdf-note">Every page is flattened into one picture, so text can't be selected or searched. Use it when a viewer or printer has trouble with the vector PDF.</p>}
        </div>
      </div>

      <aside className="dlg-aside ex-preview" aria-label="Preview">
        <div className="page-preview" ref={previewRef} />
        <div className="ex-file" data-tip={outName}>{outName}</div>
        <dl className="kv">
          <dt>{isPdf ? 'Page size' : 'Dimensions'}</dt>
          <dd data-testid="export-dims" data-tip={isPdf ? physicalPt : undefined}>
            {isPdf ? physical : format === 'svg' ? `${Math.round(baseW)} × ${Math.round(baseH)} px` : `${pxW} × ${pxH} px`}
          </dd>
          {isPdf && kind === 'pdf-image' && (<><dt>Pixels</dt><dd>{`${pxW} × ${pxH} px`}</dd></>)}
          <dt>{isPdf ? 'Pages' : 'Files'}</dt>
          <dd>{useSel ? 1 : pages.length}</dd>
          <dt>Estimated size</dt>
          <dd data-testid="export-estimate">{estimate === null ? 'Calculating…' : `≈ ${formatBytes(estimate)}`}</dd>
        </dl>
      </aside>
    </Dialog>
  );
}
