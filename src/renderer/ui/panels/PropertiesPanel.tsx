import { BLEND_MODES, type BlendMode, type Paint, type SceneNode, type Stroke } from '../../../core/types';
import { updateNode, updateNodes, releaseMask } from '../../../core/commands';
import { fromPx, toPx } from '../../../core/units';
import { editor } from '../../state/editor';
import { runCommand } from '../../state/commands';
import { renderBounds } from '../../engine/draw';
import { useEditor } from '../hooks';
import { PaintEditor } from '../ColorControls';
import { NumberField, SliderField } from '../controls/NumberField';
import { Section } from '../controls/Panel';
import { evalArithmetic } from '../controls/numeric';
import type { Unit } from '../../../core/types';

export { evalArithmetic };

/** Compact numeric field used across Properties (scrub label, arrow keys, units, arithmetic). */
export function NumField({ value, onCommit, onChange, step = 1, min, max, label, suffix, unit, lengthUnit, digits = 2, ariaLabel }: { value: number; onCommit: (v: number) => void; onChange?: (v: number) => void; step?: number; min?: number; max?: number; label: string; suffix?: string; unit?: string; lengthUnit?: Unit; digits?: number; ariaLabel?: string }) {
  return <NumberField label={label} ariaLabel={ariaLabel ?? label + (suffix ? ` (${suffix})` : '')} value={value} onCommit={onCommit} onChange={onChange} step={step} min={min} max={max} digits={digits} unit={unit} lengthUnit={lengthUnit} />;
}

function patchSel(label: string, fn: (n: SceneNode) => SceneNode, merge?: string) {
  editor.commit(label, (d) => updateNodes(d, editor.ui.selection, fn), merge);
}

function StrokeEditor({ stroke, onChange }: { stroke: Stroke; onChange: (s: Stroke) => void }) {
  const dash = stroke.dash.length ? (stroke.dash[0] === stroke.width ? 'dot' : 'dash') : 'solid';
  return (
    <>
      <PaintEditor paint={stroke.paint} onChange={(p) => onChange({ ...stroke, paint: p, width: p.type !== 'none' && stroke.width === 0 ? 2 : stroke.width })} />
      {stroke.paint.type !== 'none' && (
        <div className="stroke-grid">
          <NumberField label="W" ariaLabel="Stroke width" unit="px" value={stroke.width} min={0} max={500} step={0.5} onChange={(v) => onChange({ ...stroke, width: v })} onCommit={(v) => onChange({ ...stroke, width: v })} />
          <select value={dash} aria-label="Dash style" onChange={(e) => {
            const v = e.target.value;
            onChange({ ...stroke, dash: v === 'solid' ? [] : v === 'dash' ? [stroke.width * 3, stroke.width * 2] : [stroke.width, stroke.width * 1.5], cap: v === 'dot' ? 'round' : stroke.cap });
          }}>
            <option value="solid">Solid</option>
            <option value="dash">Dashed</option>
            <option value="dot">Dotted</option>
          </select>
          <select value={stroke.cap} aria-label="Line cap" onChange={(e) => onChange({ ...stroke, cap: e.target.value as Stroke['cap'] })}>
            <option value="butt">Butt cap</option><option value="round">Round cap</option><option value="square">Square cap</option>
          </select>
          <select value={stroke.join} aria-label="Line join" onChange={(e) => onChange({ ...stroke, join: e.target.value as Stroke['join'] })}>
            <option value="miter">Mitre join</option><option value="round">Round join</option><option value="bevel">Bevel join</option>
          </select>
        </div>
      )}
    </>
  );
}

const blendLabel = (m: string) => m.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function DocumentProperties() {
  const ed = useEditor();
  const d = ed.doc!;
  const s = d.settings;
  const u = ed.settings.units;
  return (
    <div>
      <Section id="doc" title="Document">
        <div className="row"><label htmlFor="doc-title">Title</label><input id="doc-title" type="text" value={d.title} onChange={(e) => ed.commit('Rename document', (x) => ({ ...x, title: e.target.value }), 'title')} /></div>
        <div className="row"><label>Size</label><span className="value num">{Math.round(fromPx(s.width, u) * 100) / 100} × {Math.round(fromPx(s.height, u) * 100) / 100} {u}</span></div>
        <div className="row"><label>Pages</label><span className="value num">{d.pages.length}</span></div>
        <div className="row">
          <label>Background</label>
          <input type="color" value={s.background ?? '#ffffff'} aria-label="Background colour" disabled={!s.background} onChange={(e) => ed.commit('Background', (x) => ({ ...x, settings: { ...x.settings, background: e.target.value } }), 'bg')} />
          <label className="check"><input type="checkbox" checked={!s.background} onChange={(e) => ed.commit('Background', (x) => ({ ...x, settings: { ...x.settings, background: e.target.checked ? null : '#ffffff' } }))} /> Transparent</label>
        </div>
        <div className="row"><span className="row-spacer" /><button className="btn sm" onClick={() => runCommand('file.document-setup')}>Document Setup…</button></div>
      </Section>
      <p className="hint pad">Select an object to see its properties. Double-click text to edit it, or a picture frame to place an image.</p>
    </div>
  );
}

