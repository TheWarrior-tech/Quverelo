import { useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/api';
import { allMenuCommands } from '../../../shared/menu';
import { editor } from '../../state/editor';
import { closeDialog } from '../../state/bus';
import { setSetting, shortcutTable } from '../../state/commands';
import { useEditor } from '../hooks';
import { Logo } from '../Icons';
import { Dialog } from './DialogHost';

const isMac = navigator.platform.toLowerCase().includes('mac');
export function prettyAccel(a: string): string {
  return a.replace('CmdOrCtrl', isMac ? '⌘' : 'Ctrl').replace('Alt', isMac ? '⌥' : 'Alt').replace('Shift', isMac ? '⇧' : 'Shift').replace(/\+/g, isMac ? '' : '+');
}

export function ShortcutsDialog() {
  const menu = allMenuCommands().filter((c) => c.accel);
  return (
    <Dialog title="Keyboard Shortcuts" wide footer={<button className="btn primary" onClick={closeDialog}>Done</button>}>
      <div className="shortcut-grid">
        {shortcutTable().map((g) => (
          <div className="shortcut-group" key={g.group}>
            <h4>{g.group}</h4>
            {g.items.map(([k, v]) => (
              <div key={k + v}><span>{v}</span><kbd>{k}</kbd></div>
            ))}
          </div>
        ))}
        <div className="shortcut-group">
          <h4>Menu commands</h4>
          {menu.map((c) => (
            <div key={c.id}><span>{c.label.replace('…', '')}</span><kbd>{prettyAccel(c.accel!)}</kbd></div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export function GuideDialog() {
  return (
    <Dialog title="Quick Start Guide" wide footer={<button className="btn primary" onClick={closeDialog}>Got it</button>}>
      <div className="guide">
        <p>Quvrelo is one app with three <b>studios</b>. They all work on the same document, so you can switch at any time with the buttons at the top (or Ctrl/⌘+Alt+1, 2, 3).</p>
        <h3>Photo studio</h3>
        <ul>
          <li>Open a JPG, PNG or WebP, or place one with File ▸ Place Image. Each photo becomes a <b>pixel layer</b>.</li>
          <li>Paint with the Brush (B) and Eraser (E). Use [ and ] to change the brush size.</li>
          <li>Select areas with the Marquee (M) or Freehand Selection (L). Hold Shift to add, Alt to subtract.</li>
          <li>Add <b>live adjustments</b> (Brightness/Contrast, Levels, Curves, Hue/Saturation, Black & White…) and filters (Blur, Sharpen, Noise) in the Adjustments panel. They stay editable until you click Apply.</li>
          <li>Crop with the Crop tool (C): drag an area and press Enter.</li>
        </ul>
        <h3>Vector studio</h3>
        <ul>
          <li>Draw rectangles, ellipses, polygons, stars and lines. Shift keeps proportions; Alt draws from the centre.</li>
          <li>The Pen (P) draws curves: click for corners, drag for smooth points, click the first point to close.</li>
          <li>Edit any shape's points with the Node tool (A). Double-click a point to switch between smooth and corner.</li>
          <li>Combine shapes with the Boolean buttons (Add, Subtract, Intersect, Exclude, Divide).</li>
          <li>Pick colours and gradients in the Colour panel, and keep favourites in Swatches.</li>
        </ul>
        <h3>Layout studio</h3>
        <ul>
          <li>Drag with the Frame Text tool (X) to make a text box. Text that doesn't fit shows a red ➕; select two frames and choose <b>Link frames</b> to flow it on.</li>
          <li>Picture frames (F) hold photos. Double-click one to place an image, then choose Fill, Fit or Stretch.</li>
          <li>Add pages in the Pages panel. <b>Master pages</b> hold headers and footers shared by many pages.</li>
          <li>Export a multi-page PDF with File ▸ Export PDF (with bleed and crop marks for professional printing).</li>
        </ul>
        <h3>Saving & handing in</h3>
        <ul>
          <li>Save as an <b>.quvrelo</b> file — everything, including photos, is kept in one file. Work is autosaved for crash recovery.</li>
          <li>Teachers can add assignment details (File ▸ Assignment Details). Students hand work in with File ▸ Hand In.</li>
        </ul>
      </div>
    </Dialog>
  );
}

export function AboutDialog() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => void window.quvrelo.getAppInfo().then(setInfo), []);
  return (
    <Dialog title="About Quvrelo" footer={<button className="btn primary" onClick={closeDialog}>Close</button>}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Logo className="logo" />
        <div>
          <h3 style={{ margin: 0 }}>Quvrelo {info?.version}</h3>
          <p style={{ margin: '4px 0' }}>Photo, vector and layout design for schools and teams. Free and open source (MIT).</p>
        </div>
      </div>
      <p>
        Works entirely offline. No accounts, no analytics and no telemetry. Your files never leave this computer unless you save them somewhere else.
      </p>
      {info && (
        <p style={{ fontSize: 12 }}>
          {info.platform} {info.arch} · Electron {info.electron}
          <br />
          Policy: {info.policySource ?? 'none (default settings)'}
          {info.policyWarnings.length > 0 && <><br />Policy warnings: {info.policyWarnings.join('; ')}</>}
          {editor.policy.organizationName && <><br />Managed by {editor.policy.organizationName}</>}
        </p>
      )}
      <p style={{ fontSize: 12 }}>Bundled fonts: Inter, Atkinson Hyperlegible, OpenDyslexic, Merriweather, Roboto Slab, Caveat (SIL Open Font License).</p>
    </Dialog>
  );
}

export function PreferencesDialog() {
  const ed = useEditor();
  const s = ed.settings;
  const p = ed.policy;
  return (
    <Dialog title="Preferences" footer={<button className="btn primary" onClick={closeDialog}>Done</button>}>
      <div className="form-grid">
        <label>Theme</label>
        <div className="choice-row" role="radiogroup" aria-label="Theme">
          {(['dark', 'light', 'high-contrast', 'system'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={(p.forceTheme ?? s.theme) === t} disabled={!!p.forceTheme} className={`btn ${(p.forceTheme ?? s.theme) === t ? 'selected' : ''}`} onClick={() => setSetting({ theme: t })}>
              {t === 'high-contrast' ? 'High contrast' : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <label htmlFor="pref-scale">Interface size</label>
        <div className="row" style={{ margin: 0 }}>
          <input id="pref-scale" type="range" min={75} max={200} step={5} value={Math.round(s.uiScale * 100)} disabled={p.lockUiScale} onChange={(e) => setSetting({ uiScale: parseInt(e.target.value, 10) / 100 })} />
          <span style={{ width: 44 }}>{Math.round(s.uiScale * 100)}%</span>
        </div>
        <label>Reading</label>
        <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={s.dyslexiaFriendlyUi} onChange={(e) => setSetting({ dyslexiaFriendlyUi: e.target.checked })} /> Dyslexia-friendly interface font</label>
        <label>Motion</label>
        <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={s.reduceMotion} onChange={(e) => setSetting({ reduceMotion: e.target.checked })} /> Reduce motion (no marching ants or animations)</label>
        <label>Canvas</label>
        <div>
          <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={s.showRulers} onChange={(e) => setSetting({ showRulers: e.target.checked })} /> Show rulers</label>{' '}
          <label style={{ color: 'var(--text)' }}><input type="checkbox" checked={s.snapping} onChange={(e) => setSetting({ snapping: e.target.checked })} /> Snapping</label>
        </div>
        <label htmlFor="pref-units">Display units</label>
        <select id="pref-units" value={s.units} onChange={(e) => setSetting({ units: e.target.value as never })}>
          {['px', 'mm', 'cm', 'in', 'pt'].map((u) => <option key={u}>{u}</option>)}
        </select>
        {(p.forceTheme || p.lockUiScale || p.lockSaveDirectory || p.disabledFeatures.length > 0) && (
          <div className="full" style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            Some settings are managed by your organisation{p.organizationName ? ` (${p.organizationName})` : ''}.
          </div>
        )}
      </div>
    </Dialog>
  );
}
