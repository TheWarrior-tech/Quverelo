import { useState } from 'react';
import type { Paint } from '../../core/types';
import { rgbToHsl } from '../../core/pixels';
import { parseColor } from '../engine/pixelOps';
import { Icon } from './Icons';
import { ColorPicker } from './color/ColorPicker';
import { parseCss, toCss } from './color/colorMath';
import { NumberField } from './controls/NumberField';
import { Segmented } from './controls/Panel';

export { ColorPicker };

export function colorString(hex: string, alpha: number): string {
  return toCss(parseCss(hex), alpha);
}

export function paintCss(p: Paint): string {
  switch (p.type) {
    case 'none': return 'transparent';
    case 'solid': return p.color;
    case 'linear': return `linear-gradient(${p.angle + 90}deg, ${p.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`;
    case 'radial': return `radial-gradient(circle, ${p.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`;
  }
}

const PAINT_LABELS: Record<Paint['type'], string> = { none: 'None', solid: 'Solid', linear: 'Linear', radial: 'Radial' };

/** Paint editor: none / solid / linear / radial gradient. */
export function PaintEditor({ paint, onChange, onCommit, allowNone = true, allowGradient = true, fallback = '#8f959e' }: { paint: Paint; onChange: (p: Paint) => void; onCommit?: () => void; allowNone?: boolean; allowGradient?: boolean; fallback?: string }) {
  const [stop, setStop] = useState(0);
  const firstColor = paint.type === 'solid' ? paint.color : paint.type === 'none' ? fallback : paint.stops[0]?.color ?? '#000000';
  const setType = (t: Paint['type']) => {
    if (t === paint.type) return;
    if (t === 'none') onChange({ type: 'none' });
    else if (t === 'solid') onChange({ type: 'solid', color: firstColor });
    else {
      const stops = paint.type === 'linear' || paint.type === 'radial' ? paint.stops : [{ offset: 0, color: firstColor }, { offset: 1, color: '#ffffff' }];
      onChange(t === 'linear' ? { type: 'linear', stops, angle: 0 } : { type: 'radial', stops });
    }
    onCommit?.();
  };
  // all four types always show, in the same order, so the first row never changes shape; ones this target can't take are disabled
  const allowed = (t: Paint['type']) => (allowNone || t !== 'none') && (allowGradient || t === 'none' || t === 'solid');
  const types = ['none', 'solid', 'linear', 'radial'] as const;
  const grad = paint.type === 'linear' || paint.type === 'radial' ? paint : null;
  const cur = grad ? Math.min(stop, grad.stops.length - 1) : 0;
  const setStops = (stops: { offset: number; color: string }[], commit = false) => {
    if (!grad) return;
    onChange({ ...grad, stops });
    if (commit) onCommit?.();
  };
  return (
    <div className="paint-editor">
      <Segmented ariaLabel="Paint type" className="full" value={paint.type} onChange={setType} options={types.map((t) => ({ value: t, label: PAINT_LABELS[t], disabled: !allowed(t) && t !== paint.type, title: allowed(t) ? undefined : t === 'none' ? 'This needs a colour' : 'Gradients aren’t available here' }))} />
      {paint.type === 'none' && <p className="hint">No paint. Choose Solid{allowGradient ? ' or a gradient' : ''} to add one.</p>}
      {paint.type === 'solid' && <ColorPicker value={paint.color} onChange={(c) => onChange({ type: 'solid', color: c })} onCommit={onCommit} />}
      {grad && (
        <>
          <div className="gradient-editor">
            <div className="gradient-bar" style={{ ['--grad' as string]: paintCss({ type: 'linear', angle: 0, stops: grad.stops }) }} />
            <div className="gradient-stops" role="listbox" aria-label="Gradient stops">
              {grad.stops.map((s, i) => (
                <button
                  type="button"
                  key={i}
                  role="option"
                  aria-selected={i === cur}
                  aria-label={`Stop ${i + 1} at ${Math.round(s.offset * 100)}%`}
                  className={`gradient-stop${i === cur ? ' on' : ''}`}
                  style={{ left: `${s.offset * 100}%`, ['--sw' as string]: s.color }}
                  onClick={() => setStop(i)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                    e.preventDefault();
                    const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01);
                    setStops(grad.stops.map((x, j) => (j === i ? { ...x, offset: Math.min(1, Math.max(0, Math.round((x.offset + d) * 100) / 100)) } : x)));
                  }}
                />
              ))}
            </div>
          </div>
          <div className="gradient-controls">
            <NumberField label="Pos" ariaLabel="Stop position percent" unit="%" digits={0} min={0} max={100} value={Math.round((grad.stops[cur]?.offset ?? 0) * 100)}
              onChange={(v) => setStops(grad.stops.map((s, i) => (i === cur ? { ...s, offset: v / 100 } : s)))}
              onCommit={(v) => setStops(grad.stops.map((s, i) => (i === cur ? { ...s, offset: v / 100 } : s)), true)} />
            {grad.type === 'linear' ? (
              <NumberField label="Angle" ariaLabel="Gradient angle degrees" unit="°" digits={0} min={0} max={360} value={Math.round(grad.angle)}
                onChange={(v) => onChange({ ...grad, angle: v })}
                onCommit={(v) => { onChange({ ...grad, angle: v }); onCommit?.(); }} />
            ) : <span />}
            <div className="gradient-actions">
              <button type="button" className="icon-btn sm" aria-label="Add stop" data-tip="Add stop" onClick={() => {
                const stops = [...grad.stops, { offset: 0.5, color: '#888888' }].sort((a, b) => a.offset - b.offset);
                setStop(stops.findIndex((s) => s.offset === 0.5 && s.color === '#888888'));
                setStops(stops, true);
              }}><Icon name="plus" /></button>
              <button type="button" className="icon-btn sm" aria-label="Remove stop" data-tip="Remove stop" disabled={grad.stops.length <= 2} onClick={() => {
                const stops = grad.stops.filter((_, i) => i !== cur);
                setStop(0);
                setStops(stops, true);
              }}><Icon name="minus" /></button>
            </div>
          </div>
          {grad.stops[cur] && (
            <ColorPicker value={grad.stops[cur].color} onChange={(c) => onChange({ ...grad, stops: grad.stops.map((s, i) => (i === cur ? { ...s, color: c } : s)) })} onCommit={onCommit} />
          )}
        </>
      )}
    </div>
  );
}


export function luminanceOf(color: string): number {
  const c = parseColor(color);
  return rgbToHsl(c.r, c.g, c.b)[2];
}
