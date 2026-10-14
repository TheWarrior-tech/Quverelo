import { useEffect, useState } from 'react';
import { BLEND_MODES, type BlendMode, type Paint, type SceneNode, type Stroke } from '../../../core/types';
import { updateNode, updateNodes, releaseMask } from '../../../core/commands';
import { fromPx, toPx } from '../../../core/units';
import { editor } from '../../state/editor';
import { runCommand } from '../../state/commands';
import { renderBounds } from '../../engine/draw';
import { useEditor } from '../hooks';
import { PaintEditor } from '../ColorControls';

/** Evaluate + - * / and parentheses safely (no eval; CSP forbids it anyway). */
export function evalArithmetic(src: string): number {
  const t = src.match(/\d*\.?\d+|[-+*/()]/g) ?? [];
  let i = 0;
  const expr = (): number => {
    let v = term();
    while (t[i] === '+' || t[i] === '-') v = t[i++] === '+' ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (t[i] === '*' || t[i] === '/') v = t[i++] === '*' ? v * factor() : v / factor();
    return v;
  };
  const factor = (): number => {
    const tok = t[i++];
    if (tok === '-') return -factor();
    if (tok === '+') return factor();
    if (tok === '(') {
      const v = expr();
      i++;
      return v;
    }
    return parseFloat(tok ?? 'NaN');
  };
  const v = expr();
  return i === t.length ? v : NaN;
}

/** Numeric field that commits on Enter/blur and supports arrow-key stepping. */
export function NumField({ value, onCommit, step = 1, min, max, label, suffix, digits = 2 }: { value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; label: string; suffix?: string; digits?: number }) {
  const fmt = (v: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = (raw: string) => {
    let v = parseFloat(raw);
    // allow simple arithmetic like "100+20" or "50*2"
    if (/^[\d.+\-*/() ]+$/.test(raw) && /[+\-*/]/.test(raw.slice(1))) {
      v = evalArithmetic(raw);
    }
    if (Number.isFinite(v)) {
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      onCommit(v);
    } else setText(fmt(value));
  };
  return (
    <div className="field-inline">
      <span aria-hidden="true">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label + (suffix ? ` (${suffix})` : '')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            commit(String((parseFloat(text) || 0) + k));
          }
        }}
      />
    </div>
  );
}

function patchSel(label: string, fn: (n: SceneNode) => SceneNode, merge?: string) {
  editor.commit(label, (d) => updateNodes(d, editor.ui.selection, fn), merge);
}

function StrokeEditor({ stroke, onChange }: { stroke: Stroke; onChange: (s: Stroke) => void }) {
  return (
    <>
      <PaintEditor paint={stroke.paint} onChange={(p) => onChange({ ...stroke, paint: p, width: p.type !== 'none' && stroke.width === 0 ? 2 : stroke.width })} />
      {stroke.paint.type !== 'none' && (
        <>
          <div className="grid2" style={{ marginTop: 6 }}>
            <NumField label="W" value={stroke.width} min={0} max={500} step={0.5} onCommit={(v) => onChange({ ...stroke, width: v })} />
            <select value={stroke.dash.length ? (stroke.dash[0] === stroke.width ? 'dot' : 'dash') : 'solid'} aria-label="Dash style" onChange={(e) => {
              const v = e.target.value;
              onChange({ ...stroke, dash: v === 'solid' ? [] : v === 'dash' ? [stroke.width * 3, stroke.width * 2] : [stroke.width, stroke.width * 1.5], cap: v === 'dot' ? 'round' : stroke.cap });
            }}>
              <option value="solid">Solid</option>
              <option value="dash">Dashed</option>
              <option value="dot">Dotted</option>
            </select>
          </div>
          <div className="grid2">
            <select value={stroke.cap} aria-label="Line cap" onChange={(e) => onChange({ ...stroke, cap: e.target.value as Stroke['cap'] })}>
              <option value="butt">Butt cap</option><option value="round">Round cap</option><option value="square">Square cap</option>
            </select>
            <select value={stroke.join} aria-label="Line join" onChange={(e) => onChange({ ...stroke, join: e.target.value as Stroke['join'] })}>
              <option value="miter">Mitre join</option><option value="round">Round join</option><option value="bevel">Bevel join</option>
            </select>
          </div>
        </>
      )}
    </>
  );
}

