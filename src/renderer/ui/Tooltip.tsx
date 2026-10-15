/**
 * App-wide tooltip (UX audit P1-1, DESIGN.md §8). One host, mounted once in
 * App, serves every element that carries `data-tip` (emitted by `tip()` in
 * ui/tooltip.ts) and takes over any leftover native `title` attribute so the
 * OS tooltip never shows.
 *
 * Behaviour (WCAG 2.2 SC 1.4.13 Content on Hover or Focus):
 * - shows after 400 ms on hover, and on keyboard focus (:focus-visible);
 *   moving to a neighbour within 800 ms of the last tooltip shows it at once;
 * - hoverable: the pointer can move onto the tooltip without it closing;
 * - persistent: stays until the pointer/focus leaves or it is dismissed;
 * - dismissible: Esc hides it without moving pointer or focus.
 *
 * Markup attributes on the trigger:
 *   data-tip       text (the accessible name for icon buttons)
 *   data-keys      shortcut as an Electron accelerator or literal key ("V")
 *   data-tip-hint  optional second line ("Drag to draw. Shift for a square")
 *   data-tip-side  "bottom" (default) | "top" | "right" | "left"; inherited from an ancestor
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Keys } from './dialogs/controls';
import { placeTip, type TipSide as Side } from './tooltip';

export const TIP_DELAY = 400;
export const TIP_WARM_MS = 800;
const HIDE_GRACE = 120;

interface Shown {
  el: HTMLElement;
  text: string;
  keys?: string;
  hint?: string;
  side: Side;
  source: 'hover' | 'focus';
}

const TIP_ID = 'q-tooltip';
const TRIGGER = '[data-tip], [title]';

/** The tooltip trigger for an event target, migrating a native title to data-tip. */
function triggerFor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(`#${TIP_ID}`)) return null;
  const el = target.closest(TRIGGER) as HTMLElement | null;
  if (!el || !('dataset' in el)) return null;
  const title = el.getAttribute('title');
  if (title !== null) {
    el.removeAttribute('title');
    if (title.trim()) el.dataset.tip = title;
  }
  return el.dataset.tip ? (el as HTMLElement) : null;
}

function describe(el: HTMLElement, source: Shown['source']): Shown {
  const sideEl = el.closest<HTMLElement>('[data-tip-side]');
  const side = (sideEl?.dataset.tipSide as Side | undefined) ?? 'bottom';
  return { el, text: el.dataset.tip!, keys: el.dataset.keys || undefined, hint: el.dataset.tipHint || undefined, side, source };
}

function accessibleName(el: HTMLElement): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
}

