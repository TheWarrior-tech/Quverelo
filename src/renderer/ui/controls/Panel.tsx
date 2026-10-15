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
  const bodyId = id ? `section-${id}` : undefined;
  const toggle = () => {
    if (!id) return;
    const next = !open;
    setOpen(next);
    if (next) collapsed.delete(id);
    else collapsed.add(id);
    writeCollapsed();
  };
  return (
    <section className={`section${open ? '' : ' collapsed'}${className ? ' ' + className : ''}`} data-section={id}>
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

/** Segmented control (radio group) with roving focus: arrows move and select. */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, className, size = 'sm' }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; ariaLabel: string; className?: string; size?: 'sm' | 'md' }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`segmented ${size}${className ? ' ' + className : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === idx ? 0 : -1}
          data-tip={o.title}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const n = (i + d + options.length) % options.length;
            onChange(options[n].value);
            refs.current[n]?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
export function Popover({ anchor, onClose, children, label, placement = 'below' }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; label: string; placement?: 'below' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth ?? 248;
    const h = el?.offsetHeight ?? 320;
    let left = placement === 'right' ? r.right + 8 : r.left;
    let top = placement === 'right' ? r.top - 8 : r.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [anchor, placement]);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], [tabindex="0"], input, button');
    first?.focus();
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.focus();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="popover" role="dialog" aria-label={label} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}
