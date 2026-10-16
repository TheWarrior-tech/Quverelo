import { useState } from 'react';
import { resizeDocument } from '../../../core/commands';
import { UNITS, UNIT_NAMES, UNIT_STEP, formatSize, lengthIn, pixelsAt, toPx } from '../../../core/units';
import type { Unit } from '../../../core/types';
import { editor } from '../../state/editor';
import { closeDialog } from '../../state/bus';
import { getViewport } from '../../state/commands';
import { Dialog } from './DialogHost';
import { Check, Field, NumberInput, Segmented } from './controls';
import { CMYK_PROFILES, docColour, PROFILES, RGB_PROFILES, type CmykProfileId, type ColourMode, type RenderingIntent, type RgbProfileId } from '../../../core/colour/profiles';

const INTENTS: { value: RenderingIntent; label: string; detail: string }[] = [
  { value: 'relative', label: 'Relative colorimetric', detail: 'Keeps printable colours exact' },
  { value: 'perceptual', label: 'Perceptual', detail: 'Squeezes vivid photos into the press gamut smoothly' },
  { value: 'saturation', label: 'Saturation', detail: 'Keeps colours bright for charts' },
  { value: 'absolute', label: 'Absolute colorimetric', detail: 'Simulates the paper white (proofing)' },
];

