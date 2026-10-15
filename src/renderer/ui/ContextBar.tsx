import { useState } from 'react';
import { findNode } from '../../core/document';
import { setStoryStyle, updateNode } from '../../core/commands';
import type { SceneNode, TextAlign, TextStyle } from '../../core/types';
import { editor } from '../state/editor';
import { runCommand } from '../state/commands';
import { useEditor } from './hooks';
import { Icon } from './Icons';
import { toolLabel } from './Workspace';
import { tip } from './tooltip';

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
      <span style={{ width: 40, color: 'var(--text-dim)' }}>{fmt ? fmt(value) : Math.round(value)}</span>
    </label>
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
      <button className={`icon-btn sm ${style.fontWeight && style.fontWeight >= 600 ? 'active' : ''}`} {...tip('Bold')} aria-pressed={(style.fontWeight ?? 400) >= 600} onClick={() => apply({ fontWeight: (style.fontWeight ?? 400) >= 600 ? 400 : 700 })}><b>B</b></button>
      <button className={`icon-btn sm ${style.italic ? 'active' : ''}`} {...tip('Italic')} aria-pressed={!!style.italic} onClick={() => apply({ italic: !style.italic })}><i>I</i></button>
      <button className={`icon-btn sm ${style.underline ? 'active' : ''}`} {...tip('Underline')} aria-pressed={!!style.underline} onClick={() => apply({ underline: !style.underline })}><u>U</u></button>
      {(['left', 'center', 'right', 'justify'] as TextAlign[]).map((a) => (
        <button key={a} className={`icon-btn sm ${style.align === a ? 'active' : ''}`} {...tip(`Align text ${a === 'center' ? 'centre' : a}`)} aria-pressed={style.align === a} onClick={() => apply({ align: a })}>
          <Icon name={`text-${a}`} />
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
          <button className="btn" onClick={() => runCommand('select.all-pixels')}>Select all</button>
          <button className="btn" onClick={() => runCommand('select.invert')} disabled={!ed.ui.pixelSelection}>Invert</button>
          <button className="btn" onClick={() => runCommand('select.none')} disabled={!ed.ui.pixelSelection}>Deselect</button>
          <button className="btn" onClick={() => runCommand('select.crop')} disabled={!ed.ui.pixelSelection}>Crop</button>
          <button className="btn" onClick={() => runCommand('select.copy-to-layer')} disabled={!ed.ui.pixelSelection}>To new layer</button>
          <button className="btn" onClick={() => runCommand('layer.mask-selection')} disabled={!ed.ui.pixelSelection || !sel.length}>Mask layer</button>
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
      {(t === 'text' || t === 'textframe' || (t === 'move' && textSelected)) && <TextControls />}
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
          <button className="icon-btn sm" {...tip('Flip horizontal')} onClick={() => runCommand('arrange.flip-h')}><Icon name="flip-h" /></button>
          <button className="icon-btn sm" {...tip('Flip vertical')} onClick={() => runCommand('arrange.flip-v')}><Icon name="flip-v" /></button>
          <button className="icon-btn sm" {...tip('Rotate 90° clockwise')} onClick={() => runCommand('arrange.rotate-cw')}><Icon name="rotate" /></button>
          <button className="btn" onClick={() => runCommand(sel.length > 1 ? 'arrange.group' : 'arrange.ungroup')} disabled={sel.length === 1 && sel[0].type !== 'group'}>{sel.length > 1 ? 'Group' : 'Ungroup'}</button>
          {sel.length >= 3 && <button className="icon-btn sm" {...tip('Distribute horizontally')} onClick={() => runCommand('arrange.distribute-h')}><Icon name="distribute-h" /></button>}
          {sel.length >= 3 && <button className="icon-btn sm" {...tip('Distribute vertically')} onClick={() => runCommand('arrange.distribute-v')}><Icon name="distribute-v" /></button>}
        </div>
      )}
      {t === 'eyedropper' && <span style={{ color: 'var(--text-dim)' }}>Click to pick a fill colour · Shift-click picks a stroke colour</span>}
      {t === 'zoom' && <span style={{ color: 'var(--text-dim)' }}>Click to zoom in · Alt-click to zoom out · drag to zoom to an area</span>}
      {t === 'hand' && <span style={{ color: 'var(--text-dim)' }}>Drag to pan · hold Space with any tool to pan</span>}
    </div>
  );
}
