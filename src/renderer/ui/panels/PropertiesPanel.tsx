import { BLEND_MODES, type BlendMode, type Paint, type SceneNode, type Stroke } from '../../../core/types';
import { updateNode, updateNodes, releaseMask } from '../../../core/commands';
import { UNIT_DIGITS, UNIT_STEP, formatSize, fromPx, pixelsAt, toPx } from '../../../core/units';
import { DISPLAY_NAME_MAX, layerDisplayName } from '../../../core/document';
import { editor } from '../../state/editor';
import { runCommand } from '../../state/commands';
import { renderBounds } from '../../engine/draw';
import { useEditor } from '../hooks';
import { NumberField, SliderField } from '../controls/NumberField';
import { Section } from '../controls/Panel';
import { Segmented } from '../controls/Segmented';
import { MenuButton } from '../controls/Menu';
import { ColorChipButton } from '../color/Chips';
import { PaintRow } from '../color/PaintRow';
import { uiPaint, uiPaintPatch } from '../../state/uiPaint';
import { Icon } from '../Icons';
import { tip } from '../tips';
import { evalArithmetic } from '../controls/numeric';
import { TextSection } from './TextSection';
import { frameTextTarget } from '../../state/textTarget';
import { BaselineGridSection, FrameFlowSection, TableSection, WrapSection } from './LayoutSections';
import type { Unit } from '../../../core/types';

export { evalArithmetic };

/** Compact numeric field used across Properties (scrub label, arrow keys, units, arithmetic). */
export function NumField({ value, onCommit, onChange, step = 1, min, max, label, suffix, unit, lengthUnit, digits = 2, ariaLabel }: { value: number; onCommit: (v: number) => void; onChange?: (v: number) => void; step?: number; min?: number; max?: number; label: string; suffix?: string; unit?: string; lengthUnit?: Unit; digits?: number; ariaLabel?: string }) {
  return <NumberField label={label} ariaLabel={ariaLabel ?? label + (suffix ? ` (${suffix})` : '')} value={value} onCommit={onCommit} onChange={onChange} step={step} min={min} max={max} digits={digits} unit={unit} lengthUnit={lengthUnit} />;
}

function patchSel(label: string, fn: (n: SceneNode) => SceneNode, merge?: string) {
  editor.commit(label, (d) => updateNodes(d, editor.ui.selection, fn), merge);
}

/** Stroke details under the stroke paint row: width · dash · cap · join. */
function StrokeDetails({ stroke, onChange }: { stroke: Stroke; onChange: (s: Stroke) => void }) {
  const dash = stroke.dash.length ? (stroke.dash[0] === stroke.width ? 'dot' : 'dash') : 'solid';
  return (
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
  );
}

const blendLabel = (m: string) => m.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Row with a 56px label and a control that fills. */
function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="row insp-row">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function DocumentProperties() {
  const ed = useEditor();
  const d = ed.doc!;
  const s = d.settings;
  const u = ed.unit;
  const fill = uiPaint(ed.ui, 'fill');
  const stroke = uiPaint(ed.ui, 'stroke');
  const setDefault = (target: 'fill' | 'stroke') => (p: Paint) => ed.setUi(uiPaintPatch(target, p, ed.ui));
  return (
    <div className="properties">
      <div className="prop-title"><span className="prop-name">{d.title}</span><span className="prop-kind">Document</span></div>
      <Section id="doc" title="Document">
        <Field label="Title" htmlFor="doc-title"><input id="doc-title" type="text" value={d.title} onChange={(e) => ed.commit('Rename document', (x) => ({ ...x, title: e.target.value }), 'title')} /></Field>
        <Field label="Size">
          <span className="value num doc-size" data-testid="doc-size">
            {formatSize(s.width, s.height, u)}
            {u !== 'px' && <span className="value-hint">{`${pixelsAt(s.width, s.dpi)} × ${pixelsAt(s.height, s.dpi)} px at ${s.dpi} dpi`}</span>}
          </span>
        </Field>
        <Field label="Pages"><span className="value num">{d.pages.length}</span></Field>
        <Field label="Background">
          <ColorChipButton
            kind="fill"
            label="Background"
            placement="left"
            value={s.background ? { type: 'solid', color: s.background } : { type: 'none' }}
            fallback="#ffffff"
            allowGradient={false}
            transparent
            onChange={(p) => ed.commit('Background', (x) => ({ ...x, settings: { ...x.settings, background: p.type === 'solid' ? p.color : null } }), p.type === 'solid' ? 'bg' : undefined)}
          />
          <label className="check"><input type="checkbox" checked={!s.background} onChange={(e) => ed.commit('Background', (x) => ({ ...x, settings: { ...x.settings, background: e.target.checked ? null : '#ffffff' } }))} /> Transparent</label>
        </Field>
        <div className="row"><span className="row-spacer" /><button className="btn sm" onClick={() => runCommand('file.document-setup')}>Document setup…</button></div>
      </Section>
      <Section id="defaults" title="New objects">
        <Field label="Fill"><PaintRow kind="fill" label="Default fill" paint={fill} fallback={ed.ui.fillColor} onChange={setDefault('fill')} /></Field>
        <Field label="Stroke"><PaintRow kind="stroke" label="Default stroke" paint={stroke} fallback={ed.ui.strokeColor} onChange={setDefault('stroke')} /></Field>
      </Section>
      {ed.ui.studio === 'layout' && <BaselineGridSection />}
      <p className="hint pad">Select an object to edit it here. Double-click text to type, or a picture frame to place an image.</p>
    </div>
  );
}

