import { useState } from 'react';
import { findNode } from '../../core/document';
import { setStoryStyle, updateNode, updateNodes } from '../../core/commands';
import { PX_PER } from '../../core/units';
import type { DocumentSettings, SceneNode, TextAlign, TextFrameNode, TextStyle } from '../../core/types';
import { editor } from '../state/editor';
import { runCommand } from '../state/commands';
import { useEditor } from './hooks';
import { Icon } from './Icons';
import { toolLabel } from './Workspace';

export const BUNDLED_FONTS = ['Inter', 'Atkinson Hyperlegible', 'OpenDyslexic', 'Merriweather', 'Roboto Slab', 'Caveat'];
export const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Comic Sans MS', 'Segoe UI', 'Calibri'];
let localFonts: string[] = [];

export function fontOptions(): string[] {
  return [...new Set([...BUNDLED_FONTS, ...SYSTEM_FONTS, ...localFonts])];
}

export async function loadLocalFonts(): Promise<number> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!q || !editor.feature('local-fonts')) return 0;
  try {
    const list = await q();
    localFonts = [...new Set(list.map((f) => f.family))].sort();
    editor.emit();
    return localFonts.length;
  } catch {
    return 0;
  }
}

export function primaryFamily(f: string): string {
  return f.split(',')[0].replace(/["']/g, '').trim();
}

/** The text style currently being edited (selected text node / frame story), if any. */
export function activeTextTarget(): { style: TextStyle; apply: (patch: Partial<TextStyle>) => void } | null {
  const doc = editor.doc;
  if (!doc) return null;
  const id = editor.ui.editingTextId ?? editor.ui.selection[0];
  const n = id ? findNode(doc, id)?.node : null;
  if (n?.type === 'text') {
    return {
      style: n.style,
      apply: (patch) => editor.commit('Text style', (d) => updateNode(d, n.id, (x: SceneNode) => (x.type === 'text' ? { ...x, style: { ...x.style, ...patch } } : x)), 'style:' + n.id),
    };
  }
  if (n?.type === 'textframe' && doc.stories[n.storyId]) {
    return {
      style: doc.stories[n.storyId].style,
      apply: (patch) => editor.commit('Text style', (d) => setStoryStyle(d, n.storyId, patch), 'style:' + n.storyId),
    };
  }
  return null;
}

function Num({ label, value, min, max, step = 1, onChange, width = 60 }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; width?: number }) {
  return (
    <label className="group">
      {label}
      <input type="number" value={Math.round(value * 100) / 100} min={min} max={max} step={step} style={{ width }} onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
      }} />
    </label>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, fmt }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="group">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} aria-label={label} />
      <span className="num" style={{ width: 40, color: 'var(--c-text-2)' }}>{fmt ? fmt(value) : Math.round(value)}</span>
    </label>
  );
}

/** Document-unit number field: shows the user's display units, stores px. */
function UnitNum({ label, title, px, onChange, width = 44 }: { label: string; title: string; px: number; onChange: (px: number) => void; width?: number }) {
  const u = editor.settings.units;
  const k = PX_PER[u];
  return (
    <label className="group" title={title}>
      <span className="field-label">{label}</span>
      <input type="number" aria-label={title} value={Math.round((px / k) * 100) / 100} min={0} step={u === 'px' ? 1 : 0.5} style={{ width }} onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(Math.max(0, v * k));
      }} />
    </label>
  );
}

function setDocSettings(patch: Partial<DocumentSettings>, label: string, key: string) {
  editor.commit(label, (d) => ({ ...d, settings: { ...d.settings, ...patch } }), key);
}

/**
 * Layout with nothing selected: page navigation and page setup (margins, bleed,
 * columns, facing pages) right in the context bar, as in a DTP app.
 */
