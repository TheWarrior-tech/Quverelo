import { useEffect, useRef } from 'react';
import { addGuide } from '../../core/commands';
import { PX_PER } from '../../core/units';
import { editor } from '../state/editor';
import type { Viewport } from '../engine/Viewport';

function niceStep(pxPerUnit: number): number {
  // choose a major tick spacing that is >= 60 screen px
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  for (const s of steps) if (s * pxPerUnit >= 60) return s;
  return steps[steps.length - 1];
}

function drawRuler(c: HTMLCanvasElement, vp: Viewport, orientation: 'h' | 'v') {
  const rect = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--panel').trim() || '#26272b';
  ctx.fillRect(0, 0, w, h);
  const text = css.getPropertyValue('--text-dim').trim() || '#aaa';
  const v = vp.vpt;
  const z = v[0];
  const unit = editor.settings.units;
  const pxPerUnit = PX_PER[unit] * z; // screen px per unit
  const major = niceStep(pxPerUnit);
  const minor = major / 5;
  const len = orientation === 'h' ? w : h;
  const offset = orientation === 'h' ? v[4] : v[5];
  const startUnit = Math.floor(-offset / pxPerUnit / major) * major;
  const endUnit = (len - offset) / pxPerUnit;
  // page extent highlight
  const doc = editor.doc;
  if (doc) {
    const a = offset;
    const b = offset + (orientation === 'h' ? doc.settings.width : doc.settings.height) * z;
    ctx.fillStyle = css.getPropertyValue('--panel-3').trim() || '#333';
    if (orientation === 'h') ctx.fillRect(a, 0, b - a, h);
    else ctx.fillRect(0, a, w, b - a);
  }
  ctx.strokeStyle = text;
  ctx.fillStyle = text;
  ctx.lineWidth = 1;
  ctx.font = '10px Inter, sans-serif';
  ctx.beginPath();
  for (let u = startUnit; u <= endUnit; u += minor) {
    const p = Math.round(offset + u * pxPerUnit) + 0.5;
    const isMajor = Math.abs(u / major - Math.round(u / major)) < 1e-6;
    const tick = isMajor ? 22 : 6;
    if (orientation === 'h') {
      ctx.moveTo(p, h);
      ctx.lineTo(p, h - tick);
    } else {
      ctx.moveTo(w, p);
      ctx.lineTo(w - tick, p);
    }
    if (isMajor) {
      const label = String(Math.round(u * 100) / 100);
      if (orientation === 'h') ctx.fillText(label, p + 3, 10);
      else {
        ctx.save();
        ctx.translate(10, p + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, -ctx.measureText(label).width - 2, 0);
        ctx.restore();
      }
    }
  }
  ctx.stroke();
}

export function Rulers({ viewport }: { viewport: Viewport }) {
  const hRef = useRef<HTMLCanvasElement>(null);
  const vRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const redraw = () => {
      if (hRef.current) drawRuler(hRef.current, viewport, 'h');
      if (vRef.current) drawRuler(vRef.current, viewport, 'v');
    };
    viewport.onViewChange = redraw;
    const ro = new ResizeObserver(redraw);
    if (hRef.current) ro.observe(hRef.current);
    if (vRef.current) ro.observe(vRef.current);
    const unsub = editor.subscribe(redraw);
    redraw();
    return () => {
      viewport.onViewChange = null;
      ro.disconnect();
      unsub();
    };
  }, [viewport]);

  const startGuide = (orientation: 'h' | 'v') => (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const hostRect = viewport.host.getBoundingClientRect();
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointerup', onUp);
      const x = ev.clientX - hostRect.left;
      const y = ev.clientY - hostRect.top;
      if (x < 0 || y < 0) return; // released back over the ruler: cancel
      const p = viewport.screenToScene(x, y);
      // horizontal ruler creates horizontal guides
      const pos = orientation === 'h' ? p.y : p.x;
      editor.commit('Add guide', (d) => addGuide(d, orientation, Math.round(pos * 100) / 100).doc);
    };
    el.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <canvas ref={hRef} className="ruler h" style={{ width: '100%', height: '100%' }} onPointerDown={startGuide('h')} title="Drag down to add a horizontal guide" aria-hidden="true" />
      <canvas ref={vRef} className="ruler v" style={{ width: '100%', height: '100%' }} onPointerDown={startGuide('v')} title="Drag right to add a vertical guide" aria-hidden="true" />
    </>
  );
}