const KIND: Record<SceneNode['type'], string> = {
  rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', path: 'Path', text: 'Text', textframe: 'Text frame',
  imageframe: 'Picture frame', raster: 'Pixel layer', table: 'Table', group: 'Group',
};
/**
 * The object's own section is named for what it edits, not for the object, so it
 * never repeats the header ("Rectangle" over "RECTANGLE", critique 3 P2-11).
 */
const SHAPE_TITLE: Partial<Record<SceneNode['type'], string>> = { rect: 'Corners', polygon: 'Sides', star: 'Points', textframe: 'Text frame', imageframe: 'Image fit', raster: 'Pixels' };

/** Align (and distribute / boolean when they apply) for the selection: the top of the inspector, as in Figma. */
function ArrangeBar({ count }: { count: number }) {
  const ed = useEditor();
  const a = (id: string, label: string, icon: string, disabled = false) => (
    <button key={id} type="button" className="icon-btn sm" {...tip(label)} disabled={disabled} onClick={() => runCommand(id)}><Icon name={icon} /></button>
  );
  return (
    <div className="arrange-bar" role="toolbar" aria-label="Align">
      {a('arrange.align-left', 'Align left', 'align-left')}
      {a('arrange.align-hcenter', 'Align centre', 'align-hcenter')}
      {a('arrange.align-right', 'Align right', 'align-right')}
      {a('arrange.align-top', 'Align top', 'align-top')}
      {a('arrange.align-vcenter', 'Align middle', 'align-vcenter')}
      {a('arrange.align-bottom', 'Align bottom', 'align-bottom')}
      <span className="arrange-sep" aria-hidden="true" />
      {a('arrange.distribute-h', 'Distribute horizontally', 'distribute-h', count < 3)}
      {a('arrange.distribute-v', 'Distribute vertically', 'distribute-v', count < 3)}
      {ed.ui.studio === 'vector' && count >= 2 && (
        <MenuButton
          label="Boolean"
          icon="bool-add"
          className="arrange-menu"
          items={[
            { id: 'add', label: 'Add', icon: 'bool-add', run: () => runCommand('layer.bool-add') },
            { id: 'subtract', label: 'Subtract', icon: 'bool-subtract', run: () => runCommand('layer.bool-subtract') },
            { id: 'intersect', label: 'Intersect', icon: 'bool-intersect', run: () => runCommand('layer.bool-intersect') },
            { id: 'exclude', label: 'Exclude', icon: 'bool-exclude', run: () => runCommand('layer.bool-exclude') },
            { id: 'divide', label: 'Divide', icon: 'bool-divide', run: () => runCommand('layer.bool-divide') },
          ]}
        />
      )}
    </div>
  );
}