function LayoutPageControls() {
  const ed = useEditor();
  const doc = ed.doc!;
  const s = doc.settings;
  const i = ed.activePageIndex;
  const m = s.margins;
  const setMargin = (side: keyof typeof m) => (v: number) => setDocSettings({ margins: { ...m, [side]: v } }, 'Margins', 'margins');
  return (
    <>
      <div className="group" role="group" aria-label="Pages">
        <button className="icon-btn sm" aria-label="Previous page" title="Previous page" disabled={i <= 0} onClick={() => runCommand('page.prev')}><Icon name="chevron-left" /></button>
        <span className="page-count">{i >= 0 ? <>Page <span className="num">{i + 1}</span> of <span className="num">{doc.pages.length}</span></> : 'Master'}</span>
        <button className="icon-btn sm" aria-label="Next page" title="Next page" disabled={i < 0 || i >= doc.pages.length - 1} onClick={() => runCommand('page.next')}><Icon name="chevron-right" /></button>
        <button className="icon-btn sm" aria-label="Add page" title="Add page" onClick={() => runCommand('page.add')}><Icon name="plus" /></button>
      </div>
      <div className="group" role="group" aria-label="Margins">
        <span className="field-label">Margins</span>
        <UnitNum label="T" title="Top margin" px={m.top} onChange={setMargin('top')} />
        <UnitNum label="L" title={s.facingPages ? 'Inside margin' : 'Left margin'} px={m.left} onChange={setMargin('left')} />
        <UnitNum label="B" title="Bottom margin" px={m.bottom} onChange={setMargin('bottom')} />
        <UnitNum label="R" title={s.facingPages ? 'Outside margin' : 'Right margin'} px={m.right} onChange={setMargin('right')} />
      </div>
      <div className="group">
        <UnitNum label="Bleed" title="Bleed" px={s.bleed} onChange={(v) => setDocSettings({ bleed: v }, 'Bleed', 'bleed')} />
        <label className="group" title="Columns">
          <span className="field-label">Columns</span>
          <input type="number" aria-label="Columns" value={s.columns} min={1} max={12} step={1} style={{ width: 40 }} onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v >= 1 && v <= 12) setDocSettings({ columns: v }, 'Columns', 'columns');
          }} />
        </label>
        <UnitNum label="Gutter" title="Column gutter" px={s.columnGutter} onChange={(v) => setDocSettings({ columnGutter: v }, 'Gutter', 'gutter')} />
        <button className={`btn ${s.facingPages ? 'selected' : ''}`} aria-pressed={s.facingPages} title="Show pages as two-page spreads" onClick={() => setDocSettings({ facingPages: !s.facingPages }, 'Facing pages', 'facing')}><Icon name="pages" /> Facing pages</button>
      </div>
      <div className="group">
        <button className="btn" onClick={() => runCommand('file.document-setup')}>Document setup…</button>
      </div>
    </>
  );
}

/** Text frame tool / selected frames: frame geometry and story linking. */
function TextFrameControls({ frames }: { frames: TextFrameNode[] }) {
  const ed = useEditor();
  const f = frames[0];
  const ids = frames.map((x) => x.id);
  const set = (patch: Partial<TextFrameNode>, label: string, key: string) => ed.commit(label, (d) => updateNodes(d, ids, (n) => (n.type === 'textframe' ? { ...n, ...patch } : n)), key + ids.join());
  const story = ed.doc!.stories[f.storyId];
  const linked = !!story && story.chain.length > 1;
  return (
    <div className="group" role="group" aria-label="Text frame">
      <label className="group" title="Frame columns">
        <span className="field-label">Columns</span>
        <input type="number" aria-label="Frame columns" value={f.columns} min={1} max={12} step={1} style={{ width: 40 }} onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (v >= 1 && v <= 12) set({ columns: v }, 'Frame columns', 'fcol');
        }} />
      </label>
      <UnitNum label="Gap" title="Column gap" px={f.columnGap} onChange={(v) => set({ columnGap: v }, 'Column gap', 'fgap')} />
      <UnitNum label="Inset" title="Text inset" px={f.padding} onChange={(v) => set({ padding: v }, 'Text inset', 'finset')} />
      <button className="icon-btn sm" title="Link frames: continue the story from the first selected frame into the second" aria-label="Link text frames" disabled={frames.length !== 2} onClick={() => runCommand('text.link')}><Icon name="link" /></button>
      {linked && <button className="btn" onClick={() => runCommand('text.unlink')}>Unlink</button>}
    </div>
  );
}

