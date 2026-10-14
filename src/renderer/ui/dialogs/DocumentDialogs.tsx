import { useState } from 'react';
import { resizeDocument } from '../../../core/commands';
import { fromPx, toPx } from '../../../core/units';
import type { Unit } from '../../../core/types';
import { editor } from '../../state/editor';
import { closeDialog } from '../../state/bus';
import { getViewport } from '../../state/commands';
import { Dialog } from './DialogHost';

const r2 = (v: number) => Math.round(v * 100) / 100;

export function DocumentSetupDialog() {
  const doc = editor.doc!;
  const s = doc.settings;
  const [unit, setUnit] = useState<Unit>(s.unit);
  const c = (px: number) => r2(fromPx(px, unit));
  const [w, setW] = useState(c(s.width));
  const [h, setH] = useState(c(s.height));
  const [m, setM] = useState({ top: c(s.margins.top), right: c(s.margins.right), bottom: c(s.margins.bottom), left: c(s.margins.left) });
  const [bleed, setBleed] = useState(c(s.bleed));
  const [columns, setColumns] = useState(s.columns);
  const [gutter, setGutter] = useState(c(s.columnGutter));
  const [dpi, setDpi] = useState(s.dpi);
  const [bg, setBg] = useState(s.background ?? '#ffffff');
  const [transparent, setTransparent] = useState(!s.background);
  const apply = () => {
    const px = (v: number) => toPx(v, unit);
    editor.commit('Document setup', (d) => {
      let out = d;
      const W = px(w);
      const H = px(h);
      if (Math.abs(W - d.settings.width) > 0.01 || Math.abs(H - d.settings.height) > 0.01) out = resizeDocument(out, W, H, { x: 0, y: 0 });
      return {
        ...out,
        settings: {
          ...out.settings,
          unit,
          margins: { top: px(m.top), right: px(m.right), bottom: px(m.bottom), left: px(m.left) },
          bleed: px(bleed),
          columns,
          columnGutter: px(gutter),
          dpi,
          background: transparent ? null : bg,
        },
      };
    });
    getViewport()?.zoomToFit();
    closeDialog();
  };
  const changeUnit = (u: Unit) => {
    const k = (v: number) => r2(fromPx(toPx(v, unit), u));
    setW(k(w));
    setH(k(h));
    setM({ top: k(m.top), right: k(m.right), bottom: k(m.bottom), left: k(m.left) });
    setBleed(k(bleed));
    setGutter(k(gutter));
    setUnit(u);
  };
  return (
    <Dialog title="Document Setup" footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={apply}>Apply</button></>}>
      <div className="form-grid">
        <label>Units</label>
        <select value={unit} onChange={(e) => changeUnit(e.target.value as Unit)} aria-label="Document units">
          {(['px', 'mm', 'cm', 'in', 'pt'] as Unit[]).map((u) => <option key={u}>{u}</option>)}
        </select>
        <label>Page size</label>
        <div className="row" style={{ margin: 0 }}>
          <input type="number" aria-label="Page width" value={w} onChange={(e) => setW(parseFloat(e.target.value) || 1)} />
          <span>×</span>
          <input type="number" aria-label="Page height" value={h} onChange={(e) => setH(parseFloat(e.target.value) || 1)} />
        </div>
        <label>Margins</label>
        <div className="grid2" style={{ margin: 0 }}>
          {(['top', 'bottom', 'left', 'right'] as const).map((k) => (
            <div key={k} className="field-inline"><span>{k[0].toUpperCase()}</span><input type="number" aria-label={`${k} margin`} value={m[k]} onChange={(e) => setM({ ...m, [k]: parseFloat(e.target.value) || 0 })} /></div>
          ))}
        </div>
        <label htmlFor="ds-bleed">Bleed</label>
        <input id="ds-bleed" type="number" min={0} value={bleed} onChange={(e) => setBleed(parseFloat(e.target.value) || 0)} />
        <label>Column guides</label>
        <div className="row" style={{ margin: 0 }}>
          <input type="number" aria-label="Columns" min={1} max={24} value={columns} onChange={(e) => setColumns(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          <span>gutter</span>
          <input type="number" aria-label="Column gutter" min={0} value={gutter} onChange={(e) => setGutter(parseFloat(e.target.value) || 0)} />
        </div>
        <label htmlFor="ds-dpi">Output DPI</label>
        <input id="ds-dpi" type="number" min={72} max={1200} value={dpi} onChange={(e) => setDpi(parseInt(e.target.value, 10) || 300)} />
        <label>Background</label>
        <div className="row" style={{ margin: 0 }}>
          <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background colour" disabled={transparent} />
          <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Transparent</label>
        </div>
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
    <Dialog title="Resize Document" footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={apply}>Resize</button></>}>
      <div className="form-grid">
        <label>Mode</label>
        <div className="choice-row">
          <button className={`btn ${mode === 'scale' ? 'selected' : ''}`} onClick={() => setMode('scale')}>Scale content</button>
          <button className={`btn ${mode === 'canvas' ? 'selected' : ''}`} onClick={() => setMode('canvas')}>Canvas only</button>
        </div>
        <label>Size (px)</label>
        <div className="row" style={{ margin: 0 }}>
          <input type="number" aria-label="Width in pixels" value={w} onChange={(e) => { const v = parseInt(e.target.value, 10) || 1; setW(v); if (lock) setH(Math.round(v / ratio)); }} />
          <span>×</span>
          <input type="number" aria-label="Height in pixels" value={h} onChange={(e) => { const v = parseInt(e.target.value, 10) || 1; setH(v); if (lock) setW(Math.round(v * ratio)); }} />
        </div>
        <label>Proportions</label>
        <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Keep aspect ratio</label>
      </div>
    </Dialog>
  );
}
