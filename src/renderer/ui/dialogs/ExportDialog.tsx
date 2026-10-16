import { useEffect, useMemo, useRef, useState } from 'react';
import { editor } from '../../state/editor';
import { closeDialog, toast } from '../../state/bus';
import { runExport, takePdfNote, type ExportRequest } from '../../state/io';
import { exportSvgWithImages, pagesHaveImages, renderPageCanvas, renderSelectionCanvas, selectionBounds } from '../../engine/export';
import type { SvgImageEncoding, SvgImageMode } from '../../../core/svgImages';
import { createCanvas, ctx2d } from '../../engine/assets';
import { docPxPerInch, formatSize, physicalPx } from '../../../core/units';
import { parsePageRange } from '../../../core/pageRange';
import { NumberField, SliderField } from '../controls/NumberField';
import { Menu, type MenuEntry } from '../controls/Menu';
import { Icon } from '../Icons';
import { Dialog } from './DialogHost';
import { Check, Field, Segmented, formatBytes } from './controls';
import { CMYK_PROFILES, docColour, PROFILES, type CmykProfileId } from '../../../core/colour/profiles';
import { applyLut } from '../../../core/colour/lut3d';
import { colourEngine, whenColourReady } from '../../engine/colour';

type Format = ExportRequest['format'];
/** Entries in the format list: PDF comes in two kinds. */
type Kind = 'png' | 'jpg' | 'svg' | 'pdf' | 'pdf-image' | 'pdf-x4' | 'pdf-x1a';
type Area = 'current' | 'all' | 'range' | 'selection';

const KINDS: { id: Kind; format: Format; name: string; sub: string }[] = [
  { id: 'png', format: 'png', name: 'PNG', sub: 'Lossless, transparency' },
  { id: 'jpg', format: 'jpg', name: 'JPEG', sub: 'Compact, for photos' },
  { id: 'svg', format: 'svg', name: 'SVG', sub: 'Scalable vectors' },
  { id: 'pdf', format: 'pdf', name: 'PDF', sub: 'Vectors and live text' },
  { id: 'pdf-image', format: 'pdf', name: 'Image PDF', sub: 'One picture per page' },
  { id: 'pdf-x4', format: 'pdf', name: 'PDF/X-4', sub: 'Print · CMYK, live transparency' },
  { id: 'pdf-x1a', format: 'pdf', name: 'PDF/X-1a', sub: 'Print · CMYK, flattened' },
];

const X_NAME: Partial<Record<Kind, string>> = { 'pdf-x4': 'PDF/X-4', 'pdf-x1a': 'PDF/X-1a:2003' };

const SCALE_PRESETS: { v: number; label: string; detail?: string }[] = [
  { v: 0.5, label: '0.5×' },
  { v: 1, label: '1×' },
  { v: 2, label: '2×' },
  { v: 3, label: '3×' },
  { v: 4, label: '4×' },
  { v: 300 / 96, label: '3.13×', detail: 'Print · 300 dpi' },
];

