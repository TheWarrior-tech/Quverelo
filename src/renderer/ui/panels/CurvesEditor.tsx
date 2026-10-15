import { useEffect, useMemo, useRef, useState } from 'react';
import { CURVE_CHANNELS, curvesOf, monotoneCurve, normalizePoints, type CurveChannel, type CurvePoint, type CurvesData } from '../../../core/curves';
import { histogram } from '../../../core/pixels';
import type { Adjustment, RasterNode } from '../../../core/types';
import { editor } from '../../state/editor';
import { canvasToPixels, createCanvas, ctx2d } from '../../engine/assets';
import { Segmented } from '../controls/Segmented';
import { NumberField } from '../controls/NumberField';
import { Icon } from '../Icons';

/** Graph edge in CSS px; one CSS px per input level at full size. */
export const CURVE_SIZE = 256;
const HIT = 8; // px radius for grabbing a point
const KNOB = 8;
/** end points (black and white point) are smaller, solid knobs */
const END_KNOB = 7;
/** inset of the plot inside the graph, CSS px */
const PAD = 6;
const LABEL: Record<CurveChannel, string> = { rgb: 'RGB', r: 'R', g: 'G', b: 'B' };
const TINT: Record<CurveChannel, string> = { rgb: '', r: '#ff6b6b', g: '#5fd47c', b: '#6ba4ff' };

type Hist = { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array };
const histCache = new Map<string, Hist>();

/** Histogram of the layer's own pixels (before adjustments), cached per asset. */
function useLayerHistogram(assetId: string): Hist | null {
  return useMemo(() => {
    const hit = histCache.get(assetId);
    if (hit) return hit;
    const src = editor.assets.get(assetId);
    if (!src) return null;
    const s = Math.min(1, 256 / Math.max(src.width, src.height));
    const small = createCanvas(Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s)));
    ctx2d(small).drawImage(src, 0, 0, small.width, small.height);
    const h = histogram(canvasToPixels(small));
    if (histCache.size > 16) histCache.clear();
    histCache.set(assetId, h);
    return h;
  }, [assetId]);
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Curves editor: 256x256 graph on a 4x4 grid with the layer histogram behind,
 * draggable control points (click to add, drag off the graph or double-click
 * to remove, arrow keys nudge), a channel switch and Input/Output fields.
 */
