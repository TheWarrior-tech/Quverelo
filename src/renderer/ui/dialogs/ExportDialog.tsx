import { useState } from 'react';
import { editor } from '../../state/editor';
import { closeDialog, toast } from '../../state/bus';
import { runExport, type ExportRequest } from '../../state/io';
import { Dialog } from './DialogHost';

type Format = ExportRequest['format'];

export function ExportDialog({ format: initial }: { format: Format }) {
  const doc = editor.doc!;
  const [format, setFormat] = useState<Format>(initial);
  const [scale, setScale] = useState(1);
  const [dpi, setDpi] = useState(doc.settings.unit === 'px' ? 150 : 300);
  const [quality, setQuality] = useState(90);
  const [transparent, setTransparent] = useState(!doc.settings.background);
  const [bleed, setBleed] = useState(false);
  const [cropMarks, setCropMarks] = useState(false);
  const [range, setRange] = useState<'current' | 'all'>(format === 'pdf' ? 'all' : 'current');
  const [busy, setBusy] = useState(false);
  const cur = Math.max(0, editor.activePageIndex);
  const pages = range === 'all' ? doc.pages.map((_, i) => i) : [cur];
  const pxW = Math.round(doc.settings.width * (format === 'pdf' ? dpi / 96 : scale));
  const pxH = Math.round(doc.settings.height * (format === 'pdf' ? dpi / 96 : scale));
  const formats = (['png', 'jpg', 'svg', 'pdf'] as Format[]).filter((f) => editor.feature(`export-${f}` as never));
  const go = async () => {
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
  return (
    <Dialog title="Export" footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" disabled={busy} onClick={go} data-testid="export-go">{busy ? 'Exporting…' : 'Export'}</button></>}>
      <div className="form-grid">
        <label>Format</label>
        <div className="choice-row" role="radiogroup" aria-label="Format">
          {formats.map((f) => (
            <button key={f} role="radio" aria-checked={format === f} className={`btn ${format === f ? 'selected' : ''}`} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
          ))}
        </div>
        {doc.pages.length > 1 && (
          <>
            <label>Pages</label>
            <div className="choice-row">
              <button className={`btn ${range === 'current' ? 'selected' : ''}`} onClick={() => setRange('current')}>Current page</button>
              <button className={`btn ${range === 'all' ? 'selected' : ''}`} onClick={() => setRange('all')}>All {doc.pages.length} pages</button>
            </div>
          </>
        )}
        {(format === 'png' || format === 'jpg') && (
          <>
            <label htmlFor="ex-scale">Scale</label>
            <select id="ex-scale" value={scale} onChange={(e) => setScale(parseFloat(e.target.value))}>
              {[0.5, 1, 2, 3, 4].map((s) => <option key={s} value={s}>{s}× ({Math.round(doc.settings.width * s)} × {Math.round(doc.settings.height * s)} px)</option>)}
              <option value={300 / 96}>Print 300 dpi</option>
            </select>
          </>
        )}
        {format === 'pdf' && (
          <>
            <label htmlFor="ex-dpi">Resolution</label>
            <select id="ex-dpi" value={dpi} onChange={(e) => setDpi(parseInt(e.target.value, 10))}>
              <option value={96}>Screen (96 dpi)</option>
              <option value={150}>Standard (150 dpi)</option>
              <option value={300}>Print (300 dpi)</option>
            </select>
            <label>Print marks</label>
            <div>
              <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={bleed} onChange={(e) => setBleed(e.target.checked)} disabled={!doc.settings.bleed} /> Include bleed</label>{' '}
              <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={cropMarks} onChange={(e) => setCropMarks(e.target.checked)} /> Crop marks</label>
            </div>
          </>
        )}
        {(format === 'jpg' || format === 'pdf') && (
          <>
            <label htmlFor="ex-q">Quality</label>
            <div className="row" style={{ margin: 0 }}>
              <input id="ex-q" type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(parseInt(e.target.value, 10))} />
              <span style={{ width: 40 }}>{quality}%</span>
            </div>
          </>
        )}
        {format === 'png' && (
          <>
            <label>Background</label>
            <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Transparent</label>
          </>
        )}
        {format === 'svg' && (
          <div className="full" style={{ color: 'var(--text-dim)' }}>Shapes and text stay editable vectors. Photos and pixel layers are embedded.</div>
        )}
        <div className="full" style={{ color: 'var(--text-faint)' }}>
          Output: {format === 'svg' ? 'vector' : `${pxW} × ${pxH} px`} · {pages.length} file{pages.length > 1 && format !== 'pdf' ? 's' : ''}
        </div>
      </div>
    </Dialog>
  );
}