export function DocumentSetupDialog() {
  const doc = editor.doc!;
  const s = doc.settings;
  const [unit, setUnit] = useState<Unit>(s.unit);
  // every value through the one unit formatter, so 15 mm margins read 15 here and in the inspector
  const c = (px: number) => lengthIn(px, unit);
  const [w, setW] = useState(c(s.width));
  const [h, setH] = useState(c(s.height));
  const [m, setM] = useState({ top: c(s.margins.top), right: c(s.margins.right), bottom: c(s.margins.bottom), left: c(s.margins.left) });
  const [bleed, setBleed] = useState(c(s.bleed));
  const [columns, setColumns] = useState(s.columns);
  const [gutter, setGutter] = useState(c(s.columnGutter));
  const [dpi, setDpi] = useState(s.dpi);
  const [bg, setBg] = useState(s.background ?? '#ffffff');
  const [transparent, setTransparent] = useState(!s.background);
  const col = docColour(s);
  const [mode, setMode] = useState<ColourMode>(col.mode);
  const [rgbProfile, setRgbProfile] = useState<RgbProfileId>(col.rgbProfile);
  const [cmykProfile, setCmykProfile] = useState<CmykProfileId>(col.cmykProfile);
  const [bitDepth, setBitDepth] = useState<8 | 16>(col.bitDepth);
  const [intent, setIntent] = useState<RenderingIntent>(col.intent);
  const apply = () => {
    // an untouched field keeps its exact px value (no drift from display rounding)
    const keep = (v: number, orig: number) => (v === lengthIn(orig, unit) ? orig : toPx(v, unit));
    editor.commit('Document setup', (d) => {
      let out = d;
      const W = keep(w, d.settings.width);
      const H = keep(h, d.settings.height);
      if (Math.abs(W - d.settings.width) > 0.01 || Math.abs(H - d.settings.height) > 0.01) out = resizeDocument(out, W, H, { x: 0, y: 0 });
      return {
        ...out,
        settings: {
          ...out.settings,
          unit,
          margins: { top: keep(m.top, s.margins.top), right: keep(m.right, s.margins.right), bottom: keep(m.bottom, s.margins.bottom), left: keep(m.left, s.margins.left) },
          bleed: keep(bleed, s.bleed),
          columns,
          columnGutter: keep(gutter, s.columnGutter),
          dpi,
          background: transparent ? null : bg,
          colour: { mode, rgbProfile, cmykProfile, bitDepth, intent },
        },
      };
    });
    getViewport()?.zoomToFit();
    closeDialog();
  };
  const changeUnit = (u: Unit) => {
    const k = (v: number) => lengthIn(toPx(v, unit), u);
    setW(k(w));
    setH(k(h));
    setM({ top: k(m.top), right: k(m.right), bottom: k(m.bottom), left: k(m.left) });
    setBleed(k(bleed));
    setGutter(k(gutter));
    setUnit(u);
  };
  const step = UNIT_STEP[unit];
  return (
    <Dialog title="Document setup" onSubmit={apply} footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={apply}>Apply</button></>}>
      <div className="fgrid">
        <Field label="Units" htmlFor="ds-units">
          <select id="ds-units" value={unit} onChange={(e) => changeUnit(e.target.value as Unit)} aria-label="Document units">
            {UNITS.map((u) => <option key={u} value={u}>{UNIT_NAMES[u]}</option>)}
          </select>
        </Field>
        <Field label="Page size">
          <div className="pair">
            <NumberInput label="Page width" prefix="W" unit={unit} value={w} min={1} step={step} onChange={setW} />
            <NumberInput label="Page height" prefix="H" unit={unit} value={h} min={1} step={step} onChange={setH} />
          </div>
        </Field>
        <Field label="Margins">
          <div className="pair">
            {(['top', 'bottom', 'left', 'right'] as const).map((k) => (
              <NumberInput key={k} label={`${k[0].toUpperCase()}${k.slice(1)} margin`} prefix={k[0].toUpperCase()} unit={unit} value={m[k]} min={0} step={step} onChange={(v) => setM({ ...m, [k]: v })} />
            ))}
          </div>
        </Field>
        <Field label="Bleed" htmlFor="ds-bleed">
          <NumberInput id="ds-bleed" label="Bleed" unit={unit} value={bleed} min={0} step={step} onChange={setBleed} />
        </Field>
        <Field label="Columns">
          <div className="pair">
            <NumberInput label="Columns" prefix="Columns" value={columns} min={1} max={24} step={1} onChange={(v) => setColumns(Math.round(v))} />
            <NumberInput label="Column gutter" prefix="Gutter" unit={unit} value={gutter} min={0} step={step} onChange={setGutter} />
          </div>
        </Field>
        <Field label="Output DPI" htmlFor="ds-dpi" hint={unit === 'px' ? `Raster exports and the PDF page size: ${formatSize(toPx(w, unit) * 96 / dpi, toPx(h, unit) * 96 / dpi, 'mm')} at ${dpi} dpi` : `Raster exports: ${pixelsAt(toPx(w, unit), dpi)} × ${pixelsAt(toPx(h, unit), dpi)} px at ${dpi} dpi`}>
          <NumberInput id="ds-dpi" label="Output DPI" unit="dpi" value={dpi} min={72} max={1200} step={1} onChange={(v) => setDpi(Math.round(v))} />
        </Field>
        <Field label="Colour mode" hint={mode === 'cmyk' ? 'Colours are picked in CMYK and the page always shows the press proof.' : 'Screen colours. Soft proof (View menu) previews print.'}>
          <Segmented label="Colour mode" value={mode} onChange={(v) => setMode(v as ColourMode)} options={[{ value: 'rgb', label: 'RGB' }, { value: 'cmyk', label: 'CMYK' }]} />
        </Field>
        <Field label="RGB profile" htmlFor="ds-rgb" hint={rgbProfile !== col.rgbProfile ? 'Colour numbers stay the same and are read in the new profile (assign).' : PROFILES[rgbProfile].detail}>
          <select id="ds-rgb" value={rgbProfile} onChange={(e) => setRgbProfile(e.target.value as RgbProfileId)} data-testid="ds-rgb-profile">
            {RGB_PROFILES.map((id) => <option key={id} value={id}>{PROFILES[id].name}</option>)}
          </select>
        </Field>
        <Field label="CMYK profile" htmlFor="ds-cmyk" hint={PROFILES[cmykProfile].detail}>
          <select id="ds-cmyk" value={cmykProfile} onChange={(e) => setCmykProfile(e.target.value as CmykProfileId)} data-testid="ds-cmyk-profile">
            {CMYK_PROFILES.map((id) => <option key={id} value={id}>{PROFILES[id].name}</option>)}
          </select>
        </Field>
        <Field label="Rendering intent" htmlFor="ds-intent" hint={INTENTS.find((i) => i.value === intent)!.detail}>
          <select id="ds-intent" value={intent} onChange={(e) => setIntent(e.target.value as RenderingIntent)}>
            {INTENTS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
        </Field>
        <Field label="Bit depth" hint={bitDepth === 16 ? 'Photos keep 16 bits per channel through adjustments, saving and PNG export. 16-bit PNGs and DNG raw files open as 16-bit.' : undefined}>
          <Segmented label="Bit depth" value={String(bitDepth)} onChange={(v) => setBitDepth(v === '16' ? 16 : 8)} options={[{ value: '8', label: '8-bit' }, { value: '16', label: '16-bit' }]} />
        </Field>
        <Field label="Background">
          <div className="inline">
            {/* Transparent shows the checker, never a stale white swatch (c2 P2-13) */}
            {transparent
              ? <span className="chip fill transparent bg-swatch" role="img" aria-label="Background colour: transparent" data-tip="Transparent"><span className="chip-paint" /></span>
              : <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background colour" />}
            <Check checked={transparent} onChange={setTransparent}>Transparent</Check>
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

export function ResizeDialog() {
  const doc = editor.doc!;
  const [w, setW] = useState(Math.round(doc.settings.width));
  const [h, setH] = useState(Math.round(doc.settings.height));
  const [mode, setMode] = useState<'canvas' | 'scale'>('scale');
  const [lock, setLock] = useState(true);
  const ratio = doc.settings.width / doc.settings.height;
  const apply = () => {
    editor.commit(mode === 'scale' ? 'Resize document' : 'Resize canvas', (d) => {
      if (mode === 'canvas') return resizeDocument(d, w, h);
      const sx = w / d.settings.width;
      const sy = h / d.settings.height;
      const scaleNodes = (nodes: typeof d.pages[0]['nodes']) =>
        nodes.map((n) => ({ ...n, x: n.x * sx, y: n.y * sy, scaleX: n.scaleX * sx, scaleY: n.scaleY * sy }));
      return {
        ...d,
        settings: { ...d.settings, width: w, height: h },
        pages: d.pages.map((p) => ({ ...p, nodes: scaleNodes(p.nodes) })),
        masters: d.masters.map((p) => ({ ...p, nodes: scaleNodes(p.nodes) })),
      };
    });
    getViewport()?.zoomToFit();
    closeDialog();
  };
  return (
    <Dialog title="Resize document" size="sm" onSubmit={apply} footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={apply}>Resize</button></>}>
      <div className="fgrid">
        <Field label="Mode">
          <Segmented label="Resize mode" full value={mode} onChange={setMode} options={[{ value: 'scale', label: 'Scale content' }, { value: 'canvas', label: 'Canvas only' }]} />
        </Field>
        <Field label="Size">
          <div className="pair">
            <NumberInput label="Width in pixels" prefix="W" unit="px" value={w} min={1} step={1} onChange={(v) => { const x = Math.round(v); setW(x); if (lock) setH(Math.max(1, Math.round(x / ratio))); }} />
            <NumberInput label="Height in pixels" prefix="H" unit="px" value={h} min={1} step={1} onChange={(v) => { const x = Math.round(v); setH(x); if (lock) setW(Math.max(1, Math.round(x * ratio))); }} />
          </div>
        </Field>
        <Field label="Proportions">
          <Check checked={lock} onChange={setLock}>Keep aspect ratio</Check>
        </Field>
      </div>
    </Dialog>
  );
}
