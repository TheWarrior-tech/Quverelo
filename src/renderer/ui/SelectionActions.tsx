import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { pathBounds } from '../../core/path';
import type { Viewport } from '../engine/Viewport';
import { runCommand } from '../state/commands';
import { useEditor } from './hooks';
import { Icon } from './Icons';
import { tip } from './tooltip';

/** Tools after which the pixel-selection action strip is offered. */
const STRIP_TOOLS = new Set(['marquee-rect', 'marquee-ellipse', 'lasso', 'object-select', 'move']);
const GAP = 8;
const EDGE = 8;

const ACTIONS: { id: string; label: string; icon: string; command: string; hint: string }[] = [
  { id: 'remove-background', label: 'Remove background', icon: 'remove-bg', command: 'select.remove-background', hint: 'Keep the selection, hide the rest with a mask' },
  { id: 'mask', label: 'Mask', icon: 'mask', command: 'layer.mask-selection', hint: 'Mask the layer to the selection' },
  { id: 'copy-to-layer', label: 'Copy to layer', icon: 'copy', command: 'select.copy-to-layer', hint: 'Copy the selected pixels to a new layer' },
  { id: 'crop', label: 'Crop', icon: 'crop', command: 'select.crop', hint: 'Crop the canvas to the selection' },
  { id: 'invert', label: 'Invert', icon: 'select-invert', command: 'select.invert', hint: 'Invert the selection' },
];

/**
 * Contextual action strip for a pixel selection in Photo (UX audit P0-2d):
 * floats 8px under the selection bounds (flips above near the bottom edge,
 * sits inside when the selection fills the view), hidden while dragging and
 * while the model runs. A toolbar: Tab reaches it, arrow keys move within it.
 */
export function SelectionActions({ viewport }: { viewport: Viewport }) {
  const ed = useEditor();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    const onView = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        bump();
      });
    };
    viewport.viewListeners.add(onView);
    const host = viewport.host;
    const down = (e: PointerEvent) => {
      if (e.button === 0) setDragging(true);
    };
    const up = () => setDragging(false);
    host.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    return () => {
      cancelAnimationFrame(raf);
      viewport.viewListeners.delete(onView);
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, [viewport]);

  const sel = ed.ui.pixelSelection;
  const visible = ed.ui.studio === 'photo' && !!sel?.length && STRIP_TOOLS.has(ed.ui.tool) && !dragging && !ed.ui.mlBusy && !ed.ui.editingTextId;

  useLayoutEffect(() => {
    if (!visible || !sel || !ref.current) {
      if (pos) setPos(null);
      return;
    }
    const b = pathBounds(sel);
    const a = viewport.sceneToScreen(b.x, b.y);
    const c = viewport.sceneToScreen(b.x + b.w, b.y + b.h);
    const host = viewport.host;
    const W = host.clientWidth;
    const H = host.clientHeight;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    let left = (a.x + c.x) / 2 - w / 2;
    left = Math.max(EDGE, Math.min(left, W - w - EDGE));
    let top = c.y + GAP;
    if (top + h > H - EDGE) top = a.y - GAP - h; // flip above
    if (top < EDGE) top = Math.min(H - h - EDGE * 2, Math.max(EDGE, c.y - h - GAP)); // selection fills the view: sit inside it
    const next = { left: host.offsetLeft + Math.round(left), top: host.offsetTop + Math.round(top) };
    if (!pos || pos.left !== next.left || pos.top !== next.top) setPos(next);
  });

  if (!visible) return null;
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
    next?.focus();
    e.preventDefault();
  };
  return (
    <div
      ref={ref}
      className="sel-actions"
      role="toolbar"
      aria-label="Selection actions"
      data-placed={pos ? '' : undefined}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onKeyDown={onKey}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {ACTIONS.map((a, i) => (
        <span key={a.id} className="sel-actions-item">
          {i === 1 && <span className="sel-actions-sep" aria-hidden="true" />}
          <button className="btn" data-sel-action={a.id} title={a.hint} onClick={() => runCommand(a.command)}>
            <Icon name={a.icon} /> {a.label}
          </button>
        </span>
      ))}
      <span className="sel-actions-sep" aria-hidden="true" />
      <button className="icon-btn sm" data-sel-action="deselect" {...tip('Deselect', 'select.none')} onClick={() => runCommand('select.none')}>
        <Icon name="close" />
      </button>
    </div>
  );
}