/** "2×", "0.5×", "3.13×": the scale as the field shows it. */
export function formatScale(k: number): string {
  return `${Math.round(k * 100) / 100}×`;
}

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
  const isX = kind === 'pdf-x4' || kind === 'pdf-x1a';
  const docCol = docColour(doc.settings);
  const [press, setPress] = useState<CmykProfileId>(docCol.cmykProfile);
  // the preview of a print PDF is soft-proofed once the colour engine has loaded
  const [engineReady, setEngineReady] = useState(!!colourEngine());
  useEffect(() => {
    if (isX && !engineReady) whenColourReady(() => setEngineReady(true));
  }, [isX, engineReady]);
  const raster = format === 'png' || format === 'jpg';
  const [scale, setScale] = useState(1);
  /** The Scale control edits either the factor (2×) or the output width (W px); the other is the read-only hint. */
  const [scaleBy, setScaleBy] = useState<'factor' | 'width'>('factor');
  const [presetAnchor, setPresetAnchor] = useState<HTMLElement | null>(null);
  const scaleFieldRef = useRef<HTMLDivElement>(null);
  // a px document's own Output DPI is its native image resolution (CRITIQUE-4 P2-17)
  const [dpi, setDpi] = useState(doc.settings.unit === 'px' ? [96, 150, 300].reduce((a, b) => (Math.abs(b - doc.settings.dpi) < Math.abs(a - doc.settings.dpi) ? b : a)) : 300);
  const [quality, setQuality] = useState(90);
  const [svgMode, setSvgMode] = useState<SvgImageMode>('embed');
  const [svgEnc, setSvgEnc] = useState<SvgImageEncoding>('png');
  const [transparent, setTransparent] = useState(!doc.settings.background);
  // PNG bit depth: 16-bit Photo documents export 16 bits per channel by default
  const [pngDepth, setPngDepth] = useState<8 | 16>(docCol.bitDepth);
  const outDepth: 8 | 16 = format === 'png' ? pngDepth : 8;
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
    ...(isPdf || multi ? [{ value: 'all' as Area, label: multi ? `All (${doc.pages.length})` : 'Whole document' }] : []),
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
  const k = kind === 'pdf-image' ? dpi / docPxPerInch(doc.settings) : scale;
  const pxW = Math.round(baseW * k);
  const pxH = Math.round(baseH * k);
  const isTransparent = format === 'png' && transparent;
  const ext = format === 'jpg' ? 'jpg' : format;
  const title = fileName.trim() || 'Untitled';
  const outName = isPdf || pages.length === 1 || useSel
    ? `${title}${useSel ? ' - selection' : !isPdf && multi ? ` - ${doc.pages[pages[0] ?? cur].name}` : ''}.${ext}`
    : `${title} - ${pages.length} files.${ext}`;
  const hasImages = useMemo(() => pagesHaveImages(doc, pages), [doc, pages.join(',')]);
  const svgImages = format === 'svg' && hasImages;
  // print PDFs keep photos lossless (CMYK Flate), so there is no quality to choose
  const showQuality = format === 'jpg' || kind === 'pdf-image' || (kind === 'pdf' && hasImages) || (svgImages && svgEnc === 'jpeg-opaque');
  // a PDF page is physical: show it in the document unit (mm for a px document, sized
  // by its Output DPI), pt in the tooltip (CRITIQUE-3 N1, CRITIQUE-4 P2-17)
  const pageUnit = doc.settings.unit === 'px' ? 'mm' : doc.settings.unit;
  const physW = physicalPx(baseW, doc.settings);
  const physH = physicalPx(baseH, doc.settings);
  const physical = formatSize(physW, physH, pageUnit);
  const physicalPt = formatSize(physW, physH, 'pt', 0);

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
      const out = format === 'png' ? c : flatten(c);
      const e = isX && engineReady ? colourEngine() : null;
      if (e) {
        // show the page as the press will print it
        const lut = e.displayLut({ rgbProfile: docCol.rgbProfile, cmykProfile: press, proof: true, gamut: false, intent: docCol.intent });
        const x = ctx2d(out);
        const img = x.getImageData(0, 0, out.width, out.height);
        applyLut(img.data, lut);
        x.putImageData(img, 0, 0);
        out.dataset.proof = press;
      }
      return out;
    } catch {
      return null;
    }
  }, [doc, cur, b, isTransparent, format, useSel, selBox, pages[0], isX, press, engineReady]);

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
          for (const i of pages) {
            const out = exportSvgWithImages(doc, editor.assets, i, b > 0, { mode: svgMode, encoding: svgEnc, quality: quality / 100 }, title);
            bytes += new TextEncoder().encode(out.svg).length + out.files.reduce((a, f) => a + f.data.length, 0);
          }
        } else if (kind === 'pdf' || isX) {
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
          // 16-bit PNG samples are twice as wide and the low byte compresses poorly
          const depthK = format === 'png' && pngDepth === 16 && !useSel ? 2.6 : 1;
          const per = sample * depthK * Math.pow(Math.max(ratio, 0.01), format === 'png' ? 0.9 : 0.8);
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
  }, [kind, preview, pxW, pxH, quality, pages.length, b, hasImages, pngDepth, useSel, svgMode, svgEnc]);

  const rangeError = effArea === 'range' && range && !range.ok ? range.error : null;
  const canGo = !busy && !rangeError && pages.length > 0;

  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    try {
      const path = await runExport({
        format, pages, scale, dpi, quality: quality / 100, transparent, includeBleed: b > 0, cropMarks,
        pdfKind: kind === 'pdf-image' ? 'image' : kind === 'pdf-x4' ? 'x4' : kind === 'pdf-x1a' ? 'x1a' : isPdf ? 'vector' : undefined,
        cmykProfile: isX ? press : undefined,
        selection: useSel ? [...selIds] : undefined,
        fileName: title,
        bitDepth: format === 'png' && !useSel ? pngDepth : undefined,
        svgImages: format === 'svg' ? { mode: svgMode, encoding: svgEnc } : undefined,
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
  const focusScaleField = () => window.setTimeout(() => scaleFieldRef.current?.querySelector('input')?.focus(), 0);
  const presetItems: MenuEntry[] = [
    ...SCALE_PRESETS.map((p) => ({
      id: `scale-${p.v}`,
      label: p.label,
      detail: p.detail,
      icon: scaleBy === 'factor' && Math.abs(p.v - scale) < 1e-6 ? 'check' : undefined,
      run: () => {
        setScale(p.v);
        setScaleBy('factor');
        focusScaleField();
      },
    })),
    '-',
    scaleBy === 'factor'
      ? { id: 'scale-width', label: 'Custom width…', detail: 'Type the width in pixels', run: () => { setScaleBy('width'); focusScaleField(); } }
      : { id: 'scale-factor', label: 'Scale factor…', detail: 'Type a multiplier like 2×', run: () => { setScaleBy('factor'); focusScaleField(); } },
  ];
  const presetTrigger = (
    <button
      type="button"
      className="nf-trail"
      aria-label="Scale presets"
      data-tip="Scale presets"
      aria-haspopup="menu"
      aria-expanded={!!presetAnchor}
      data-testid="export-scale-presets"
      onClick={(e) => setPresetAnchor(presetAnchor ? null : e.currentTarget)}
    >
      <Icon name="chevron-down" size={16} />
    </button>
  );

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
            <Field
              label={scaleBy === 'factor' ? 'Scale' : 'Width'}
              hint={<span data-testid="export-scale-hint">{scaleBy === 'factor' ? `${pxW} × ${pxH} px` : `${formatScale(scale)} · ${pxW} × ${pxH} px`}</span>}
            >
              <div className="ex-scale" ref={scaleFieldRef}>
                {scaleBy === 'factor' ? (
                  <NumberField key="factor" ariaLabel="Scale" value={scale} unit="×" unitInline trailing={presetTrigger} min={0.05} max={16} step={0.25} digits={2} onCommit={setScale} className="ex-scale-k" />
                ) : (
                  <NumberField key="width" ariaLabel="Width in pixels" value={pxW} unit="px" unitInline trailing={presetTrigger} min={1} max={16384} step={1} digits={0} onCommit={(w) => setScale(Math.max(0.01, w / baseW))} className="ex-scale-w" />
                )}
              </div>
              {presetAnchor && <Menu anchor={presetAnchor} label="Scale presets" items={presetItems} align="end" minWidth={184} onClose={() => setPresetAnchor(null)} />}
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
          {svgImages && (
            <>
              <Field label="Images" hint={svgMode === 'link' ? 'Written as files beside the SVG; keep them together' : 'One self-contained file'}>
                <Segmented label="SVG images" value={svgMode} onChange={(v: SvgImageMode) => setSvgMode(v)} options={[{ value: 'embed', label: 'Embed' }, { value: 'link', label: 'Link' }]} />
              </Field>
              <Field label="Encoding" hint={svgEnc === 'jpeg-opaque' ? 'JPEG for opaque images; anything with transparency stays PNG' : 'Lossless'}>
                <Segmented label="Image encoding" value={svgEnc} onChange={(v: SvgImageEncoding) => setSvgEnc(v)} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg-opaque', label: 'JPEG if opaque' }]} />
              </Field>
            </>
          )}
          {showQuality && (
            <Field label={kind === 'pdf' ? 'Photo quality' : 'Quality'}>
              <SliderField label={kind === 'pdf' ? 'Photo quality' : 'Quality'} hideLabel className="ex-quality" min={40} max={100} unit="%" value={quality} onChange={(v) => setQuality(Math.round(v))} />
            </Field>
          )}
          {format === 'png' && (
            <Field label="Background">
              <Segmented label="Background" value={transparent ? 't' : 'p'} onChange={(v) => setTransparent(v === 't')} options={[{ value: 'p', label: 'Page colour' }, { value: 't', label: 'Transparent' }]} />
            </Field>
          )}
          {format === 'png' && !useSel && (
            <Field label="Bit depth" hint={pngDepth === 16 ? 'Photos keep 16 bits per channel: smoother gradients for further editing and print. Files are about twice the size.' : undefined}>
              <Segmented label="Bit depth" value={String(pngDepth)} onChange={(v) => setPngDepth(v === '16' ? 16 : 8)} options={[{ value: '8', label: '8-bit' }, { value: '16', label: '16-bit' }]} />
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
          {isX && (
            <Field label="Press" htmlFor="ex-press" hint={PROFILES[press].detail}>
              <select id="ex-press" value={press} onChange={(e) => setPress(e.target.value as CmykProfileId)} data-testid="export-press">
                {CMYK_PROFILES.map((id) => <option key={id} value={id}>{PROFILES[id].name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Colour">
            <span className="value-text" data-testid="export-colour">
              {isX ? `CMYK · ${PROFILES[press].short} · ${X_NAME[kind]}` : isPdf ? `${PROFILES[docCol.rgbProfile].short} · not for press` : format === 'svg' ? PROFILES[docCol.rgbProfile].short : `${PROFILES[docCol.rgbProfile].short} · ${useSel ? 8 : outDepth}-bit · profile embedded`}
            </span>
          </Field>
          {format === 'svg' && (
            <p className="note ex-note" data-testid="export-svg-note">
              Shapes and text stay editable vectors.{' '}
              {!svgImages ? 'There are no photos or pixel layers to include.' : `Photos and pixel layers are ${svgMode === 'link' ? 'linked' : 'embedded'} as ${svgEnc === 'png' ? 'PNG' : 'JPEG where they have no transparency, PNG otherwise'}.`}
            </p>
          )}
          {kind === 'pdf' && <p className="note ex-note" data-testid="export-pdf-note">Shapes and text stay sharp vectors with embedded fonts, so text can be searched and copied. Photos keep their own resolution. Text in system fonts and see-through gradients are placed as images.</p>}
          {kind === 'pdf-x4' && <p className="note ex-note" data-testid="export-pdf-note">For print shops: colours become CMYK for {PROFILES[press].name} and the press profile travels with the file. Shapes and text stay vectors, fonts are embedded, see-through objects stay live and photos stay lossless.</p>}
          {kind === 'pdf-x1a' && <p className="note ex-note" data-testid="export-pdf-note">For print shops that ask for PDF/X-1a: CMYK and spot colours only, fonts embedded. Anything see-through is flattened into an image together with what lies under it.</p>}
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
