import { useState } from 'react';
import { findNode } from '../../core/document';
import { setStoryStyle, updateNode } from '../../core/commands';
import type { SceneNode, TextAlign, TextStyle } from '../../core/types';
import { editor } from '../state/editor';
import { runCommand } from '../state/commands';
import { useEditor } from './hooks';
import { Icon } from './Icons';
import { toolLabel } from './Workspace';
import { NumberField } from './controls/NumberField';
import { ColorChipButton } from './color/Chips';

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
      <NumberField className="ctx" ariaLabel="Font size (pt)" label="Size" unit="pt" value={style.fontSize ?? 16} min={4} max={1000} onCommit={(v) => apply({ fontSize: v })} onChange={(v) => apply({ fontSize: v })} />
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
          <NumberField className="ctx" ariaLabel="Leading (line height multiple)" label="Leading" value={style.lineHeight ?? 1.3} min={0.6} max={4} step={0.05} onCommit={(v) => apply({ lineHeight: v })} onChange={(v) => apply({ lineHeight: v })} />
          <NumberField className="ctx" ariaLabel="Tracking (thousandths of an em)" label="Tracking" digits={0} value={style.letterSpacing ?? 0} min={-200} max={1000} step={10} onCommit={(v) => apply({ letterSpacing: v })} onChange={(v) => apply({ letterSpacing: v })} />
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
      {t === 'rect' && (
        <div className="group">
          <NumberField className="ctx" label="Radius" ariaLabel="Corner radius (px)" unit="px" value={o.cornerRadius} min={0} max={1000} onCommit={(v) => ed.setToolOptions({ cornerRadius: v })} onChange={(v) => ed.setToolOptions({ cornerRadius: v })} />
        </div>
      )}
      {t === 'polygon' && (
        <div className="group">
          <NumberField className="ctx" label="Sides" ariaLabel="Sides" digits={0} value={o.polygonSides} min={3} max={64} onCommit={(v) => ed.setToolOptions({ polygonSides: Math.round(v) })} onChange={(v) => ed.setToolOptions({ polygonSides: Math.round(v) })} />
        </div>
      )}
      {t === 'star' && (
        <div className="group">
          <NumberField className="ctx" label="Points" ariaLabel="Points" digits={0} value={o.starPoints} min={3} max={64} onCommit={(v) => ed.setToolOptions({ starPoints: Math.round(v) })} onChange={(v) => ed.setToolOptions({ starPoints: Math.round(v) })} />
          <NumberField className="ctx" label="Inner" ariaLabel="Inner radius percent" unit="%" digits={0} value={Math.round(o.starInner * 100)} min={5} max={100} onCommit={(v) => ed.setToolOptions({ starInner: v / 100 })} onChange={(v) => ed.setToolOptions({ starInner: v / 100 })} />
        </div>
      )}
      {['rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'pencil'].includes(t) && (
        <>
          <div className="group">
            <span className="ctx-label">Fill</span>
            <ColorChipButton kind="fill" label="Fill" color={ed.ui.fillColor} enabled={ed.ui.fillEnabled} onChange={(c) => ed.setUi({ fillColor: c, fillEnabled: true })} onToggle={(on) => ed.setUi({ fillEnabled: on })} />
            <span className="ctx-label">Stroke</span>
            <ColorChipButton kind="stroke" label="Stroke" color={ed.ui.strokeColor} enabled={ed.ui.strokeEnabled} onChange={(c) => ed.setUi({ strokeColor: c, strokeEnabled: true })} onToggle={(on) => ed.setUi({ strokeEnabled: on })} />
            <NumberField className="ctx" label="W" ariaLabel="Stroke width (px)" unit="px" step={0.5} value={o.strokeWidth} min={0} max={200} onCommit={(v) => ed.setToolOptions({ strokeWidth: v })} onChange={(v) => ed.setToolOptions({ strokeWidth: v })} />
          </div>
          <span className="ctx-hint">{t === 'pen' ? 'Click for corners, drag for curves, click the first point to close, Enter to finish' : 'Shift constrains · Alt draws from centre'}</span>
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
