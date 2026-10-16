/**
 * Custom width-profile editor (Affinity's pressure graph): the stroke's
 * silhouette along its length, with a point for every width stop. Drag a
 * point (up/down sets the width, sideways moves it along the stroke),
 * double-click the graph to add a point, double-click a point or press Delete
 * to remove it. Points are keyboard sliders: ↑/↓ width, ←/→ position, Shift
 * for bigger steps. The selected point also has exact number fields.
 */
import { useEffect, useRef, useState } from 'react';
import type { WidthPoint } from '../../../core/types';
import { addProfilePoint, editableProfile, moveProfilePoint, profileAt, removeProfilePoint, storedProfile } from '../../../core/strokeFx';
import { NumberField } from '../controls/NumberField';

const H = 56; // graph height (px); the centre line is the stroke's spine
const HALF = H / 2 - 6;
const SAMPLES = 64;

export function ProfileEditor({ profile, onChange }: { profile: WidthPoint[] | undefined; onChange: (p: WidthPoint[] | undefined) => void }) {
  const pts = editableProfile(profile);
  const [sel, setSel] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const pointRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** a point just added takes the focus once it is rendered, so the arrow keys work on it straight away */
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    if (focusNext.current === null) return;
    pointRefs.current[focusNext.current]?.focus();
    focusNext.current = null;
  });
  const cur = sel >= 0 && sel < pts.length ? sel : -1;
  const commit = (p: WidthPoint[]) => onChange(storedProfile(p));

  const at = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { t: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), w: Math.min(1, Math.abs(e.clientY - (r.top + r.height / 2)) / HALF) };
  };

  // silhouette: top edge left→right, bottom edge back (viewBox 0..100 × 0..H, stretched)
  const top: string[] = [];
  const bottom: string[] = [];
  for (let k = 0; k <= SAMPLES; k++) {
    const t = k / SAMPLES;
    const w = profileAt(pts, t) * HALF;
    top.push(`${(t * 100).toFixed(2)},${(H / 2 - w).toFixed(2)}`);
    bottom.unshift(`${(t * 100).toFixed(2)},${(H / 2 + w).toFixed(2)}`);
  }

  const key = (i: number) => (e: React.KeyboardEvent) => {
    const p = pts[i];
    const big = e.shiftKey ? 5 : 1;
    let next: WidthPoint[] | null = null;
    if (e.key === 'ArrowUp') next = moveProfilePoint(pts, i, p.t, p.w + 0.05 * big);
    else if (e.key === 'ArrowDown') next = moveProfilePoint(pts, i, p.t, p.w - 0.05 * big);
    else if (e.key === 'ArrowRight') next = moveProfilePoint(pts, i, p.t + 0.01 * big, p.w);
    else if (e.key === 'ArrowLeft') next = moveProfilePoint(pts, i, p.t - 0.01 * big, p.w);
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      next = removeProfilePoint(pts, i);
      setSel(Math.max(0, i - 1));
    }
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    commit(next);
  };

  return (
    <div className="profile-editor">
      <div
        ref={box}
        className="profile-graph"
        style={{ height: H }}
        data-testid="profile-graph"
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.profile-point')) return;
          const r = addProfilePoint(pts, at(e).t);
          setSel(r.index);
          focusNext.current = r.index;
          commit(r.profile);
        }}
      >
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line className="profile-spine" x1="0" y1={H / 2} x2="100" y2={H / 2} vectorEffect="non-scaling-stroke" />
          <polygon className="profile-shape" points={[...top, ...bottom].join(' ')} vectorEffect="non-scaling-stroke" />
        </svg>
        {pts.map((p, i) => (
          <button
            key={i}
            ref={(el) => (pointRefs.current[i] = el)}
            type="button"
            className={`profile-point${i === cur ? ' selected' : ''}`}
            style={{ left: `${p.t * 100}%`, top: H / 2 - p.w * HALF }}
            role="slider"
            aria-label={`Width point ${i + 1} of ${pts.length}`}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(p.w * 100)}
            aria-valuetext={`${Math.round(p.w * 100)}% width, ${Math.round(p.t * 100)}% along`}
            data-tip={i === 0 || i === pts.length - 1 ? 'Drag up or down to set the width at this end' : 'Drag to move · double-click or Delete removes it'}
            onFocus={() => setSel(i)}
            onKeyDown={key(i)}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              (e.currentTarget as HTMLElement).focus();
              drag.current = i;
              setSel(i);
            }}
            onPointerMove={(e) => {
              if (drag.current !== i) return;
              const q = at(e);
              commit(moveProfilePoint(pts, i, q.t, q.w));
            }}
            onPointerUp={() => (drag.current = null)}
            onDoubleClick={() => {
              commit(removeProfilePoint(pts, i));
              setSel(-1);
            }}
          />
        ))}
      </div>
      {cur >= 0 ? (
        <div className="grid2" role="group" aria-label="Selected width point">
          <NumberField label="At" ariaLabel="Width point position" unit="%" digits={0} min={0} max={100} disabled={cur === 0 || cur === pts.length - 1} value={Math.round(pts[cur].t * 100)} onCommit={(v) => commit(moveProfilePoint(pts, cur, v / 100, pts[cur].w))} />
          <NumberField label="W" ariaLabel="Width point width" unit="%" digits={0} min={0} max={100} value={Math.round(pts[cur].w * 100)} onCommit={(v) => commit(moveProfilePoint(pts, cur, pts[cur].t, v / 100))} onChange={(v) => commit(moveProfilePoint(pts, cur, pts[cur].t, v / 100))} />
        </div>
      ) : (
        <p className="hint profile-hint">Double-click the graph to add a width point · drag points to shape the stroke</p>
      )}
    </div>
  );
}