/**
 * Inspector, v3 order (UX P1-2, DESIGN.md §8): object name, align bar, then
 * Appearance (fill · stroke · opacity · blend), Transform (one 4-up X Y W H row,
 * rotation and shear below), and the object's own section last.
 */
export function PropertiesPanel() {
  const ed = useEditor();
  const nodes = ed.selectedNodes();
  if (!ed.doc) return null;
  if (!nodes.length) return <DocumentProperties />;
  const n = nodes[0];
  const name = layerDisplayName(n, ed.doc, DISPLAY_NAME_MAX);
  const multi = nodes.length > 1;
  const u = ed.unit;
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
  const lenDigits = UNIT_DIGITS[u];
  const lenStep = UNIT_STEP[u];
  const mixedOpacity = nodes.some((m) => m.opacity !== n.opacity);
  const mixedBlend = nodes.some((m) => m.blend !== n.blend);
  const story = n.type === 'textframe' ? ed.doc.stories[n.storyId] : null;
  const strokeOf = hasStroke ? (n as { stroke: Stroke }).stroke : null;
  const setStroke = (st: Stroke) => patchSel('Stroke', (m) => ('stroke' in m ? ({ ...m, stroke: st } as SceneNode) : m), 'stroke');
  return (
    <div className="properties">
      <div className="prop-title" data-tip={multi ? undefined : name}>
        <span className="prop-name">{multi ? `${nodes.length} objects` : name}</span>
        {(multi || name !== KIND[n.type]) && <span className="prop-kind">{multi ? 'Mixed' : KIND[n.type]}</span>}
      </div>
      <ArrangeBar count={nodes.length} />

      <Section id="appearance" title="Appearance">
        {hasFill && (
          <Field label="Fill">
            <PaintRow kind="fill" label="Fill" paint={(n as { fill: Paint }).fill} onChange={(p) => patchSel('Fill', (m) => ('fill' in m ? ({ ...m, fill: p } as SceneNode) : m), 'fill')} />
          </Field>
        )}
        {n.type === 'text' && (
          <Field label="Colour">
            <PaintRow kind="fill" label="Text colour" paint={n.style.fill} allowNone={false} onChange={(p) => patchSel('Text colour', (m) => (m.type === 'text' ? { ...m, style: { ...m.style, fill: p } } : m), 'tfill')} />
          </Field>
        )}
        {n.type === 'textframe' && story && (() => {
          // the selected characters while editing, otherwise all of the frame's text (state/textTarget.ts)
          const t = frameTextTarget(ed.doc!, n.storyId);
          return (
            <div data-keep-text-edit>
              <Field label="Colour">
                <PaintRow kind="fill" label="Text colour" paint={t?.style.fill ?? story.style.fill} allowNone={false} onChange={(p) => t?.apply({ fill: p })} />
              </Field>
            </div>
          );
        })()}
        {strokeOf && (
          <>
            <Field label="Stroke">
              <PaintRow kind="stroke" label="Stroke" paint={strokeOf.paint} fallback="#1b1b1f" onChange={(p) => setStroke({ ...strokeOf, paint: p, width: p.type !== 'none' && strokeOf.width === 0 ? 2 : strokeOf.width })} />
            </Field>
            {strokeOf.paint.type !== 'none' && <StrokeDetails stroke={strokeOf} onChange={setStroke} />}
          </>
        )}
        <SliderField label="Opacity" ariaLabel="Opacity" unit="%" min={0} max={100} value={mixedOpacity ? 100 : Math.round(n.opacity * 100)} onChange={(v) => patchSel('Opacity', (m) => ({ ...m, opacity: v / 100 }), 'opacity')} />
        <Field label="Blend" htmlFor="prop-blend">
          <select id="prop-blend" value={mixedBlend ? '' : n.blend} onChange={(e) => patchSel('Blend mode', (m) => ({ ...m, blend: e.target.value as BlendMode }))}>
            {mixedBlend && <option value="" disabled>Mixed</option>}
            {BLEND_MODES.map((m) => <option key={m} value={m}>{blendLabel(m)}</option>)}
          </select>
        </Field>
      </Section>

      {!multi && (n.type === 'text' || n.type === 'textframe') && <TextSection />}
      {!multi && n.type === 'textframe' && ed.ui.studio === 'layout' && <FrameFlowSection node={n} />}
      {!multi && n.type === 'table' && <TableSection node={n} />}

      {!multi && (
        <Section id="transform" title={<>Transform <span className="count">{u}</span></>}>
          <div className="grid4">
            <NumField label="X" ariaLabel={`X (${u})`} lengthUnit={u} digits={lenDigits} step={lenStep} value={conv(b.x)} onChange={(v) => moveTo(v, null, k('x'))} onCommit={(v) => moveTo(v, null, k('x'))} />
            <NumField label="Y" ariaLabel={`Y (${u})`} lengthUnit={u} digits={lenDigits} step={lenStep} value={conv(b.y)} onChange={(v) => moveTo(null, v, k('y'))} onCommit={(v) => moveTo(null, v, k('y'))} />
            <NumField label="W" ariaLabel={`Width (${u})`} lengthUnit={u} digits={lenDigits} step={lenStep} value={conv(b.w)} min={0.01} onChange={(v) => resize(v, null, k('w'))} onCommit={(v) => resize(v, null, k('w'))} />
            <NumField label="H" ariaLabel={`Height (${u})`} lengthUnit={u} digits={lenDigits} step={lenStep} value={conv(b.h)} min={0.01} onChange={(v) => resize(null, v, k('h'))} onCommit={(v) => resize(null, v, k('h'))} />
          </div>
          <div className="grid4">
            <NumField label="R" ariaLabel="Rotation (degrees)" unit="°" digits={1} value={n.rotation} step={1} onChange={(v) => patch('Rotate', { rotation: ((v % 360) + 360) % 360 }, k('r'))} onCommit={(v) => patch('Rotate', { rotation: ((v % 360) + 360) % 360 }, k('r'))} />
            <NumField label="S" ariaLabel="Shear (degrees)" unit="°" digits={1} value={n.skewX} step={1} min={-80} max={80} onChange={(v) => patch('Shear', { skewX: v }, k('s'))} onCommit={(v) => patch('Shear', { skewX: v }, k('s'))} />
            <button type="button" className="icon-btn sm" {...tip('Flip horizontal')} onClick={() => runCommand('arrange.flip-h')}><Icon name="flip-h" /></button>
            <button type="button" className="icon-btn sm" {...tip('Flip vertical')} onClick={() => runCommand('arrange.flip-v')}><Icon name="flip-v" /></button>
          </div>
        </Section>
      )}

      {!multi && SHAPE_TITLE[n.type] && (
        <Section id={`shape-${n.type}`} title={SHAPE_TITLE[n.type]}>
          {n.type === 'rect' && (
            <div className="grid2">
              <NumField label="Radius" ariaLabel={`Corner radius (${u})`} unit={u} lengthUnit={u} digits={lenDigits} step={lenStep} value={conv(n.radius)} min={0} onChange={(v) => patch('Corner radius', { radius: back(v) } as Partial<SceneNode>, k('rad'))} onCommit={(v) => patch('Corner radius', { radius: back(v) } as Partial<SceneNode>, k('rad'))} />
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
                <NumField label="Points" ariaLabel="Points" value={n.points} min={3} max={64} digits={0} onChange={(v) => patch('Points', { points: Math.round(v) } as Partial<SceneNode>, k('pts'))} onCommit={(v) => patch('Points', { points: Math.round(v) } as Partial<SceneNode>, k('pts'))} />
              </div>
              <SliderField label="Inner radius" unit="%" min={5} max={100} value={Math.round(n.innerRatio * 100)} onChange={(v) => patch('Inner radius', { innerRatio: v / 100 } as Partial<SceneNode>, 'inner')} />
            </>
          )}
          {n.type === 'textframe' && (
            <>
              <div className="grid3">
                <NumField label="Col" ariaLabel="Columns" value={n.columns} min={1} max={12} digits={0} onChange={(v) => patch('Columns', { columns: Math.round(v) } as Partial<SceneNode>, k('col'))} onCommit={(v) => patch('Columns', { columns: Math.round(v) } as Partial<SceneNode>, k('col'))} />
                <NumField label="Gap" ariaLabel={`Column gap (${u})`} lengthUnit={u} digits={lenDigits} step={lenStep} value={conv(n.columnGap)} min={0} onChange={(v) => patch('Column gap', { columnGap: back(v) } as Partial<SceneNode>, k('gap'))} onCommit={(v) => patch('Column gap', { columnGap: back(v) } as Partial<SceneNode>, k('gap'))} />
                <NumField label="Inset" ariaLabel={`Inset (${u})`} lengthUnit={u} digits={lenDigits} step={lenStep} value={conv(n.padding)} min={0} onChange={(v) => patch('Inset', { padding: back(v) } as Partial<SceneNode>, k('inset'))} onCommit={(v) => patch('Inset', { padding: back(v) } as Partial<SceneNode>, k('inset'))} />
              </div>
              <Field label="Frame fill">
                <PaintRow kind="fill" label="Frame fill" paint={n.fill} onChange={(p) => editor.commit('Frame fill', (d) => updateNode(d, n.id, { fill: p } as Partial<SceneNode>), 'ffill')} />
              </Field>
              <div className="row">
                <button className="btn sm ghost" onClick={() => runCommand('text.link')} data-tip="Select this frame and another, then link">Link frames</button>
                <button className="btn sm ghost" onClick={() => runCommand('text.unlink')} disabled={!story || story.chain.length < 2} data-tip={story && story.chain.length > 1 ? 'Unlink this frame from its story' : 'This frame is not linked'}>Unlink</button>
              </div>
            </>
          )}
          {n.type === 'imageframe' && (
            <>
              <Segmented
                ariaLabel="Fit"
                className="full"
                value={n.fit}
                onChange={(f) => editor.commit('Fit', (d) => updateNode(d, n.id, { fit: f, contentX: 0, contentY: 0, contentScale: 1 } as Partial<SceneNode>))}
                options={FIT_OPTIONS}
              />
              <SliderField label="Zoom" ariaLabel="Image zoom" unit="%" min={10} max={400} value={Math.round(n.contentScale * 100)} onChange={(v) => patch('Image zoom', { contentScale: v / 100 } as Partial<SceneNode>, 'cscale')} />
              <div className="grid2">
                <NumField label="X" ariaLabel={`Image offset X (${u})`} unit={u} lengthUnit={u} digits={lenDigits} step={lenStep} value={conv(n.contentX)} onChange={(v) => patch('Image offset', { contentX: back(v) } as Partial<SceneNode>, k('cx'))} onCommit={(v) => patch('Image offset', { contentX: back(v) } as Partial<SceneNode>, k('cx'))} />
                <NumField label="Y" ariaLabel={`Image offset Y (${u})`} unit={u} lengthUnit={u} digits={lenDigits} step={lenStep} value={conv(n.contentY)} onChange={(v) => patch('Image offset', { contentY: back(v) } as Partial<SceneNode>, k('cy'))} onCommit={(v) => patch('Image offset', { contentY: back(v) } as Partial<SceneNode>, k('cy'))} />
              </div>
              <div className="row"><button className="btn sm" onClick={() => runCommand('file.place')}><Icon name="image" /> Replace image…</button></div>
            </>
          )}
          {n.type === 'raster' && (
            <>
              <Field label="Pixels"><span className="value num">{ed.assets.get(n.assetId)?.width ?? n.w} × {ed.assets.get(n.assetId)?.height ?? n.h}</span></Field>
              <Field label="Effects"><span className="value">{n.adjustments.length ? `${n.adjustments.length} live adjustment${n.adjustments.length > 1 ? 's' : ''}` : 'None'}</span></Field>
            </>
          )}
        </Section>
      )}

      {!multi && ed.ui.studio === 'layout' && <WrapSection node={n} />}

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

export const FIT_OPTIONS: { value: 'fill' | 'fit' | 'stretch' | 'none'; label: string; title: string }[] = [
  { value: 'fill', label: 'Fill', title: 'Fill the frame (crops the image)' },
  { value: 'fit', label: 'Fit', title: 'Fit inside the frame' },
  { value: 'stretch', label: 'Stretch', title: 'Stretch to the frame' },
  { value: 'none', label: 'Original', title: 'Original size' },
];
