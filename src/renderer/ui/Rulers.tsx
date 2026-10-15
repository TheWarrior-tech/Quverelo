import { useEffect, useRef } from 'react';
import { addGuide } from '../../core/commands';
import { PX_PER } from '../../core/units';
import { editor } from '../state/editor';
import type { Viewport } from '../engine/Viewport';
import { hairline } from '../engine/hairline';

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
  // ticks and band edges on whole device pixels: a 1px tick at 150 % would be 1.5 device px (blurred)
  const hl = hairline(dpr);
  const css = getComputedStyle(document.documentElement);
  const tok = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  ctx.fillStyle = tok('--c-app', '#131415');
  ctx.fillRect(0, 0, w, h);
  const text = tok('--c-text-3', '#8b8d93');
  const v = vp.vpt;
  const z = v[0];
  const unit = editor.unit;
  const pxPerUnit = PX_PER[unit] * z; // screen px per unit
  const major = niceStep(pxPerUnit);
  const minor = major / 5;
  const len = orientation === 'h' ? w : h;
  const offset = orientation === 'h' ? v[4] : v[5];
  const startUnit = Math.floor(-offset / pxPerUnit / major) * major;
  const endUnit = (len - offset) / pxPerUnit;
  const doc = editor.doc;
  const span = (a: number, b: number) => {
    const [p, q] = [hl.edge(a), hl.edge(b)];
    return orientation === 'h' ? ctx.fillRect(p, 0, q - p, h) : ctx.fillRect(0, p, w, q - p);
  };
  if (doc) {
    const s = doc.settings;
    const extent = orientation === 'h' ? s.width : s.height;
    // page extent: one tone step up from the ruler
    ctx.fillStyle = tok('--c-raised', '#1e1f21');
    span(offset, offset + extent * z);
    if (editor.ui.studio === 'layout') {
      // Layout: margins as coral bands at the ruler's inner edge, bleed as a faint band outside the page
      const m = s.margins;
      const [m0, m1] = orientation === 'h' ? [m.left, m.right] : [m.top, m.bottom];
      const bw = hl.size(3);
      const band = (a: number, b: number, color: string) => {
        const [p, q] = [hl.edge(a), hl.edge(b)];
        ctx.fillStyle = color;
        if (orientation === 'h') ctx.fillRect(p, h - bw, q - p, bw);
        else ctx.fillRect(w - bw, p, bw, q - p);
      };
      if (s.bleed > 0) {
        band(offset - s.bleed * z, offset, 'rgba(230,57,70,0.55)');
        band(offset + extent * z, offset + (extent + s.bleed) * z, 'rgba(230,57,70,0.55)');
      }
      if (m0 > 0) band(offset, offset + m0 * z, 'rgba(255,107,74,0.6)');
      if (m1 > 0) band(offset + (extent - m1) * z, offset + extent * z, 'rgba(255,107,74,0.6)');
    }
  }
  ctx.strokeStyle = text;
  ctx.fillStyle = text;
  ctx.lineWidth = hl.width;
  ctx.font = '500 9px Inter, sans-serif';
  (ctx as CanvasRenderingContext2D & { fontVariantNumeric?: string }).fontVariantNumeric = 'tabular-nums';
  ctx.textBaseline = 'alphabetic';
  ctx.beginPath();
  const cross = orientation === 'h' ? h : w;
  for (let u = startUnit; u <= endUnit; u += minor) {
    const p = hl.line(offset + u * pxPerUnit);
    const isMajor = Math.abs(u / major - Math.round(u / major)) < 1e-6;
    const isHalf = !isMajor && Math.abs((u * 2) / major - Math.round((u * 2) / major)) < 1e-6;
    const tick = isMajor ? cross : hl.size(isHalf ? 7 : 4);
    if (orientation === 'h') {
      ctx.moveTo(p, h);
      ctx.lineTo(p, h - tick);
    } else {
      ctx.moveTo(w, p);
      ctx.lineTo(w - tick, p);
    }
    if (isMajor) {
      const label = String(Math.round(u * 100) / 100);
      if (orientation === 'h') {
        // inset 3px right of the tick; skip a label that would be clipped at the end
        if (p + 3 + ctx.measureText(label).width < w) ctx.fillText(label, p + 3, 9);
      } else {
        ctx.save();
        ctx.translate(9, p + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, -ctx.measureText(label).width, 0);
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
      <canvas ref={hRef} className="ruler h" onPointerDown={startGuide('h')} data-tip="Drag down to add a horizontal guide" aria-hidden="true" />
      <canvas ref={vRef} className="ruler v" onPointerDown={startGuide('v')} data-tip="Drag right to add a vertical guide" aria-hidden="true" />
    </>
  );
}
