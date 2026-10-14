import { useState } from 'react';
import { PAPER_SIZES, toPx, fromPx } from '../../../core/units';
import type { StudioKind, Unit } from '../../../core/types';
import { editor } from '../../state/editor';
import { closeDialog } from '../../state/bus';
import { newBlank, newFromTemplate } from '../../state/io';
import { TEMPLATES } from '../../../core/templates';
import { Dialog } from './DialogHost';

const PRESETS: { name: string; w: number; h: number; unit: Unit; studio: StudioKind }[] = [
  ...Object.entries(PAPER_SIZES).map(([name, s]) => ({ name, w: s.w, h: s.h, unit: s.unit, studio: 'layout' as StudioKind })),
  { name: 'HD 1920 × 1080', w: 1920, h: 1080, unit: 'px', studio: 'vector' },
  { name: 'Square 1080', w: 1080, h: 1080, unit: 'px', studio: 'vector' },
  { name: 'Photo 3000 × 2000', w: 3000, h: 2000, unit: 'px', studio: 'photo' },
  { name: 'Story 1080 × 1920', w: 1080, h: 1920, unit: 'px', studio: 'vector' },
];

export function NewDocumentDialog() {
  const [title, setTitle] = useState('Untitled');
  const [preset, setPreset] = useState('A4');
  const [unit, setUnit] = useState<Unit>('mm');
  const [w, setW] = useState(210);
  const [h, setH] = useState(297);
  const [landscape, setLandscape] = useState(false);
  const [pages, setPages] = useState(1);
  const [studio, setStudio] = useState<StudioKind>(editor.ui.studio);
  const [margins, setMargins] = useState(15);
  const [bleed, setBleed] = useState(3);
  const [transparent, setTransparent] = useState(false);
  const choose = (name: string) => {
    const p = PRESETS.find((x) => x.name === name);
    setPreset(name);
    if (!p) return;
    setUnit(p.unit);
    setW(p.w);
    setH(p.h);
    setStudio(p.studio);
    if (p.unit === 'px') {
      setMargins(0);
      setBleed(0);
    } else {
      setMargins(p.unit === 'in' ? 0.5 : 15);
      setBleed(p.unit === 'in' ? 0.125 : 3);
    }
  };
  const changeUnit = (u: Unit) => {
    setW(Math.round(fromPx(toPx(w, unit), u) * 100) / 100);
    setH(Math.round(fromPx(toPx(h, unit), u) * 100) / 100);
    setMargins(Math.round(fromPx(toPx(margins, unit), u) * 100) / 100);
    setBleed(Math.round(fromPx(toPx(bleed, unit), u) * 100) / 100);
    setUnit(u);
  };
  const create = () => {
    const W = toPx(landscape ? h : w, unit);
    const H = toPx(landscape ? w : h, unit);
    newBlank({ title, width: Math.round(W * 100) / 100, height: Math.round(H * 100) / 100, unit, pages, studio, margins: toPx(margins, unit), bleed: toPx(bleed, unit), background: transparent ? null : '#ffffff', dpi: 300 });
    closeDialog();
  };
  return (
    <Dialog title="New Document" wide footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={create} data-testid="create-document">Create</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 22 }}>
        <div className="form-grid">
          <label htmlFor="nd-title">Name</label>
          <input id="nd-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label htmlFor="nd-preset">Preset</label>
          <select id="nd-preset" value={preset} onChange={(e) => choose(e.target.value)}>
            {PRESETS.map((p) => <option key={p.name}>{p.name}</option>)}
            <option value="custom">Custom</option>
          </select>
          <label>Size</label>
          <div className="row" style={{ margin: 0 }}>
            <input type="number" aria-label="Width" value={w} min={1} onChange={(e) => { setW(parseFloat(e.target.value) || 1); setPreset('custom'); }} />
            <span>×</span>
            <input type="number" aria-label="Height" value={h} min={1} onChange={(e) => { setH(parseFloat(e.target.value) || 1); setPreset('custom'); }} />
            <select aria-label="Units" value={unit} onChange={(e) => changeUnit(e.target.value as Unit)} style={{ flex: 'none', width: 64 }}>
              {(['px', 'mm', 'cm', 'in', 'pt'] as Unit[]).map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <label>Orientation</label>
          <div className="choice-row">
            <button className={`btn ${!landscape ? 'selected' : ''}`} onClick={() => setLandscape(false)}>Portrait</button>
            <button className={`btn ${landscape ? 'selected' : ''}`} onClick={() => setLandscape(true)}>Landscape</button>
          </div>
          <label htmlFor="nd-pages">Pages</label>
          <input id="nd-pages" type="number" min={1} max={500} value={pages} onChange={(e) => setPages(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))} />
          <label htmlFor="nd-margins">Margins</label>
          <input id="nd-margins" type="number" min={0} value={margins} onChange={(e) => setMargins(parseFloat(e.target.value) || 0)} />
          <label htmlFor="nd-bleed">Bleed</label>
          <input id="nd-bleed" type="number" min={0} value={bleed} onChange={(e) => setBleed(parseFloat(e.target.value) || 0)} />
          <label>Background</label>
          <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Transparent</label>
          <label>Open in</label>
          <div className="choice-row">
            {(['photo', 'vector', 'layout'] as StudioKind[]).filter((s) => editor.feature(s)).map((s) => (
              <button key={s} className={`btn ${studio === s ? 'selected' : ''}`} onClick={() => setStudio(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="section-title">Or start from a template</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 380, overflowY: 'auto' }}>
            {TEMPLATES.filter((t) => editor.feature(t.studio)).map((t) => (
              <button key={t.id} className="btn ghost" style={{ justifyContent: 'flex-start', height: 'auto', padding: '6px 8px', textAlign: 'left' }} onClick={() => { newFromTemplate(t.id); closeDialog(); }}>
                <span><b>{t.name}</b><br /><small style={{ color: 'var(--text-faint)' }}>{t.category} · {t.size}</small></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