export function CurvesEditor({ node, adj, onChange, onBegin, onEnd }: {
  node: RasterNode;
  adj: Adjustment;
  onChange: (curves: CurvesData, merge: string) => void;
  onBegin: () => void;
  onEnd: () => void;
}) {
  const data = curvesOf(adj);
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const [selected, setSelected] = useState<number | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ index: number; removed: boolean } | null>(null);
  const hist = useLayerHistogram(node.assetId);
  const points = data[channel];
  // latest point list, including commits React has not re-rendered yet (fast drags)
  const live = useRef(points);
  live.current = points;
  const sel = selected !== null && selected < points.length ? selected : null;

  const commit = (next: CurvePoint[], merge = `curves:${adj.id}:${channel}`) => {
    live.current = next;
    onChange({ ...data, [channel]: next }, merge);
  };

  // ---- drawing
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const full = c.clientWidth || CURVE_SIZE;
    if (c.width !== Math.round(full * dpr)) {
      c.width = Math.round(full * dpr);
      c.height = Math.round(full * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, full, full);
    ctx.fillStyle = cssVar('--c-canvas', '#0d0e0f');
    ctx.fillRect(0, 0, full, full);
    // plot area inset so the end-point knobs at (0,0) and (255,255) are whole
    ctx.translate(PAD, PAD);
    const size = full - 2 * PAD;
    const k = size / 255;
    const X = (v: number) => v * k;
    const Y = (v: number) => size - v * k;
    // histogram ghost: a quiet text-3 area (18 % dark, 12 % light) so the curve stays the subject
    if (hist) {
      const arr = channel === 'rgb' ? hist.l : hist[channel];
      let max = 1;
      for (let i = 0; i < 256; i++) max = Math.max(max, arr[i]);
      // soften spikes so the shape stays readable
      const norm = (v: number) => Math.sqrt(v / max);
      const light = document.documentElement.dataset.theme === 'light';
      ctx.globalAlpha = light ? 0.12 : 0.18;
      ctx.fillStyle = TINT[channel] || cssVar('--c-text-3', '#8b8d93');
      ctx.beginPath();
      ctx.moveTo(0, size);
      for (let i = 0; i < 256; i++) ctx.lineTo(X(i), size - norm(arr[i]) * size * 0.9);
      ctx.lineTo(size, size);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 4x4 hairline grid + identity diagonal
    ctx.strokeStyle = cssVar('--c-line', 'rgba(255,255,255,.08)');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const p = Math.round((size * i) / 4) + 0.5;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();
    ctx.strokeStyle = cssVar('--c-line-strong', 'rgba(255,255,255,.15)');
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);
    ctx.stroke();
    // other channels' curves, faint, so their effect stays visible
    if (channel === 'rgb') {
      for (const ch of ['r', 'g', 'b'] as const) {
        if (data[ch].length === 2 && data[ch][0].x === 0 && data[ch][0].y === 0 && data[ch][1].x === 255 && data[ch][1].y === 255) continue;
        const f = monotoneCurve(data[ch]);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = TINT[ch];
        ctx.beginPath();
        for (let x = 0; x <= 255; x++) (x ? ctx.lineTo : ctx.moveTo).call(ctx, X(x), Y(f(x)));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // the curve
    const f = monotoneCurve(points);
    ctx.strokeStyle = TINT[channel] || cssVar('--c-text', '#ececed');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= 255; x += 0.5) {
      if (x === 0) ctx.moveTo(X(x), Y(f(x)));
      else ctx.lineTo(X(x), Y(f(x)));
    }
    ctx.stroke();
    // control points: end points are small solid knobs (text fill, app-coloured ring); inner points are rings
    const accent = cssVar('--c-accent', '#3cc4b0');
    const ring = cssVar('--c-app', '#131415');
    const text = cssVar('--c-text', '#ececed');
    points.forEach((p, i) => {
      const cx = X(p.x);
      const cy = Y(p.y);
      const end = i === 0 || i === points.length - 1;
      const on = i === sel;
      ctx.beginPath();
      ctx.arc(cx, cy, (end ? END_KNOB : KNOB) / 2, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#ffffff' : end ? text : cssVar('--c-canvas', '#0d0e0f');
      ctx.fill();
      ctx.lineWidth = on ? 2 : end ? 1 : 1.5;
      ctx.strokeStyle = on ? accent : end ? ring : text;
      ctx.stroke();
    });
  });

  // ---- interaction
  const toLevel = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left - PAD) / (r.width - 2 * PAD)) * 255,
      y: (1 - (e.clientY - r.top - PAD) / (r.height - 2 * PAD)) * 255,
      out: e.clientX < r.left - 24 || e.clientX > r.right + 24 || e.clientY < r.top - 24 || e.clientY > r.bottom + 24,
    };
  };
  const nearest = (lx: number, ly: number) => {
    const r = ref.current!.getBoundingClientRect();
    const k = (r.width - 2 * PAD) / 255;
    let best = -1;
    let bd = HIT;
    points.forEach((p, i) => {
      const d = Math.hypot((p.x - lx) * k, (p.y - ly) * k);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  /** Move point i, keeping it strictly between its neighbours. */
  const moved = (list: CurvePoint[], i: number, x: number, y: number): CurvePoint[] => {
    const lo = i > 0 ? list[i - 1].x + 1 : 0;
    const hi = i < list.length - 1 ? list[i + 1].x - 1 : 255;
    const next = list.slice();
    next[i] = { x: Math.round(Math.min(hi, Math.max(lo, x))), y: Math.round(Math.min(255, Math.max(0, y))) };
    return next;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // keyboard focus for nudging, without a focus ring on a mouse click
    ref.current!.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    const l = toLevel(e);
    let i = nearest(l.x, l.y);
    let list = points;
    if (i < 0) {
      // add a point on the curve at this input level
      const x = Math.round(Math.min(254, Math.max(1, l.x)));
      if (points.some((p) => p.x === x)) return;
      const y = Math.round(monotoneCurve(points)(x));
      list = normalizePoints([...points, { x, y }]);
      i = list.findIndex((p) => p.x === x);
      commit(list);
    }
    setSelected(i);
    drag.current = { index: i, removed: false };
    ref.current!.setPointerCapture(e.pointerId);
    onBegin();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const points = live.current;
    const l = toLevel(e);
    const endpoint = d.index === 0 || d.index === points.length - 1;
    // dragging an inner point well off the graph removes it (like Photoshop)
    if (l.out && !endpoint && points.length > 2) {
      if (!d.removed) {
        d.removed = true;
        commit(points.filter((_, j) => j !== d.index));
        setSelected(null);
      }
      return;
    }
    if (d.removed) return;
    commit(moved(points, d.index, l.x, l.y));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try {
      ref.current!.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    onEnd();
  };
  const remove = (i: number) => {
    if (i <= 0 || i >= points.length - 1) return; // end points stay
    commit(points.filter((_, j) => j !== i), `curves:${adj.id}:remove`);
    setSelected(null);
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const l = toLevel(e);
    const i = nearest(l.x, l.y);
    if (i >= 0) remove(i);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (sel === null) {
      if (e.key === 'Tab') return;
      if (e.key.startsWith('Arrow') && points.length) {
        e.preventDefault();
        setSelected(0);
      }
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const p = points[sel];
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
      commit(moved(points, sel, p.x + dx, p.y + dy), `curves:${adj.id}:key`);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      remove(sel);
    } else if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      setSelected((sel + (e.key === ']' ? 1 : points.length - 1)) % points.length);
    }
  };

  // the fields edit the selected point; with none selected they show (and edit) the black point
  const shown = sel ?? 0;
  const field = (axis: 'x' | 'y', label: string) => (
    <label className="curves-field">
      <span>{label}</span>
      <NumberField
        ariaLabel={`Curve point ${label.toLowerCase()}`}
        value={Math.round(points[shown]?.[axis] ?? 0)}
        min={0}
        max={255}
        step={1}
        digits={0}
        onCommit={(v) => {
          const p = points[shown];
          if (!p) return;
          setSelected(shown);
          commit(moved(points, shown, axis === 'x' ? v : p.x, axis === 'y' ? v : p.y), `curves:${adj.id}:field`);
        }}
      />
    </label>
  );
  const identity = points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 255 && points[1].y === 255;

  return (
    <div className="curves-editor">
      <div className="curves-head">
        <Segmented
          ariaLabel="Curve channel"
          className="curves-channels"
          value={channel}
          onChange={(ch) => { setChannel(ch); setSelected(null); }}
          options={CURVE_CHANNELS.map((ch) => ({ value: ch, label: LABEL[ch] }))}
        />
        <button
          type="button"
          className="icon-btn sm curves-reset"
          aria-label={`Reset ${LABEL[channel]} curve`}
          data-tip={`Reset ${LABEL[channel]} curve`}
          disabled={identity}
          onClick={() => { commit([{ x: 0, y: 0 }, { x: 255, y: 255 }], `curves:${adj.id}:reset`); setSelected(null); }}
        >
          <Icon name="undo" />
        </button>
      </div>
      <canvas
        ref={ref}
        className="curves-graph"
        tabIndex={0}
        role="application"
        aria-label={`${LABEL[channel]} curve with ${points.length} points. Click to add a point, drag to move, arrow keys nudge, Delete removes.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      />
      <div className="curves-fields">
        {field('x', 'Input')}
        {field('y', 'Output')}
      </div>
    </div>
  );
}
