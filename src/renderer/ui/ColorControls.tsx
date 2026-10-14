import { useEffect, useRef, useState } from 'react';
import type { Paint } from '../../core/types';
import { rgbToHsl } from '../../core/pixels';
import { parseColor, toHex } from '../engine/pixelOps';
import { Icon } from './Icons';

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export function colorString(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const c = parseColor(hex);
  return `rgba(${c.r},${c.g},${c.b},${Math.round(alpha * 100) / 100})`;
}

/** HSV colour picker with hex and opacity fields. */
export function ColorPicker({ value, onChange, onCommit }: { value: string; onChange: (c: string) => void; onCommit?: () => void }) {
  const c = parseColor(value);
  const [hsv, setHsv] = useState(() => rgbToHsv(c.r, c.g, c.b));
  const [hexText, setHexText] = useState(toHex(c.r, c.g, c.b));
  const lastValue = useRef(value);
  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    const p = parseColor(value);
    const next = rgbToHsv(p.r, p.g, p.b);
    if (next[2] > 0 && next[1] > 0) setHsv(next);
    else setHsv([hsv[0], next[1], next[2]]);
    setHexText(toHex(p.r, p.g, p.b));
  }, [value]);
  const emit = (h: number, s: number, v: number, a = c.a) => {
    setHsv([h, s, v]);
    const [r, g, b] = hsvToRgb(h, s, v);
    const hex = toHex(r, g, b);
    setHexText(hex);
    const out = colorString(hex, a);
    lastValue.current = out;
    onChange(out);
  };
  const drag = (el: HTMLElement, fn: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const move = (ev: PointerEvent | React.PointerEvent) => fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    move(e);
    const mv = (ev: PointerEvent) => move(ev);
    const up = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      onCommit?.();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  };
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const [hr, hg, hb] = hsvToRgb(hsv[0], 1, 1);
  return (
    <div className="color-picker">
      <div
        ref={svRef}
        className="sv-box"
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={hexText}
        tabIndex={0}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, rgb(${hr},${hg},${hb}))` }}
        onPointerDown={(e) => drag(svRef.current!, (x, y) => emit(hsv[0], x, 1 - y))(e)}
        onKeyDown={(e) => {
          const step = 0.02;
          if (e.key === 'ArrowRight') emit(hsv[0], Math.min(1, hsv[1] + step), hsv[2]);
          else if (e.key === 'ArrowLeft') emit(hsv[0], Math.max(0, hsv[1] - step), hsv[2]);
          else if (e.key === 'ArrowUp') emit(hsv[0], hsv[1], Math.min(1, hsv[2] + step));
          else if (e.key === 'ArrowDown') emit(hsv[0], hsv[1], Math.max(0, hsv[2] - step));
          else return;
          e.preventDefault();
        }}
      >
        <div className="knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} />
      </div>
      <div
        ref={hueRef}
        className="hue-bar"
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv[0])}
        tabIndex={0}
        onPointerDown={(e) => drag(hueRef.current!, (x) => emit(x * 359.9, hsv[1], hsv[2]))(e)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') emit((hsv[0] + 3) % 360, hsv[1], hsv[2]);
          else if (e.key === 'ArrowLeft') emit((hsv[0] + 357) % 360, hsv[1], hsv[2]);
          else return;
          e.preventDefault();
        }}
      >
        <div className="knob" style={{ left: `${(hsv[0] / 360) * 100}%` }} />
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        <input type="color" value={toHex(c.r, c.g, c.b)} onChange={(e) => { onChange(colorString(e.target.value, c.a)); onCommit?.(); }} aria-label="System colour picker" />
        <input
          type="text"
          value={hexText}
          aria-label="Hex colour"
          style={{ width: 80, flex: 'none' }}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={() => {
            if (/^#?[0-9a-f]{6}$/i.test(hexText)) {
              const hex = hexText.startsWith('#') ? hexText : '#' + hexText;
              onChange(colorString(hex, c.a));
              onCommit?.();
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <label style={{ fontSize: 12 }}>Opacity</label>
        <input type="number" min={0} max={100} value={Math.round(c.a * 100)} style={{ width: 54, flex: 'none' }} aria-label="Colour opacity percent" onChange={(e) => {
          const a = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) / 100;
          onChange(colorString(toHex(c.r, c.g, c.b), a));
        }} onBlur={() => onCommit?.()} />
      </div>
    </div>
  );
}

export function paintCss(p: Paint): string {
  switch (p.type) {
    case 'none': return 'transparent';
    case 'solid': return p.color;
    case 'linear': return `linear-gradient(${p.angle + 90}deg, ${p.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`;
    case 'radial': return `radial-gradient(circle, ${p.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`;
  }
}

/** Paint editor: none / solid / linear / radial gradient. */
export function PaintEditor({ paint, onChange, onCommit, allowNone = true }: { paint: Paint; onChange: (p: Paint) => void; onCommit?: () => void; allowNone?: boolean }) {
  const [stop, setStop] = useState(0);
  const firstColor = paint.type === 'solid' ? paint.color : paint.type === 'none' ? '#3a86ff' : paint.stops[0]?.color ?? '#000000';
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
  return (
    <div>
      <div className="paint-tabs" role="radiogroup" aria-label="Paint type">
        {(['none', 'solid', 'linear', 'radial'] as const).filter((t) => allowNone || t !== 'none').map((t) => (
          <button key={t} className={`btn ${paint.type === t ? 'selected' : ''}`} style={paint.type === t ? { borderColor: 'var(--accent)' } : undefined} role="radio" aria-checked={paint.type === t} onClick={() => setType(t)}>
            {t === 'none' ? 'None' : t === 'solid' ? 'Solid' : t === 'linear' ? 'Linear' : 'Radial'}
          </button>
        ))}
      </div>
      {paint.type === 'solid' && <ColorPicker value={paint.color} onChange={(c) => onChange({ type: 'solid', color: c })} onCommit={onCommit} />}
      {(paint.type === 'linear' || paint.type === 'radial') && (
        <>
          <div className="gradient-bar" style={{ background: paintCss(paint.type === 'linear' ? { ...paint, angle: 0 } : { type: 'linear', angle: 0, stops: paint.stops }) }} />
          <div className="row">
            <label>Stop</label>
            <select value={stop} onChange={(e) => setStop(parseInt(e.target.value, 10))} aria-label="Gradient stop">
              {paint.stops.map((s, i) => <option key={i} value={i}>{i + 1} ({Math.round(s.offset * 100)}%)</option>)}
            </select>
            <button className="btn" onClick={() => {
              const stops = [...paint.stops, { offset: 0.5, color: '#888888' }].sort((a, b) => a.offset - b.offset);
              onChange({ ...paint, stops });
              onCommit?.();
            }} aria-label="Add stop"><Icon name="plus" /></button>
            <button className="btn" disabled={paint.stops.length <= 2} onClick={() => {
              const stops = paint.stops.filter((_, i) => i !== stop);
              setStop(0);
              onChange({ ...paint, stops });
              onCommit?.();
            }} aria-label="Remove stop"><Icon name="minus" /></button>
          </div>
          <div className="row">
            <label>Position</label>
            <input type="range" min={0} max={100} value={(paint.stops[stop]?.offset ?? 0) * 100} onChange={(e) => {
              const stops = paint.stops.map((s, i) => (i === stop ? { ...s, offset: parseFloat(e.target.value) / 100 } : s));
              onChange({ ...paint, stops });
            }} onPointerUp={onCommit} aria-label="Stop position" />
          </div>
          {paint.type === 'linear' && (
            <div className="row">
              <label>Angle</label>
              <input type="range" min={0} max={360} value={paint.angle} onChange={(e) => onChange({ ...paint, angle: parseFloat(e.target.value) })} onPointerUp={onCommit} aria-label="Gradient angle" />
              <span style={{ width: 34 }}>{Math.round(paint.angle)}°</span>
            </div>
          )}
          {paint.stops[stop] && (
            <ColorPicker value={paint.stops[stop].color} onChange={(c) => onChange({ ...paint, stops: paint.stops.map((s, i) => (i === stop ? { ...s, color: c } : s)) })} onCommit={onCommit} />
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
