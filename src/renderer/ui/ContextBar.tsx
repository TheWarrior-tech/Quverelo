import { findNode } from '../../core/document';
import { setStoryStyle, updateNode, updateNodes } from '../../core/commands';
import { PX_PER } from '../../core/units';
import { primaryFamily } from './fonts';
import type { DocumentSettings, SceneNode, TextAlign, TextFrameNode, TextStyle } from '../../core/types';
import { editor } from '../state/editor';
import { runCommand } from '../state/commands';
import { useEditor } from './hooks';
import { Icon } from './Icons';
import { toolLabel } from './Workspace';
import { tip } from './tooltip';
import { NumberField } from './controls/NumberField';
import { ColorChipButton } from './color/Chips';
import { Segmented } from './controls/Segmented';
import { CtxHint } from './controls/CtxHint';
import { FontPicker } from './controls/FontPicker';
import { FIT_OPTIONS } from './panels/PropertiesPanel';

export { BUNDLED_FONTS, SYSTEM_FONTS, fontOptions, loadLocalFonts, primaryFamily } from './fonts';

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
      <span className="num ctx-value">{fmt ? fmt(value) : Math.round(value)}</span>
    </label>
  );
}

/** Document-unit number field: shows the user's display units, stores px. */
function UnitNum({ label, title, px, onChange }: { label: string; title: string; px: number; onChange: (px: number) => void }) {
  const u = editor.settings.units;
  const k = PX_PER[u];
  return (
    <NumberField className="ctx" label={label} ariaLabel={title} title={title} lengthUnit={u} digits={u === 'px' ? 0 : 2} step={u === 'px' ? 1 : 0.5} min={0} value={px / k} onChange={(v) => onChange(Math.max(0, v * k))} onCommit={(v) => onChange(Math.max(0, v * k))} />
  );
}