function DocumentProperties() {
  const ed = useEditor();
  const d = ed.doc!;
  const s = d.settings;
  const u = ed.settings.units;
  return (
    <div>
      <div className="section">
        <div className="section-title">Document</div>
        <div className="row"><label>Title</label><input type="text" value={d.title} aria-label="Document title" onChange={(e) => ed.commit('Rename document', (x) => ({ ...x, title: e.target.value }), 'title')} /></div>
        <div className="row"><label>Size</label><span>{Math.round(fromPx(s.width, u) * 100) / 100} × {Math.round(fromPx(s.height, u) * 100) / 100} {u}</span></div>
        <div className="row"><label>Pages</label><span>{d.pages.length}</span></div>
        <div className="row">
          <label>Background</label>
          <input type="color" value={s.background ?? '#ffffff'} aria-label="Background colour" onChange={(e) => ed.commit('Background', (x) => ({ ...x, settings: { ...x.settings, background: e.target.value } }), 'bg')} />
          <label style={{ width: 'auto' }}><input type="checkbox" checked={!s.background} onChange={(e) => ed.commit('Background', (x) => ({ ...x, settings: { ...x.settings, background: e.target.checked ? null : '#ffffff' } }))} /> Transparent</label>
        </div>
        <button className="btn" onClick={() => runCommand('file.document-setup')}>Document Setup…</button>
      </div>
      <p className="empty-note">Select an object to see its properties.<br />Tip: double-click text to edit it, or a picture frame to place an image.</p>
    </div>
  );
}

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
  const moveTo = (x: number | null, y: number | null) =>
    editor.commit('Move', (d) => updateNode(d, n.id, (m: SceneNode) => ({ ...m, x: x === null ? m.x : m.x + (back(x) - b.x), y: y === null ? m.y : m.y + (back(y) - b.y) })));
  const resize = (w: number | null, h: number | null) =>
    editor.commit('Resize', (d) => updateNode(d, n.id, (m: SceneNode) => {
      const fw = w === null ? 1 : back(w) / Math.max(0.0001, b.w);
      const fh = h === null ? 1 : back(h) / Math.max(0.0001, b.h);
      if ('w' in m && ['rect', 'ellipse', 'polygon', 'star', 'textframe', 'imageframe'].includes(m.type)) return { ...m, w: m.w * fw, h: m.h * fh } as SceneNode;
      return { ...m, scaleX: m.scaleX * fw, scaleY: m.scaleY * fh };
    }));
  const hasFill = 'fill' in n && n.type !== 'textframe';
  const hasStroke = 'stroke' in n;
  return (
    <div>
      <div className="section">
        <div className="section-title">{multi ? `${nodes.length} objects` : n.name}</div>
        {!multi && (
          <>
            <div className="grid2">
              <NumField label="X" value={conv(b.x)} onCommit={(v) => moveTo(v, null)} suffix={u} />
              <NumField label="Y" value={conv(b.y)} onCommit={(v) => moveTo(null, v)} suffix={u} />
            </div>
            <div className="grid2">
              <NumField label="W" value={conv(b.w)} min={0.01} onCommit={(v) => resize(v, null)} suffix={u} />
              <NumField label="H" value={conv(b.h)} min={0.01} onCommit={(v) => resize(null, v)} suffix={u} />
            </div>
            <div className="grid2">
              <NumField label="R" value={n.rotation} step={1} onCommit={(v) => editor.commit('Rotate', (d) => updateNode(d, n.id, { rotation: ((v % 360) + 360) % 360 }))} suffix="degrees" />
              <NumField label="S" value={n.skewX} step={1} min={-80} max={80} onCommit={(v) => editor.commit('Shear', (d) => updateNode(d, n.id, { skewX: v }))} suffix="shear degrees" />
            </div>
          </>
        )}
        <div className="row">
          <label>Opacity</label>
          <input type="range" min={0} max={100} value={Math.round(n.opacity * 100)} aria-label="Opacity" onChange={(e) => patchSel('Opacity', (m) => ({ ...m, opacity: parseInt(e.target.value, 10) / 100 }), 'opacity')} />
          <span style={{ width: 36 }}>{Math.round(n.opacity * 100)}%</span>
        </div>
        <div className="row">
          <label>Blend</label>
          <select value={n.blend} aria-label="Blend mode" onChange={(e) => patchSel('Blend mode', (m) => ({ ...m, blend: e.target.value as BlendMode }))}>
            {BLEND_MODES.map((m) => <option key={m} value={m}>{m.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
          </select>
        </div>
      </div>

      {!multi && n.type === 'rect' && (
        <div className="section"><div className="section-title">Rectangle</div>
          <div className="row"><label>Corners</label><NumField label="r" value={n.radius} min={0} onCommit={(v) => editor.commit('Corner radius', (d) => updateNode(d, n.id, { radius: v } as Partial<SceneNode>))} /></div>
        </div>
      )}
      {!multi && n.type === 'polygon' && (
        <div className="section"><div className="section-title">Polygon</div>
          <div className="row"><label>Sides</label><NumField label="n" value={n.sides} min={3} max={64} digits={0} onCommit={(v) => editor.commit('Sides', (d) => updateNode(d, n.id, { sides: Math.round(v) } as Partial<SceneNode>))} /></div>
        </div>
      )}
      {!multi && n.type === 'star' && (
        <div className="section"><div className="section-title">Star</div>
          <div className="row"><label>Points</label><NumField label="n" value={n.points} min={3} max={64} digits={0} onCommit={(v) => editor.commit('Points', (d) => updateNode(d, n.id, { points: Math.round(v) } as Partial<SceneNode>))} /></div>
          <div className="row"><label>Inner</label><input type="range" min={5} max={100} value={Math.round(n.innerRatio * 100)} aria-label="Inner radius" onChange={(e) => editor.commit('Inner radius', (d) => updateNode(d, n.id, { innerRatio: parseInt(e.target.value, 10) / 100 } as Partial<SceneNode>), 'inner')} /></div>
        </div>
      )}
      {!multi && n.type === 'textframe' && (
        <div className="section"><div className="section-title">Text frame</div>
          <div className="grid2">
            <NumField label="Col" value={n.columns} min={1} max={12} digits={0} onCommit={(v) => editor.commit('Columns', (d) => updateNode(d, n.id, { columns: Math.round(v) } as Partial<SceneNode>))} />
            <NumField label="Gap" value={n.columnGap} min={0} onCommit={(v) => editor.commit('Column gap', (d) => updateNode(d, n.id, { columnGap: v } as Partial<SceneNode>))} />
          </div>
          <div className="row"><label>Inset</label><NumField label="p" value={n.padding} min={0} onCommit={(v) => editor.commit('Inset', (d) => updateNode(d, n.id, { padding: v } as Partial<SceneNode>))} /></div>
          <div className="row">
            <button className="btn" onClick={() => runCommand('text.link')} title="Select this frame and another, then link">Link frames</button>
            <button className="btn" onClick={() => runCommand('text.unlink')}>Unlink</button>
          </div>
          <div className="section-title" style={{ marginTop: 10 }}>Frame fill</div>
          <PaintEditor paint={n.fill} onChange={(p) => editor.commit('Frame fill', (d) => updateNode(d, n.id, { fill: p } as Partial<SceneNode>), 'ffill')} />
        </div>
      )}
      {!multi && n.type === 'imageframe' && (
        <div className="section"><div className="section-title">Picture frame</div>
          <div className="row">
            <label>Fit</label>
            <select value={n.fit} aria-label="Image fit" onChange={(e) => editor.commit('Fit', (d) => updateNode(d, n.id, { fit: e.target.value as never, contentX: 0, contentY: 0, contentScale: 1 } as Partial<SceneNode>))}>
              <option value="fill">Fill frame</option><option value="fit">Fit inside</option><option value="stretch">Stretch</option><option value="none">Original size</option>
            </select>
          </div>
          <div className="row"><label>Zoom</label><input type="range" min={10} max={400} value={Math.round(n.contentScale * 100)} aria-label="Image zoom" onChange={(e) => editor.commit('Image zoom', (d) => updateNode(d, n.id, { contentScale: parseInt(e.target.value, 10) / 100 } as Partial<SceneNode>), 'cscale')} /></div>
          <div className="grid2">
            <NumField label="X" value={n.contentX} onCommit={(v) => editor.commit('Image offset', (d) => updateNode(d, n.id, { contentX: v } as Partial<SceneNode>))} />
            <NumField label="Y" value={n.contentY} onCommit={(v) => editor.commit('Image offset', (d) => updateNode(d, n.id, { contentY: v } as Partial<SceneNode>))} />
          </div>
          <button className="btn" onClick={() => runCommand('file.place')}>Place image…</button>
        </div>
      )}
      {!multi && n.type === 'raster' && (
        <div className="section"><div className="section-title">Pixel layer</div>
          <div className="row"><label>Pixels</label><span>{ed.assets.get(n.assetId)?.width ?? n.w} × {ed.assets.get(n.assetId)?.height ?? n.h}</span></div>
          <div className="row"><label>Effects</label><span>{n.adjustments.length ? `${n.adjustments.length} live adjustment(s)` : 'none'}</span></div>
        </div>
      )}

      {hasFill && (
        <div className="section">
          <div className="section-title">Fill</div>
          <PaintEditor paint={(n as { fill: Paint }).fill} onChange={(p) => patchSel('Fill', (m) => ('fill' in m ? ({ ...m, fill: p } as SceneNode) : m), 'fill')} />
        </div>
      )}
      {n.type === 'text' && (
        <div className="section">
          <div className="section-title">Text colour</div>
          <PaintEditor paint={n.style.fill} allowNone={false} onChange={(p) => patchSel('Text colour', (m) => (m.type === 'text' ? { ...m, style: { ...m.style, fill: p } } : m), 'tfill')} />
        </div>
      )}
      {n.type === 'textframe' && ed.doc.stories[n.storyId] && (
        <div className="section">
          <div className="section-title">Text colour</div>
          <PaintEditor paint={ed.doc.stories[n.storyId].style.fill} allowNone={false} onChange={(p) => editor.commit('Text colour', (d) => ({ ...d, stories: { ...d.stories, [n.storyId]: { ...d.stories[n.storyId], style: { ...d.stories[n.storyId].style, fill: p } } } }), 'sfill')} />
        </div>
      )}
      {hasStroke && (
        <div className="section">
          <div className="section-title">Stroke</div>
          <StrokeEditor stroke={(n as { stroke: Stroke }).stroke} onChange={(s) => patchSel('Stroke', (m) => ('stroke' in m ? ({ ...m, stroke: s } as SceneNode) : m), 'stroke')} />
        </div>
      )}
      {!multi && n.mask && (
        <div className="section">
          <div className="section-title">Mask</div>
          <div className="row">
            <label style={{ width: 'auto' }}><input type="checkbox" checked={n.mask.enabled} onChange={(e) => editor.commit('Mask', (d) => updateNode(d, n.id, { mask: { ...n.mask!, enabled: e.target.checked } }))} /> Enabled</label>
            <label style={{ width: 'auto' }}><input type="checkbox" checked={n.mask.inverted} onChange={(e) => editor.commit('Mask', (d) => updateNode(d, n.id, { mask: { ...n.mask!, inverted: e.target.checked } }))} /> Inverted</label>
            <button className="btn" onClick={() => editor.commit('Release mask', (d) => releaseMask(d, n.id))}>Release</button>
          </div>
        </div>
      )}
    </div>
  );
}