export function TooltipHost() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; side: Side } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const cur = useRef<Shown | null>(null);
  cur.current = shown;

  useEffect(() => {
    let showTimer = 0;
    let hideTimer = 0;
    let warmUntil = 0;
    let pending: HTMLElement | null = null;
    /** Dismissed (Esc / click) trigger: stays hidden until pointer and focus have left it. */
    let suppressed: HTMLElement | null = null;
    /** A hide is scheduled (pointer left; grace period for reaching the tooltip). */
    let leaving = false;

    const clearTimers = () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      pending = null;
      leaving = false;
    };
    const hide = () => {
      clearTimers();
      if (cur.current) warmUntil = performance.now() + TIP_WARM_MS;
      cur.current = null;
      setShown(null);
    };
    const show = (el: HTMLElement, source: Shown['source']) => {
      if (el === suppressed) return;
      window.clearTimeout(hideTimer);
      leaving = false;
      if (cur.current?.el === el) return;
      window.clearTimeout(showTimer);
      const now = performance.now();
      const instant = !!cur.current || now < warmUntil;
      pending = el;
      const go = () => {
        pending = null;
        if (!el.isConnected || !el.dataset.tip) return;
        const s = describe(el, source);
        cur.current = s;
        setShown(s);
      };
      if (instant) go();
      else showTimer = window.setTimeout(go, TIP_DELAY);
    };
    const scheduleHide = () => {
      window.clearTimeout(showTimer);
      pending = null;
      window.clearTimeout(hideTimer);
      leaving = true;
      hideTimer = window.setTimeout(hide, HIDE_GRACE);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const t = e.target as Element | null;
      if (t?.closest?.(`#${TIP_ID}`)) {
        window.clearTimeout(hideTimer); // hoverable: pointer moved onto the tooltip
        leaving = false;
        return;
      }
      const el = triggerFor(e.target);
      // a dismissed trigger re-arms once the pointer is elsewhere and it isn't focused
      if (suppressed && el !== suppressed && document.activeElement !== suppressed) suppressed = null;
      if (el) show(el, 'hover');
      else if (cur.current?.source === 'hover' || pending) scheduleHide();
    };
    const onOut = (e: PointerEvent) => {
      const from = e.target as Element | null;
      const to = e.relatedTarget as Element | null;
      const active = cur.current?.el ?? pending;
      if (suppressed && from && suppressed.contains(from) && !(to && suppressed.contains(to))) suppressed = null;
      if (!active) return;
      if (to && (active.contains(to) || to.closest?.(`#${TIP_ID}`))) return;
      if (from && !active.contains(from) && !from.closest?.(`#${TIP_ID}`)) return;
      if (cur.current?.source === 'focus' && document.activeElement === cur.current.el) return;
      scheduleHide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      let visible = false;
      try {
        visible = t.matches(':focus-visible');
      } catch {
        visible = false;
      }
      if (!visible) return;
      const el = triggerFor(t);
      // only the focused element itself, not a container that happens to have a title
      if (el && el === t) show(el, 'focus');
      else if (cur.current) hide();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (suppressed === e.target) suppressed = null;
      if (cur.current?.source === 'focus' && cur.current.el === e.target) hide();
      else if (pending === e.target) clearTimers();
    };
    const onDown = () => {
      const active = cur.current?.el ?? pending;
      if (active) suppressed = active;
      hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (cur.current && !leaving) {
          // dismiss without moving pointer or focus, and don't let Esc do anything else
          suppressed = cur.current.el;
          hide();
          e.preventDefault();
          e.stopPropagation();
        } else if (pending || leaving) hide();
        return;
      }
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      if (cur.current?.source === 'hover' || pending) hide();
    };
    const onScroll = (e: Event) => {
      if ((e.target as Element | null)?.closest?.(`#${TIP_ID}`)) return;
      if (cur.current || pending) hide();
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('wheel', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    // a trigger can disappear under the pointer (a re-render); drop its tooltip
    const watch = window.setInterval(() => {
      if (cur.current && !cur.current.el.isConnected) hide();
    }, 250);
    return () => {
      clearTimers();
      window.clearInterval(watch);
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('wheel', onScroll, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // position after render, once the tooltip's size is known
  useLayoutEffect(() => {
    if (!shown || !tipRef.current) {
      setPos(null);
      return;
    }
    const r = shown.el.getBoundingClientRect();
    const b = tipRef.current.getBoundingClientRect();
    setPos(placeTip(r, { w: b.width, h: b.height }, window.innerWidth, window.innerHeight, shown.side));
  }, [shown]);

  // describe the trigger by the tooltip only when it adds something to the accessible name
  useEffect(() => {
    if (!shown) return;
    const el = shown.el;
    const extra = shown.hint || shown.text !== accessibleName(el);
    if (!extra) return;
    const prev = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', prev ? `${prev} ${TIP_ID}` : TIP_ID);
    return () => {
      if (prev === null) el.removeAttribute('aria-describedby');
      else el.setAttribute('aria-describedby', prev);
    };
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div
      ref={tipRef}
      id={TIP_ID}
      role="tooltip"
      className="q-tip"
      data-side={pos?.side ?? shown.side}
      data-ready={pos ? 'true' : 'false'}
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}
    >
      <span className="q-tip-row">
        <span className="q-tip-text">{shown.text}</span>
        {shown.keys && <Keys combo={shown.keys} />}
      </span>
      {shown.hint && <span className="q-tip-hint">{shown.hint}</span>}
    </div>,
    document.body,
  );
}