/** Integer count field (columns). */
function CountNum({ label, title, value, onChange }: { label: string; title: string; value: number; onChange: (v: number) => void }) {
  return <NumberField className="ctx" label={label} ariaLabel={title} title={title} digits={0} min={1} max={12} value={value} onChange={(v) => onChange(Math.round(v))} onCommit={(v) => onChange(Math.round(v))} />;
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
        <button className="icon-btn sm" {...tip('Previous page', 'page.prev')} disabled={i <= 0} onClick={() => runCommand('page.prev')}><Icon name="chevron-left" /></button>
        <span className="page-count">{i >= 0 ? <>Page <span className="num">{i + 1}</span> of <span className="num">{doc.pages.length}</span></> : 'Master'}</span>
        <button className="icon-btn sm" {...tip('Next page', 'page.next')} disabled={i < 0 || i >= doc.pages.length - 1} onClick={() => runCommand('page.next')}><Icon name="chevron-right" /></button>
        <button className="icon-btn sm" {...tip('Add page', 'page.add')} onClick={() => runCommand('page.add')}><Icon name="plus" /></button>
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
        <CountNum label="Columns" title="Columns" value={s.columns} onChange={(v) => setDocSettings({ columns: v }, 'Columns', 'columns')} />
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
      <CountNum label="Columns" title="Frame columns" value={f.columns} onChange={(v) => set({ columns: v }, 'Frame columns', 'fcol')} />
      <UnitNum label="Gap" title="Column gap" px={f.columnGap} onChange={(v) => set({ columnGap: v }, 'Column gap', 'fgap')} />
      <UnitNum label="Inset" title="Text inset" px={f.padding} onChange={(v) => set({ padding: v }, 'Text inset', 'finset')} />
      <button className="icon-btn sm" {...tip('Link text frames')} title="Link frames: continue the story from the first selected frame into the second" disabled={frames.length !== 2} onClick={() => runCommand('text.link')}><Icon name="link" /></button>
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
  return (
    <div className="group" data-keep-text-edit>
      <FontPicker value={primaryFamily(style.fontFamily ?? 'Inter')} onPreview={(f) => target?.apply({ fontFamily: f })} onCommit={(f) => apply({ fontFamily: f })} />
      <NumberField className="ctx" ariaLabel="Font size (pt)" label="Size" unit="pt" value={style.fontSize ?? 16} min={4} max={1000} onCommit={(v) => apply({ fontSize: v })} onChange={(v) => apply({ fontSize: v })} />
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
          {t === 'brush' && (
            <div className="group">
              <span className="ctx-label">Colour</span>
              <ColorChipButton kind="fill" label="Brush" color={ed.ui.fillColor} enabled onChange={(c) => ed.setUi({ fillColor: c, fillEnabled: true })} />
            </div>
          )}
          <CtxHint>[ and ] change size · paints on the selected pixel layer</CtxHint>
        </>
      )}
      {(t === 'marquee-rect' || t === 'marquee-ellipse' || t === 'lasso') && (
        <>
          <div className="group">
            <Segmented
              ariaLabel="Selection mode"
              value={o.selectionMode}
              onChange={(m) => ed.setToolOptions({ selectionMode: m })}
              options={(['new', 'add', 'subtract', 'intersect'] as const).map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))}
            />
          </div>
          <div className="group">
            <button className="icon-btn sm" {...tip('Select all', 'select.all-pixels')} onClick={() => runCommand('select.all-pixels')}><Icon name="select-all" /></button>
            <button className="icon-btn sm" {...tip('Deselect', 'select.none')} onClick={() => runCommand('select.none')} disabled={!ed.ui.pixelSelection}><Icon name="deselect" /></button>
            <button className="icon-btn sm" {...tip('Invert selection', 'select.invert')} onClick={() => runCommand('select.invert')} disabled={!ed.ui.pixelSelection}><Icon name="select-invert" /></button>
          </div>
          <div className="group">
            <button className="btn" onClick={() => runCommand('select.crop')} disabled={!ed.ui.pixelSelection}><Icon name="crop" /> Crop to selection</button>
            <button className="icon-btn sm" {...tip('Copy selection to a new layer', 'select.copy-to-layer')} onClick={() => runCommand('select.copy-to-layer')} disabled={!ed.ui.pixelSelection}><Icon name="copy" /></button>
            <button className="btn" onClick={() => runCommand('layer.mask-selection')} disabled={!ed.ui.pixelSelection || !sel.length}><Icon name="mask" /> Mask layer</button>
          </div>
        </>
      )}
      {t === 'crop' && <CtxHint>Drag to set the crop area, then press Enter or double-click. Esc cancels.</CtxHint>}
      {t === 'fill' && (
        <>
          <Slider label="Tolerance" value={o.fillTolerance} min={0} max={255} onChange={(v) => ed.setToolOptions({ fillTolerance: v })} />
          <div className="group">
            <span className="ctx-label">Colour</span>
            <ColorChipButton kind="fill" label="Flood fill" color={ed.ui.fillColor} enabled onChange={(c) => ed.setUi({ fillColor: c, fillEnabled: true })} />
          </div>
          <CtxHint>Fills pixels on a pixel layer, or recolours a shape</CtxHint>
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
          <CtxHint>{t === 'pen' ? 'Click: corner · drag: curve · click the first point to close · Enter finishes' : 'Shift constrains · Alt draws from centre'}</CtxHint>
        </>
      )}
      {layout && t === 'move' && sel.length === 0 && !ed.ui.editingTextId && <LayoutPageControls />}
      {(t === 'textframe' || t === 'move') && frames.length > 0 && <TextFrameControls frames={frames} />}
      {(t === 'text' || t === 'textframe' || (t === 'move' && textSelected)) && <TextControls />}
      {t === 'textframe' && frames.length === 0 && <CtxHint>Drag to draw a text frame · link two frames to flow a story</CtxHint>}
      {t === 'node' && (
        <>
          <div className="group">
            <button className="btn" onClick={() => runCommand('layer.convert-curves')} disabled={!sel.length}>Convert to curves</button>
          </div>
          <CtxHint title="Drag nodes and handles · double-click a node to toggle smooth/corner · Delete removes a node · Alt breaks handles">Drag nodes · double-click: smooth/corner · Alt breaks handles</CtxHint>
        </>
      )}
      {(t === 'imageframe' || (t === 'move' && frame)) && frame && frame.type === 'imageframe' && (
        <div className="group">
          <span className="ctx-label">Fit</span>
          <Segmented ariaLabel="Frame fit" value={frame.fit} options={FIT_OPTIONS} onChange={(f) => ed.commit('Frame fit', (d) => updateNode(d, frame.id, { fit: f, contentX: 0, contentY: 0, contentScale: 1 } as Partial<SceneNode>))} />
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
      {t === 'eyedropper' && <CtxHint>Click picks a fill colour · Shift-click picks a stroke colour</CtxHint>}
      {t === 'zoom' && <CtxHint>Click zooms in · Alt-click zooms out · drag zooms to an area</CtxHint>}
      {t === 'hand' && <CtxHint>Drag to pan · hold Space with any tool to pan</CtxHint>}
    </div>
  );
}
