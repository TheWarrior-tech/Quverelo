import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icons';

const collapsed = new Set<string>(readCollapsed());
function readCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem('quvrelo.collapsedSections') ?? '[]');
  } catch {
    return [];
  }
}
function writeCollapsed() {
  try {
    localStorage.setItem('quvrelo.collapsedSections', JSON.stringify([...collapsed]));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Panel section: micro-label header (a disclosure button when `id` is given),
 * optional trailing actions, hairline above every section but the first.
 * Collapse state is remembered per section id.
 */
export function Section({ id, title, actions, children, className }: { id?: string; title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(() => !id || !collapsed.has(id));
  const ref = useRef<HTMLElement>(null);
  const opened = useRef(false);
  const bodyId = id ? `section-${id}` : undefined;
  // a section the user just expanded scrolls fully into view (UX P1-11)
  useEffect(() => {
    if (open && opened.current) ref.current?.scrollIntoView?.({ block: 'nearest' });
    opened.current = false;
  }, [open]);
  const toggle = () => {
    if (!id) return;
    const next = !open;
    opened.current = next;
    setOpen(next);
    if (next) collapsed.delete(id);
    else collapsed.add(id);
    writeCollapsed();
  };
  return (
    <section ref={ref} className={`section${open ? '' : ' collapsed'}${className ? ' ' + className : ''}`} data-section={id}>
      <header className="section-head">
        {id ? (
          <button type="button" className="section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            <span className="chev" aria-hidden="true"><Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} /></span>
            <span className="section-title">{title}</span>
          </button>
        ) : (
          <h3 className="section-title">{title}</h3>
        )}
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {open && <div className="section-body" id={bodyId}>{children}</div>}
    </section>
  );
}

export { Segmented } from './Segmented';

/** Marks a scroll container with data-scroll-top / data-scroll-bottom while content is hidden past either edge. */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.toggleAttribute('data-scroll-top', el.scrollTop > 0);
      el.toggleAttribute('data-scroll-bottom', el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return ref;
}

/**
 * Anchored popover (non-modal): portals to <body> so scrolling toolbars don't clip it,
 * closes on Escape or an outside press and hands focus back to the anchor.
 */
export function Popover({ anchor, onClose, children, label, placement = 'below', className, role = 'dialog' }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; label: string; placement?: 'below' | 'above' | 'right' | 'left'; className?: string; role?: 'dialog' | 'menu' | 'listbox' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth ?? 248;
    const h = el?.offsetHeight ?? 320;
    let left = placement === 'right' ? r.right + 8 : placement === 'left' ? r.left - w - 8 : r.left;
    let top = placement === 'right' || placement === 'left' ? r.top - 8 : placement === 'above' ? r.top - h - 6 : r.bottom + 6;
    // flip when the preferred side has no room
    if (placement === 'below' && top + h > window.innerHeight - 8 && r.top - h - 6 >= 8) top = r.top - h - 6;
    if (placement === 'above' && top < 8) top = r.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [anchor, placement]);
  // focus the first control once, after the popover is placed (a hidden element can't take focus);
  // never again on re-render, or typing in a field would lose focus when the value commits
  const focused = useRef(false);
  useEffect(() => {
    if (!pos || focused.current) return;
    focused.current = true;
    const root = ref.current;
    const first = ['[data-autofocus]', '[tabindex="0"]', 'input', 'button:not(:disabled)'].map((q) => root?.querySelector<HTMLElement>(q)).find(Boolean);
    first?.focus();
  }, [pos]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      closeRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        anchor.focus();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor]);
  return createPortal(
    <div ref={ref} className={`popover${className ? ' ' + className : ''}`} role={role} aria-label={label} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}