const SHAPE_TITLE: Partial<Record<SceneNode['type'], string>> = { rect: 'Shape', polygon: 'Shape', star: 'Shape', textframe: 'Text frame', imageframe: 'Picture frame', raster: 'Pixel layer' };

export function PropertiesPanel() {
  const ed = useEditor();
  const nodes = ed.selectedNodes();
  if (!ed.doc) return null;
  if (!nodes.length) return <DocumentProperties />;
  const n = nodes[0];
  const multi = nodes.length > 1;
  const u = ed.settings.units;
  const b = renderBounds(n);
  const conv = (px: number) => fromPx(px, u);
  const back = (v: number) => toPx(v, u);
  // bounds are read inside the commit so live scrubs never compound
  const moveTo = (x: number | null, y: number | null, merge?: string) =>
    editor.commit('Move', (d) => updateNode(d, n.id, (m: SceneNode) => {
      const bb = renderBounds(m);
      return { ...m, x: x === null ? m.x : m.x + (back(x) - bb.x), y: y === null ? m.y : m.y + (back(y) - bb.y) };
    }), merge);
  const resize = (w: number | null, h: number | null, merge?: string) =>
    editor.commit('Resize', (d) => updateNode(d, n.id, (m: SceneNode) => {
      const bb = renderBounds(m);
      const fw = w === null ? 1 : back(w) / Math.max(0.0001, bb.w);
      const fh = h === null ? 1 : back(h) / Math.max(0.0001, bb.h);
      if ('w' in m && ['rect', 'ellipse', 'polygon', 'star', 'textframe', 'imageframe'].includes(m.type)) return { ...m, w: m.w * fw, h: m.h * fh } as SceneNode;
      return { ...m, scaleX: m.scaleX * fw, scaleY: m.scaleY * fh };
    }), merge);
  const patch = (label: string, p: Partial<SceneNode>, merge?: string) => editor.commit(label, (d) => updateNode(d, n.id, p), merge);
  const hasFill = 'fill' in n && n.type !== 'textframe';
  const hasStroke = 'stroke' in n;
  const k = (f: string) => `scrub:${f}:${n.id}`;
  const lenDigits = u === 'px' || u === 'pt' ? 1 : 2;
  const mixedOpacity = nodes.some((m) => m.opacity !== n.opacity);
  const mixedBlend = nodes.some((m) => m.blend !== n.blend);
  return (
    <div className="properties">
      <div className="prop-title" title={multi ? undefined : n.name}>{multi ? `${nodes.length} objects` : n.name}</div>
      {!multi && (
        <Section id="transform" title="Transform">
          <div className="grid2">
            <NumField label="X" ariaLabel={`X (${u})`} unit={u} lengthUnit={u} digits={lenDigits} value={conv(b.x)} onChange={(v) => moveTo(v, null, k('x'))} onCommit={(v) => moveTo(v, null, k('x'))} />
            <NumField label="Y" ariaLabel={`Y (${u})`} unit={u} lengthUnit={u} digits={lenDigits} value={conv(b.y)} onChange={(v) => moveTo(null, v, k('y'))} onCommit={(v) => moveTo(null, v, k('y'))} />
            <NumField label="W" ariaLabel={`Width (${u})`} unit={u} lengthUnit={u} digits={lenDigits} value={conv(b.w)} min={0.01} onChange={(v) => resize(v, null, k('w'))} onCommit={(v) => resize(v, null, k('w'))} />
            <NumField label="H" ariaLabel={`Height (${u})`} unit={u} lengthUnit={u} digits={lenDigits} value={conv(b.h)} min={0.01} onChange={(v) => resize(null, v, k('h'))} onCommit={(v) => resize(null, v, k('h'))} />
            <NumField label="R" ariaLabel="Rotation (degrees)" unit="°" digits={1} value={n.rotation} step={1} onChange={(v) => patch('Rotate', { rotation: ((v % 360) + 360) % 360 }, k('r'))} onCommit={(v) => patch('Rotate', { rotation: ((v % 360) + 360) % 360 }, k('r'))} />
            <NumField label="S" ariaLabel="Shear (degrees)" unit="°" digits={1} value={n.skewX} step={1} min={-80} max={80} onChange={(v) => patch('Shear', { skewX: v }, k('s'))} onCommit={(v) => patch('Shear', { skewX: v }, k('s'))} />
          </div>
        </Section>
      )}
      <Section id="appearance" title="Layer">
        <SliderField label="Opacity" ariaLabel="Opacity" unit="%" min={0} max={100} value={mixedOpacity ? 100 : Math.round(n.opacity * 100)} onChange={(v) => patchSel('Opacity', (m) => ({ ...m, opacity: v / 100 }), 'opacity')} />
        <div className="row">
          <label htmlFor="prop-blend">Blend</label>
          <select id="prop-blend" value={mixedBlend ? '' : n.blend} onChange={(e) => patchSel('Blend mode', (m) => ({ ...m, blend: e.target.value as BlendMode }))}>
            {mixedBlend && <option value="" disabled>Mixed</option>}
            {BLEND_MODES.map((m) => <option key={m} value={m}>{blendLabel(m)}</option>)}
          </select>
        </div>
      </Section>

      {!multi && SHAPE_TITLE[n.type] && (
        <Section id={`shape-${n.type}`} title={SHAPE_TITLE[n.type]}>
          {n.type === 'rect' && (
            <div className="grid2">
              <NumField label="Rad" ariaLabel="Corner radius (px)" unit="px" value={n.radius} min={0} onChange={(v) => patch('Corner radius', { radius: v } as Partial<SceneNode>, k('rad'))} onCommit={(v) => patch('Corner radius', { radius: v } as Partial<SceneNode>, k('rad'))} />
            </div>
          )}
          {n.type === 'polygon' && (
            <div className="grid2">
              <NumField label="Sides" ariaLabel="Sides" value={n.sides} min={3} max={64} digits={0} onChange={(v) => patch('Sides', { sides: Math.round(v) } as Partial<SceneNode>, k('sides'))} onCommit={(v) => patch('Sides', { sides: Math.round(v) } as Partial<SceneNode>, k('sides'))} />
            </div>
          )}
          {n.type === 'star' && (
            <>
              <div className="grid2">
                <NumField label="Pts" ariaLabel="Points" value={n.points} min={3} max={64} digits={0} onChange={(v) => patch('Points', { points: Math.round(v) } as Partial<SceneNode>, k('pts'))} onCommit={(v) => patch('Points', { points: Math.round(v) } as Partial<SceneNode>, k('pts'))} />
              </div>
              <SliderField label="Inner radius" unit="%" min={5} max={100} value={Math.round(n.innerRatio * 100)} onChange={(v) => patch('Inner radius', { innerRatio: v / 100 } as Partial<SceneNode>, 'inner')} />
            </>
          )}
          {n.type === 'textframe' && (
            <>
              <div className="grid2">
                <NumField label="Col" ariaLabel="Columns" value={n.columns} min={1} max={12} digits={0} onChange={(v) => patch('Columns', { columns: Math.round(v) } as Partial<SceneNode>, k('col'))} onCommit={(v) => patch('Columns', { columns: Math.round(v) } as Partial<SceneNode>, k('col'))} />
                <NumField label="Gap" ariaLabel="Column gap (px)" unit="px" value={n.columnGap} min={0} onChange={(v) => patch('Column gap', { columnGap: v } as Partial<SceneNode>, k('gap'))} onCommit={(v) => patch('Column gap', { columnGap: v } as Partial<SceneNode>, k('gap'))} />
                <NumField label="Inset" ariaLabel="Inset (px)" unit="px" value={n.padding} min={0} onChange={(v) => patch('Inset', { padding: v } as Partial<SceneNode>, k('inset'))} onCommit={(v) => patch('Inset', { padding: v } as Partial<SceneNode>, k('inset'))} />
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => runCommand('text.link')} title="Select this frame and another, then link">Link frames</button>
                <button className="btn sm ghost" onClick={() => runCommand('text.unlink')}>Unlink</button>
              </div>
              <div className="sub-title">Frame fill</div>
              <PaintEditor paint={n.fill} onChange={(p) => editor.commit('Frame fill', (d) => updateNode(d, n.id, { fill: p } as Partial<SceneNode>), 'ffill')} />
            </>
          )}
          {n.type === 'imageframe' && (
            <>
              <div className="row">
                <label htmlFor="prop-fit">Fit</label>
                <select id="prop-fit" value={n.fit} onChange={(e) => editor.commit('Fit', (d) => updateNode(d, n.id, { fit: e.target.value as never, contentX: 0, contentY: 0, contentScale: 1 } as Partial<SceneNode>))}>
                  <option value="fill">Fill frame</option><option value="fit">Fit inside</option><option value="stretch">Stretch</option><option value="none">Original size</option>
                </select>
              </div>
              <SliderField label="Zoom" ariaLabel="Image zoom" unit="%" min={10} max={400} value={Math.round(n.contentScale * 100)} onChange={(v) => patch('Image zoom', { contentScale: v / 100 } as Partial<SceneNode>, 'cscale')} />
              <div className="grid2">
                <NumField label="X" ariaLabel="Image offset X (px)" unit="px" value={n.contentX} onChange={(v) => patch('Image offset', { contentX: v } as Partial<SceneNode>, k('cx'))} onCommit={(v) => patch('Image offset', { contentX: v } as Partial<SceneNode>, k('cx'))} />
                <NumField label="Y" ariaLabel="Image offset Y (px)" unit="px" value={n.contentY} onChange={(v) => patch('Image offset', { contentY: v } as Partial<SceneNode>, k('cy'))} onCommit={(v) => patch('Image offset', { contentY: v } as Partial<SceneNode>, k('cy'))} />
              </div>
              <div className="row"><button className="btn sm" onClick={() => runCommand('file.place')}>Place image…</button></div>
            </>
          )}
          {n.type === 'raster' && (
            <>
              <div className="row"><label>Pixels</label><span className="value num">{ed.assets.get(n.assetId)?.width ?? n.w} × {ed.assets.get(n.assetId)?.height ?? n.h}</span></div>
              <div className="row"><label>Effects</label><span className="value">{n.adjustments.length ? `${n.adjustments.length} live adjustment${n.adjustments.length > 1 ? 's' : ''}` : 'None'}</span></div>
            </>
          )}
        </Section>
      )}

      {hasFill && (
        <Section id="fill" title="Fill">
          <PaintEditor paint={(n as { fill: Paint }).fill} onChange={(p) => patchSel('Fill', (m) => ('fill' in m ? ({ ...m, fill: p } as SceneNode) : m), 'fill')} />
        </Section>
      )}
      {n.type === 'text' && (
        <Section id="text-colour" title="Text colour">
          <PaintEditor paint={n.style.fill} allowNone={false} onChange={(p) => patchSel('Text colour', (m) => (m.type === 'text' ? { ...m, style: { ...m.style, fill: p } } : m), 'tfill')} />
        </Section>
      )}
      {n.type === 'textframe' && ed.doc.stories[n.storyId] && (
        <Section id="text-colour" title="Text colour">
          <PaintEditor paint={ed.doc.stories[n.storyId].style.fill} allowNone={false} onChange={(p) => editor.commit('Text colour', (d) => ({ ...d, stories: { ...d.stories, [n.storyId]: { ...d.stories[n.storyId], style: { ...d.stories[n.storyId].style, fill: p } } } }), 'sfill')} />
        </Section>
      )}
      {hasStroke && (
        <Section id="stroke" title="Stroke">
          <StrokeEditor stroke={(n as { stroke: Stroke }).stroke} onChange={(s) => patchSel('Stroke', (m) => ('stroke' in m ? ({ ...m, stroke: s } as SceneNode) : m), 'stroke')} />
        </Section>
      )}
      {!multi && n.mask && (
        <Section id="mask" title="Mask">
          <div className="row">
            <label className="check"><input type="checkbox" checked={n.mask.enabled} onChange={(e) => editor.commit('Mask', (d) => updateNode(d, n.id, { mask: { ...n.mask!, enabled: e.target.checked } }))} /> Enabled</label>
            <label className="check"><input type="checkbox" checked={n.mask.inverted} onChange={(e) => editor.commit('Mask', (d) => updateNode(d, n.id, { mask: { ...n.mask!, inverted: e.target.checked } }))} /> Inverted</label>
            <span className="row-spacer" />
            <button className="btn sm ghost" onClick={() => editor.commit('Release mask', (d) => releaseMask(d, n.id))}>Release</button>
          </div>
        </Section>
      )}
    </div>
  );
}
