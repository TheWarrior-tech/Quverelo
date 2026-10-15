import { useEffect, useMemo, useState } from 'react';
import type { AppInfo, UserSettings } from '../../../shared/api';
import { APP_MENU, type MenuCommand } from '../../../shared/menu';
import { editor } from '../../state/editor';
import { closeDialog, openDialog, toast } from '../../state/bus';
import { runCommand, setSetting, shortcutTable } from '../../state/commands';
import { useEditor } from '../hooks';
import { Icon, Logo } from '../Icons';
import { Dialog } from './DialogHost';
import { Check, Keys, PrefRow, PrefSection, Segmented } from './controls';
import { useUpdateState } from '../../state/updates';

const isMac = navigator.platform.toLowerCase().includes('mac');
/** Plain-text accelerator, e.g. for tooltips: "Ctrl+Shift+S" / "⇧⌘S". */
export function prettyAccel(a: string): string {
  return a.replace('CmdOrCtrl', isMac ? '⌘' : 'Ctrl').replace('Alt', isMac ? '⌥' : 'Alt').replace('Shift', isMac ? '⇧' : 'Shift').replace(/\+/g, isMac ? '' : '+');
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts

interface ShortcutGroup {
  id: string;
  title: string;
  items: { keys: string; label: string }[];
}

function shortcutGroups(): ShortcutGroup[] {
  const tools = shortcutTable().map((g) => ({
    id: g.group,
    title: g.group.replace(' (all studios)', ''),
    items: g.items.map(([k, v]) => ({ keys: k, label: v })),
  }));
  const menus = APP_MENU.map((s) => ({
    id: s.label,
    title: s.label,
    items: s.items
      .filter((i): i is MenuCommand => i !== '-' && !!i.accel && (!i.feature || editor.feature(i.feature)))
      .map((c) => ({ keys: c.accel!, label: c.label.replace('…', '') })),
  }));
  return [...menus, ...tools].filter((g) => g.items.length);
}

export function ShortcutsDialog() {
  const groups = useMemo(shortcutGroups, []);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string>('all');
  const q = query.trim().toLowerCase();
  const shown = groups
    .filter((g) => q || active === 'all' || g.id === active)
    .map((g) => ({ ...g, items: q ? g.items.filter((i) => `${i.label} ${i.keys}`.toLowerCase().includes(q)) : g.items }))
    .filter((g) => g.items.length);
  return (
    <Dialog title="Keyboard shortcuts" size="xl" split footer={<button className="btn" onClick={closeDialog}>Done</button>}>
      <nav className="dlg-side" aria-label="Shortcut groups">
        <input type="search" className="sc-search" placeholder="Search shortcuts" aria-label="Search shortcuts" value={query} onChange={(e) => setQuery(e.target.value)} data-autofocus />
        <button className="nav-item" aria-current={!q && active === 'all'} onClick={() => { setActive('all'); setQuery(''); }}>
          All shortcuts<span className="count">{groups.reduce((n, g) => n + g.items.length, 0)}</span>
        </button>
        <h3 className="micro">Menus</h3>
        {groups.filter((g) => APP_MENU.some((m) => m.label === g.id)).map((g) => (
          <button key={g.id} className="nav-item" aria-current={!q && active === g.id} onClick={() => { setActive(g.id); setQuery(''); }}>
            {g.title}<span className="count">{g.items.length}</span>
          </button>
        ))}
        <h3 className="micro">Tools &amp; canvas</h3>
        {groups.filter((g) => !APP_MENU.some((m) => m.label === g.id)).map((g) => (
          <button key={g.id} className="nav-item" aria-current={!q && active === g.id} onClick={() => { setActive(g.id); setQuery(''); }}>
            {g.title}<span className="count">{g.items.length}</span>
          </button>
        ))}
      </nav>
      <div className="dlg-main" aria-live="polite">
        {shown.length ? (
          <div className="sc-cols">
            {shown.map((g) => (
              <section className="sc-group" key={g.id}>
                <h3 className="micro">{g.title}</h3>
                {g.items.map((i) => (
                  <div className="sc-row" key={i.label + i.keys}>
                    <span>{i.label}</span>
                    <Keys combo={i.keys} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="sc-empty">No shortcuts match “{query}”.</div>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Quick start guide

export function GuideDialog() {
  return (
    <Dialog title="Quick start guide" size="lg" footer={<button className="btn" onClick={closeDialog}>Done</button>}>
      <div className="guide">
        <p>Quvrelo is one app with three <b>studios</b>. They all work on the same document, so you can switch at any time with the switch at the top of the window (or Ctrl/⌘ + Alt + 1, 2, 3).</p>
        <h3>Photo studio</h3>
        <ul>
          <li>Open a JPG, PNG or WebP, or place one with File › Place Image. Each photo becomes a <b>pixel layer</b>.</li>
          <li>Paint with the Brush (B) and Eraser (E). Use [ and ] to change the brush size.</li>
          <li>Select areas with the Marquee (M) or Freehand selection (L). Hold Shift to add, Alt to subtract.</li>
          <li>Add <b>live adjustments</b> (Brightness/Contrast, Levels, Hue/Saturation, Black &amp; White…) and filters in the Adjustments panel. They stay editable until you apply them.</li>
          <li>Crop with the Crop tool (C): drag an area and press Enter.</li>
        </ul>
        <h3>Vector studio</h3>
        <ul>
          <li>Draw rectangles, ellipses, polygons, stars and lines. Shift keeps proportions; Alt draws from the centre.</li>
          <li>Draw curves with the Pen (P): click for corners, drag for smooth points, click the first point to close.</li>
          <li>Edit any shape's points with the Node tool (A). Double-click a point to switch between smooth and corner.</li>
          <li>Combine shapes with the Boolean menu (Add, Subtract, Intersect, Exclude, Divide).</li>
        </ul>
        <h3>Layout studio</h3>
        <ul>
          <li>Drag with the Frame text tool (X) to make a text box. Text that doesn't fit shows an overflow marker; select two frames and choose <b>Link frames</b> to flow it on.</li>
          <li>Picture frames (F) hold photos. Double-click one to place an image, then choose Fill, Fit or Stretch.</li>
          <li>Add pages in the Pages panel. <b>Master pages</b> hold headers and footers shared by many pages.</li>
          <li>Export a multi-page PDF with File › Export PDF, with bleed and crop marks for professional printing.</li>
        </ul>
        <h3>Saving and handing in</h3>
        <ul>
          <li>Save as a <b>.quvrelo</b> file. Everything, including photos, is kept in one file, and work is autosaved for crash recovery.</li>
          <li>Teachers can add assignment details (File › Assignment Details). Students hand work in with File › Hand In.</li>
        </ul>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// About

export function AboutDialog() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => void window.quvrelo.getAppInfo().then(setInfo), []);
  const rows: [string, string][] = info
    ? [
        ['Platform', `${info.platform} · ${info.arch}`],
        ['Electron', info.electron],
        ['Policy', info.policySource ?? 'None (default settings)'],
        ...(editor.policy.organizationName ? [['Managed by', editor.policy.organizationName] as [string, string]] : []),
      ]
    : [];
  return (
    <Dialog
      title="About Quvrelo"
      size="md"
      footer={<><button className="btn" onClick={() => { closeDialog(); void runCommand('help.check-updates'); }}>Check for updates</button><button className="btn" onClick={closeDialog}>Done</button></>}
    >
      <div className="about-head">
        <Logo className="logo" />
        <div>
          <h3>Quvrelo</h3>
          <span>{info ? `Version ${info.version}` : '\u00a0'}</span>
        </div>
      </div>
      <p>Photo, vector and layout design for schools and teams. Works entirely offline: no account, no analytics and no telemetry. Your files never leave this computer unless you save them somewhere else.</p>
      <dl className="about-rows">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd data-tip={v}>{v}</dd></div>
        ))}
      </dl>
      {info && info.policyWarnings.length > 0 && <p className="fineprint">Policy warnings: {info.policyWarnings.join('; ')}</p>}
      <p className="fineprint">Free and open source under the MIT licence. Bundled fonts: Inter, Atkinson Hyperlegible, OpenDyslexic, Merriweather, Roboto Slab and Caveat (SIL Open Font Licence).</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Preferences

type PrefPane = 'general' | 'appearance' | 'canvas' | 'accessibility';

const PANES: { id: PrefPane; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'adjust' },
  { id: 'canvas', label: 'Canvas', icon: 'rect' },
  { id: 'accessibility', label: 'Accessibility', icon: 'eye' },
];

type Theme = UserSettings['theme'];

/** Palette used only to draw the miniature in each theme tile (mirrors the tokens in styles.css). */
const MINI: Record<Exclude<Theme, 'system'>, { app: string; panel: string; canvas: string; page: string; accent: string; line: string }> = {
  dark: { app: '#131415', panel: '#17181a', canvas: '#0d0e0f', page: '#ececed', accent: '#3cc4b0', line: 'rgba(255,255,255,.08)' },
  light: { app: '#f1f1ef', panel: '#f8f8f7', canvas: '#dedfdd', page: '#ffffff', accent: '#0c7a6b', line: 'rgba(0,0,0,.09)' },
  'high-contrast': { app: '#000000', panel: '#000000', canvas: '#000000', page: '#ffffff', accent: '#ffd400', line: '#ffffff' },
};

function Mini({ t }: { t: Exclude<Theme, 'system'> }) {
  const c = MINI[t];
  return (
    <>
      <span className="m-top" style={{ background: c.app, borderBottom: `1px solid ${c.line}` }} />
      <span style={{ background: c.app, borderRight: `1px solid ${c.line}`, position: 'relative' }}>
        <span className="m-dot" style={{ background: c.accent }} />
      </span>
      <span style={{ background: c.canvas, display: 'grid' }}><span className="m-page" style={{ background: c.page }} /></span>
      <span style={{ background: c.panel, borderLeft: `1px solid ${c.line}` }} />
    </>
  );
}

function ThemeTiles({ value, onChange, locked }: { value: Theme; onChange: (t: Theme) => void; locked: boolean }) {
  const opts: { id: Theme; label: string }[] = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'high-contrast', label: 'High contrast' },
    { id: 'system', label: 'Match system' },
  ];
  return (
    <div
      className="theme-tiles"
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={(e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d || locked) return;
        e.preventDefault();
        const i = opts.findIndex((o) => o.id === value);
        const next = opts[(i + d + opts.length) % opts.length].id;
        onChange(next);
        requestAnimationFrame(() => (e.currentTarget.querySelector(`[data-theme-tile="${next}"]`) as HTMLElement | null)?.focus());
      }}
    >
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          className="theme-tile"
          disabled={locked}
          onClick={() => onChange(o.id)}
          data-theme-tile={o.id}
          data-autofocus={value === o.id ? '' : undefined}
        >
          {o.id === 'system' ? (
            <span className="mini split-sys">
              <span style={{ display: 'grid', gridTemplateColumns: '12px 1fr', gridTemplateRows: '10px 1fr', overflow: 'hidden' }}><Mini t="light" /></span>
              <span style={{ display: 'grid', gridTemplateColumns: '1fr 28px', gridTemplateRows: '10px 1fr', overflow: 'hidden' }}><Mini t="dark" /></span>
            </span>
          ) : (
            <span className="mini"><Mini t={o.id} /></span>
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PreferencesDialog() {
  const ed = useEditor();
  const s = ed.settings;
  const p = ed.policy;
  const [pane, setPane] = useState<PrefPane>('appearance');
  const upd = useUpdateState();
  const managed = !!(p.forceTheme || p.lockUiScale || p.lockSaveDirectory || p.disabledFeatures.length > 0 ||
    p.disableUpdateCheck || p.autoDownload !== null || p.updateChannel !== null || p.autoInstall !== null);
  const updOff = !upd || upd.mode === 'disabled';
  const autoDlLocked = updOff || upd!.mode !== 'auto' || upd!.locks.autoDownload;
  const channelLocked = updOff || upd!.locks.channel;
  const autoDlDesc = updOff
    ? (upd?.note ?? 'Updates are off.')
    : upd!.locks.autoDownload
      ? `Set by your organisation: ${upd!.autoDownload ? 'on' : 'off'}.`
      : upd!.mode !== 'auto'
        ? (upd!.note ?? 'This copy of Quvrelo cannot install updates by itself.')
        : 'Download new versions in the background and install them when you restart.';
  const scale = Math.round(s.uiScale * 100);
  return (
    <Dialog title="Preferences" size="lg" split footer={<button className="btn" onClick={closeDialog}>Done</button>}>
      <nav className="dlg-side" aria-label="Preference categories">
        {PANES.map((x) => (
          <button key={x.id} className="nav-item" aria-current={pane === x.id} onClick={() => setPane(x.id)} data-pane={x.id}>
            <Icon name={x.icon} size={16} />
            {x.label}
          </button>
        ))}
      </nav>
      <div className="dlg-main">
        <h3 className="pane-title">{PANES.find((x) => x.id === pane)!.label}</h3>

        {pane === 'general' && (
          <>
            <PrefSection title="Files">
              <PrefRow title="Recent documents" description="The list on the start screen. Files themselves are not touched.">
                <button className="btn" onClick={async () => { await window.quvrelo.clearRecent(); toast('Recent documents cleared', 'success'); }} disabled={!editor.feature('recent-files' as never)}>Clear list</button>
              </PrefRow>
              <PrefRow title="Autosave" description={p.autosaveIntervalSeconds ? `Every ${p.autosaveIntervalSeconds} seconds, kept for crash recovery.` : 'Turned off by your organisation.'}>
                <span className="value-text" style={{ color: 'var(--c-text-3)' }}>{p.autosaveIntervalSeconds ? 'On' : 'Off'}</span>
              </PrefRow>
            </PrefSection>
            <PrefSection title="Updates">
              <PrefRow title="Automatically download updates" description={autoDlDesc} htmlFor="pref-autodl">
                <Check
                  id="pref-autodl"
                  checked={upd ? upd.autoDownload : s.autoDownloadUpdates}
                  disabled={autoDlLocked}
                  onChange={(v) => setSetting({ autoDownloadUpdates: v })}
                />
              </PrefRow>
              <PrefRow
                title="Update channel"
                description={channelLocked && !updOff ? 'Set by your organisation.' : 'Beta gets new features early and may be less polished.'}
              >
                <Segmented
                  label="Update channel"
                  value={upd?.channel ?? s.updateChannel}
                  disabled={channelLocked}
                  options={[{ value: 'stable', label: 'Stable' }, { value: 'beta', label: 'Beta' }]}
                  onChange={(v) => setSetting({ updateChannel: v })}
                />
              </PrefRow>
              <PrefRow title="Software update" description={upd ? `Quvrelo ${upd.current}` : undefined}>
                <button className="btn" disabled={updOff} onClick={() => openDialog('updates')}>Check now</button>
              </PrefRow>
            </PrefSection>
          </>
        )}

        {pane === 'appearance' && (
          <>
            <PrefSection title="Theme">
              <ThemeTiles value={p.forceTheme ?? s.theme} locked={!!p.forceTheme} onChange={(t) => setSetting({ theme: t })} />
            </PrefSection>
            <PrefSection title="Interface">
              <PrefRow title="Interface size" description="Scales every panel, menu and dialog." htmlFor="pref-scale">
                <input id="pref-scale" type="range" min={75} max={200} step={5} value={scale} disabled={p.lockUiScale} onChange={(e) => setSetting({ uiScale: parseInt(e.target.value, 10) / 100 })} aria-valuetext={`${scale}%`} />
                <span className="value-text">{scale}%</span>
              </PrefRow>
            </PrefSection>
          </>
        )}

        {pane === 'canvas' && (
          <PrefSection title="Guides">
            <PrefRow title="Show rulers" description="Horizontal and vertical rulers around the canvas." htmlFor="pref-rulers">
              <Check id="pref-rulers" checked={s.showRulers} onChange={(v) => setSetting({ showRulers: v })} />
            </PrefRow>
            <PrefRow title="Snapping" description="Snap to page edges, margins, guides and other objects." htmlFor="pref-snap">
              <Check id="pref-snap" checked={s.snapping} onChange={(v) => setSetting({ snapping: v })} />
            </PrefRow>
            <PrefRow title="Floating selection toolbar" description="Shows the most useful actions next to what you select. F6 moves focus into it." htmlFor="pref-stb">
              <Check id="pref-stb" checked={s.showSelectionToolbar !== false} onChange={(v) => setSetting({ showSelectionToolbar: v })} />
            </PrefRow>
          </PrefSection>
        )}

        {pane === 'accessibility' && (
          <PrefSection title="Reading and motion">
            <PrefRow title="Dyslexia-friendly interface font" description="Uses OpenDyslexic for menus, panels and dialogs. Documents are unchanged." htmlFor="pref-dys">
              <Check id="pref-dys" checked={s.dyslexiaFriendlyUi} onChange={(v) => setSetting({ dyslexiaFriendlyUi: v })} />
            </PrefRow>
            <PrefRow title="Reduce motion" description="Turns off marching ants and interface animations." htmlFor="pref-motion">
              <Check id="pref-motion" checked={s.reduceMotion} onChange={(v) => setSetting({ reduceMotion: v })} />
            </PrefRow>
          </PrefSection>
        )}

        {managed && (
          <div className="pref-note">
            <Icon name="lock" size={16} />
            <span>Some settings are managed by your organisation{p.organizationName ? ` (${p.organizationName})` : ''}.</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