export function TextControls() {
  useEditor();
  const target = activeTextTarget();
  const o = editor.ui.toolOptions;
  const style: Partial<TextStyle> = target?.style ?? { fontFamily: o.fontFamily, fontSize: o.fontSize, fontWeight: 400, italic: false, underline: false, align: 'left' };
  const apply = (patch: Partial<TextStyle>) => {
    if (target) target.apply(patch);
    if (patch.fontFamily) editor.setToolOptions({ fontFamily: patch.fontFamily });
    if (patch.fontSize) editor.setToolOptions({ fontSize: patch.fontSize });
  };
  const [fontsLoaded, setFontsLoaded] = useState(false);
  return (
    <div className="group" data-keep-text-edit>
      <select aria-label="Font" value={primaryFamily(style.fontFamily ?? 'Inter')} style={{ width: 160 }} onChange={(e) => apply({ fontFamily: e.target.value })} onFocus={async () => { if (!fontsLoaded) { setFontsLoaded(true); await loadLocalFonts(); } }}>
        {fontOptions().map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        {!fontOptions().includes(primaryFamily(style.fontFamily ?? '')) && <option>{primaryFamily(style.fontFamily ?? '')}</option>}
      </select>
      <Num label="" value={style.fontSize ?? 16} min={4} max={1000} step={1} onChange={(v) => apply({ fontSize: v })} width={56} />
      <button className={`icon-btn sm ${style.fontWeight && style.fontWeight >= 600 ? 'active' : ''}`} aria-label="Bold" title="Bold" onClick={() => apply({ fontWeight: (style.fontWeight ?? 400) >= 600 ? 400 : 700 })}><b>B</b></button>
      <button className={`icon-btn sm ${style.italic ? 'active' : ''}`} aria-label="Italic" title="Italic" onClick={() => apply({ italic: !style.italic })}><i>I</i></button>
      <button className={`icon-btn sm ${style.underline ? 'active' : ''}`} aria-label="Underline" title="Underline" onClick={() => apply({ underline: !style.underline })}><u>U</u></button>
      {(['left', 'center', 'right', 'justify'] as TextAlign[]).map((a) => (
        <button key={a} className={`icon-btn sm ${style.align === a ? 'active' : ''}`} aria-label={`Align ${a}`} title={`Align ${a}`} onClick={() => apply({ align: a })}>
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2" fill="none">
            {a === 'left' && <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />}
            {a === 'center' && <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />}
            {a === 'right' && <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />}
            {a === 'justify' && <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />}
          </svg>
        </button>
      ))}
      {target && (
        <>
          <Num label="Leading" value={style.lineHeight ?? 1.3} min={0.6} max={4} step={0.05} onChange={(v) => apply({ lineHeight: v })} width={60} />
          <Num label="Tracking" value={style.letterSpacing ?? 0} min={-200} max={1000} step={10} onChange={(v) => apply({ letterSpacing: v })} width={52} />
        </>
      )}
    </div>
  );
}

export function ContextBar() {
  const ed = useEditor();
  const t = ed.ui.tool;
  const o = ed.ui.toolOptions;
  const sel = ed.selectedNodes();
  const frame = sel.find((n) => n.type === 'imageframe');
  const textSelected = sel.some((n) => n.type === 'text' || n.type === 'textframe') || !!ed.ui.editingTextId;
  const frames = sel.filter((n): n is TextFrameNode => n.type === 'textframe');
  const layout = ed.ui.studio === 'layout';
  return (
    <div className="contextbar" role="toolbar" aria-label="Tool options">
      <span className="tool-name">{toolLabel(t).replace(/ \(.*\)/, '')}</span>
      {(t === 'brush' || t === 'eraser') && (
        <>
          <Slider label="Size" value={t === 'brush' ? o.brushSize : o.eraserSize} min={1} max={500} onChange={(v) => ed.setToolOptions(t === 'brush' ? { brushSize: v } : { eraserSize: v })} fmt={(v) => `${Math.round(v)}px`} />
          <Slider label="Hardness" value={o.brushHardness * 100} min={0} max={100} onChange={(v) => ed.setToolOptions({ brushHardness: v / 100 })} fmt={(v) => `${Math.round(v)}%`} />
          <Slider label="Opacity" value={o.brushOpacity * 100} min={1} max={100} onChange={(v) => ed.setToolOptions({ brushOpacity: v / 100 })} fmt={(v) => `${Math.round(v)}%`} />
          {t === 'brush' && <label className="group">Colour <input type="color" value={ed.ui.fillColor.slice(0, 7)} onChange={(e) => ed.setUi({ fillColor: e.target.value })} aria-label="Brush colour" /></label>}
          <span style={{ color: 'var(--text-faint)' }}>[ and ] change size · paints on the selected pixel layer (or creates one)</span>
        </>
      )}
      {(t === 'marquee-rect' || t === 'marquee-ellipse' || t === 'lasso') && (
        <>
          <div className="group choice-row" role="radiogroup" aria-label="Selection mode">
            {(['new', 'add', 'subtract', 'intersect'] as const).map((m) => (
              <button key={m} className={`btn ${o.selectionMode === m ? 'selected' : ''}`} role="radio" aria-checked={o.selectionMode === m} onClick={() => ed.setToolOptions({ selectionMode: m })}>{m[0].toUpperCase() + m.slice(1)}</button>
            ))}
          </div>
          <div className="group">
            <button className="icon-btn sm" title="Select all pixels" aria-label="Select all" onClick={() => runCommand('select.all-pixels')}><Icon name="select-all" /></button>
            <button className="icon-btn sm" title="Deselect (Ctrl+Shift+D)" aria-label="Deselect" onClick={() => runCommand('select.none')} disabled={!ed.ui.pixelSelection}><Icon name="deselect" /></button>
            <button className="icon-btn sm" title="Invert selection (Ctrl+Shift+I)" aria-label="Invert selection" onClick={() => runCommand('select.invert')} disabled={!ed.ui.pixelSelection}><Icon name="select-invert" /></button>
          </div>
          <div className="group">
            <button className="btn" onClick={() => runCommand('select.crop')} disabled={!ed.ui.pixelSelection}><Icon name="crop" /> Crop to selection</button>
            <button className="icon-btn sm" title="Copy selection to a new layer" aria-label="Copy selection to a new layer" onClick={() => runCommand('select.copy-to-layer')} disabled={!ed.ui.pixelSelection}><Icon name="copy" /></button>
            <button className="btn" onClick={() => runCommand('layer.mask-selection')} disabled={!ed.ui.pixelSelection || !sel.length}><Icon name="mask" /> Mask layer</button>
          </div>
        </>
      )}
      {t === 'crop' && <span style={{ color: 'var(--text-dim)' }}>Drag to set the crop area, then press Enter or double-click. Esc cancels.</span>}
      {t === 'fill' && (
        <>
          <Slider label="Tolerance" value={o.fillTolerance} min={0} max={255} onChange={(v) => ed.setToolOptions({ fillTolerance: v })} />
          <label className="group">Colour <input type="color" value={ed.ui.fillColor.slice(0, 7)} onChange={(e) => ed.setUi({ fillColor: e.target.value })} aria-label="Fill colour" /></label>
          <span style={{ color: 'var(--text-faint)' }}>Fills pixels on a pixel layer, or recolours a shape</span>
        </>
      )}
      {t === 'rect' && <Num label="Corner radius" value={o.cornerRadius} min={0} max={1000} onChange={(v) => ed.setToolOptions({ cornerRadius: v })} />}
      {t === 'polygon' && <Num label="Sides" value={o.polygonSides} min={3} max={64} onChange={(v) => ed.setToolOptions({ polygonSides: Math.round(v) })} />}
      {t === 'star' && (
        <>
          <Num label="Points" value={o.starPoints} min={3} max={64} onChange={(v) => ed.setToolOptions({ starPoints: Math.round(v) })} />
          <Slider label="Inner radius" value={o.starInner * 100} min={5} max={100} onChange={(v) => ed.setToolOptions({ starInner: v / 100 })} fmt={(v) => `${Math.round(v)}%`} />
        </>
      )}
      {['rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'pencil'].includes(t) && (
        <>
          <Num label="Stroke" value={o.strokeWidth} min={0} max={200} step={0.5} onChange={(v) => ed.setToolOptions({ strokeWidth: v })} />
          <label className="group">Fill <input type="color" value={ed.ui.fillColor.slice(0, 7)} onChange={(e) => ed.setUi({ fillColor: e.target.value, fillEnabled: true })} aria-label="Fill colour" /></label>
          <label className="group">Stroke <input type="color" value={ed.ui.strokeColor.slice(0, 7)} onChange={(e) => ed.setUi({ strokeColor: e.target.value, strokeEnabled: true })} aria-label="Stroke colour" /></label>
          <span style={{ color: 'var(--text-faint)' }}>{t === 'pen' ? 'Click for corners, drag for curves, click the first point to close, Enter to finish' : 'Shift constrains · Alt draws from centre'}</span>
        </>
      )}
      {layout && t === 'move' && sel.length === 0 && !ed.ui.editingTextId && <LayoutPageControls />}
      {(t === 'textframe' || t === 'move') && frames.length > 0 && <TextFrameControls frames={frames} />}
      {(t === 'text' || t === 'textframe' || (t === 'move' && textSelected)) && <TextControls />}
      {t === 'textframe' && frames.length === 0 && <span>Drag to draw a text frame · select two frames and Link to flow a story between them</span>}
      {t === 'node' && (
        <>
          <span style={{ color: 'var(--text-dim)' }}>Drag nodes and handles · double-click a node to toggle smooth/corner · Delete removes a node · Alt breaks handles</span>
          <button className="btn" onClick={() => runCommand('layer.convert-curves')} disabled={!sel.length}>Convert to curves</button>
        </>
      )}
      {(t === 'imageframe' || (t === 'move' && frame)) && frame && frame.type === 'imageframe' && (
        <div className="group">
          <label>Fit</label>
          {(['fill', 'fit', 'stretch', 'none'] as const).map((f) => (
            <button key={f} className={`btn ${frame.fit === f ? 'selected' : ''}`} onClick={() => ed.commit('Frame fit', (d) => updateNode(d, frame.id, { fit: f, contentX: 0, contentY: 0, contentScale: 1 } as Partial<SceneNode>))}>{f[0].toUpperCase() + f.slice(1)}</button>
          ))}
          <button className="btn" onClick={() => runCommand('file.place')}><Icon name="image" /> Place…</button>
        </div>
      )}
      {t === 'move' && sel.length > 0 && !textSelected && !frame && (
        <div className="group">
          <button className="icon-btn sm" title="Flip horizontal" aria-label="Flip horizontal" onClick={() => runCommand('arrange.flip-h')}><Icon name="flip-h" /></button>
          <button className="icon-btn sm" title="Flip vertical" aria-label="Flip vertical" onClick={() => runCommand('arrange.flip-v')}><Icon name="flip-v" /></button>
          <button className="icon-btn sm" title="Rotate 90°" aria-label="Rotate 90 degrees" onClick={() => runCommand('arrange.rotate-cw')}><Icon name="rotate" /></button>
          <button className="btn" onClick={() => runCommand(sel.length > 1 ? 'arrange.group' : 'arrange.ungroup')} disabled={sel.length === 1 && sel[0].type !== 'group'}>{sel.length > 1 ? 'Group' : 'Ungroup'}</button>
          {sel.length >= 3 && <button className="icon-btn sm" title="Distribute horizontally" aria-label="Distribute horizontally" onClick={() => runCommand('arrange.distribute-h')}><Icon name="distribute-h" /></button>}
          {sel.length >= 3 && <button className="icon-btn sm" title="Distribute vertically" aria-label="Distribute vertically" onClick={() => runCommand('arrange.distribute-v')}><Icon name="distribute-v" /></button>}
        </div>
      )}
      {t === 'eyedropper' && <span style={{ color: 'var(--text-dim)' }}>Click to pick a fill colour · Shift-click picks a stroke colour</span>}
      {t === 'zoom' && <span style={{ color: 'var(--text-dim)' }}>Click to zoom in · Alt-click to zoom out · drag to zoom to an area</span>}
      {t === 'hand' && <span style={{ color: 'var(--text-dim)' }}>Drag to pan · hold Space with any tool to pan</span>}
    </div>
  );
}
