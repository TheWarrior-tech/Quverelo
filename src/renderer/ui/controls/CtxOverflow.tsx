import { Children, Fragment, isValidElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Icon } from '../Icons';
import { Popover } from './Panel';
import { CtxHint } from './CtxHint';

/**
 * Collapse priority for a run of context-bar groups: lower collapses into
 * "More" first; Infinity never collapses. Unwrapped groups default to 5.
 */
export function Pri(p: { n: number; children: ReactNode }) {
  return <>{p.children}</>;
}

interface Slot {
  key: string;
  priority: number;
  /** hints are dropped, never tucked into More (they are not controls) */
  hint: boolean;
  node: ReactNode;
}

const DEFAULT_PRIORITY = 5;

/** Flatten fragments and <Pri> wrappers into one keyed slot per group. */
function flatten(children: ReactNode, priority = DEFAULT_PRIORITY, prefix = ''): Slot[] {
  const out: Slot[] = [];
  Children.toArray(children).forEach((child, i) => {
    const key = `${prefix}${isValidElement(child) && child.key != null ? child.key : i}`;
    if (isValidElement(child) && child.type === Fragment) {
      out.push(...flatten((child as ReactElement<{ children?: ReactNode }>).props.children, priority, `${key}/`));
    } else if (isValidElement(child) && child.type === Pri) {
      const p = child as ReactElement<{ n: number; children?: ReactNode }>;
      out.push(...flatten(p.props.children, p.props.n, `${key}/`));
    } else {
      const hint = isValidElement(child) && child.type === CtxHint;
      out.push({ key, priority: hint ? -Infinity : priority, hint, node: child });
    }
  });
  return out;
}

const barOf = (el: HTMLElement | null) => el?.closest<HTMLElement>('.contextbar') ?? null;
/** The bar runs past its edge, or a hint is cut short (a hint is dropped rather than shown with an ellipsis). */
const overflows = (bar: HTMLElement) =>
  bar.scrollWidth - bar.clientWidth > 1 || [...bar.querySelectorAll<HTMLElement>('.ctx-hint')].some((h) => h.scrollWidth - h.clientWidth > 1);

/**
 * Priority+ row for the context bar (CRITIQUE-3 N2). Wraps the bar's groups;
 * when they don't fit the canvas column, the hint goes first, then groups
 * collapse lowest priority first (ties right to left) into a trailing "More"
 * button whose popover holds them. The bar never scrolls and never cuts a word
 * in half. Re-measured when the bar resizes or its set of groups changes.
 */
export function CtxOverflow({ children, label = 'More options' }: { children: ReactNode; label?: string }) {
  const slots = flatten(children);
  const marker = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const keysKey = slots.map((s) => s.key).join('|');

  // start from "everything visible" whenever the groups or the bar width change
  useLayoutEffect(() => setHidden((h) => (h.length ? [] : h)), [keysKey]);
  useLayoutEffect(() => {
    const bar = barOf(marker.current);
    if (!bar) return;
    let w = bar.clientWidth;
    const ro = new ResizeObserver(() => {
      if (bar.clientWidth === w) return;
      w = bar.clientWidth;
      setHidden((h) => (h.length ? [] : h));
    });
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  // collapse one group per pass until the bar fits (layout effects run before paint)
  useLayoutEffect(() => {
    const bar = barOf(marker.current);
    if (!bar || !overflows(bar)) return;
    const next = slots
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.priority !== Infinity && !hidden.includes(s.key))
      .sort((a, b) => a.s.priority - b.s.priority || b.i - a.i)[0];
    if (next) setHidden([...hidden, next.s.key]);
  });

  const shown = slots.filter((s) => !hidden.includes(s.key));
  const tucked = slots.filter((s) => hidden.includes(s.key) && !s.hint);
  const isOpen = open && tucked.length > 0 && !!moreRef.current;
  return (
    <>
      {shown.map((s) => <Fragment key={s.key}>{s.node}</Fragment>)}
      {tucked.length > 0 && (
        <div className="group ctx-more">
          <button
            ref={moreRef}
            type="button"
            className={`btn ctx-more-btn${isOpen ? ' open' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-label={label}
            data-tip={label}
            onClick={() => setOpen((o) => !o)}
          >
            More <Icon name="chevron-down" size={16} />
          </button>
        </div>
      )}
      {isOpen && (
        <Popover anchor={moreRef.current!} label={label} className="ctx-more-pop" onClose={() => setOpen(false)}>
          <div className="ctx-more-body">
            {tucked.map((s) => <Fragment key={s.key}>{s.node}</Fragment>)}
          </div>
        </Popover>
      )}
      <span ref={marker} className="ctx-overflow-marker" hidden />
    </>
  );
}
