import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icons';

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  /** Display shortcut ('Ctrl+Shift+E'), shown right-aligned as text-3. */
  keys?: string;
  /** Second line in text-3 ("report.pdf"). */
  detail?: string;
  disabled?: boolean;
  run: () => void;
}

export type MenuEntry = MenuItem | '-' | { heading: string };

/**
 * Dropdown menu (DESIGN.md §8 "Menus"): --c-popover, 8px radius, 28px items
 * with 4px inner radius, shortcuts right-aligned in text-3. role="menu" with
 * roving focus: ↑/↓/Home/End move, Enter/Space run, Esc closes and returns
 * focus to the anchor, Tab closes.
 */
export function Menu({ anchor, onClose, label, items, align = 'start', minWidth = 224, side = 'below', className }: { anchor: HTMLElement; onClose: () => void; label: string; items: MenuEntry[]; align?: 'start' | 'end'; minWidth?: number; side?: 'below' | 'above'; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth ?? minWidth;
    const h = el?.offsetHeight ?? 200;
    let left = align === 'end' ? r.right - w : r.left;
    const below = r.bottom + 4;
    const above = r.top - h - 4;
    let top = side === 'above' && above >= 8 ? above : below;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (top + h > window.innerHeight - 8) top = Math.max(8, above);
    setPos({ left, top });
  }, [anchor, align, minWidth, side]);
  const buttons = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
  // focus the first item once the menu is positioned (it is hidden until then)
  useEffect(() => {
    if (pos && !ref.current?.contains(document.activeElement)) buttons()[0]?.focus();
  }, [pos]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    // Esc closes even when focus never reached the menu (pointer users)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
      anchor.focus();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => list[(n + list.length) % list.length]?.focus();
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? list.length - 1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Tab') {
      onClose();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const withIcons = items.some((it) => typeof it === 'object' && 'id' in it && !!it.icon);
  return createPortal(
    <div ref={ref} className={`menu${withIcons ? ' with-icons' : ''}${className ? ' ' + className : ''}`} role="menu" aria-label={label} onKeyDown={onKeyDown} style={{ ['--menu-min-w' as string]: `${minWidth}px`, ...(pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' as const }) }}>
      {items.map((it, k) => {
        if (it === '-') return <div key={`sep${k}`} className="menu-sep" role="separator" />;
        if ('heading' in it) return <div key={`h${k}`} className="menu-heading" role="presentation">{it.heading}</div>;
        return (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className="menu-item"
            data-menu-item={it.id}
            aria-disabled={it.disabled || undefined}
            tabIndex={-1}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.run();
            }}
          >
            {withIcons && <span className="menu-icon" aria-hidden="true">{it.icon ? <Icon name={it.icon} size={16} /> : null}</span>}
            <span className="menu-label">
              {it.label}
              {it.detail && <span className="menu-detail">{it.detail}</span>}
            </span>
            {it.keys && <span className="menu-keys">{it.keys}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Small helper so a button can own an open/closed menu anchored to itself. */
export function useMenu(): [HTMLElement | null, (el: HTMLElement | null) => void, () => void] {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return [anchor, (el) => setAnchor((cur) => (cur === el ? null : el)), () => setAnchor(null)];
}


/**
 * Ghost trigger with a chevron that owns a Menu (DESIGN.md §8 "Menus"); used
 * by the inspector and the floating selection toolbar. The popup is the one
 * Menu above, so every menu in the app looks and behaves the same.
 */
export function MenuButton({ label, icon, items, className, showLabel = false, placement = 'below' }: { label: string; icon?: string; items: MenuEntry[]; className?: string; showLabel?: boolean; placement?: 'below' | 'above' }) {
  const [anchor, toggle, close] = useMenu();
  return (
    <>
      <button
        type="button"
        className={`menu-trigger${showLabel ? ' labelled' : ''}${anchor ? ' open' : ''}${className ? ' ' + className : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={label}
        data-tip={label}
        onClick={(e) => toggle(e.currentTarget)}
      >
        {icon && <Icon name={icon} size={16} />}
        {showLabel && <span>{label}</span>}
        <Icon name="chevron-down" size={16} />
      </button>
      {anchor && <Menu anchor={anchor} label={label} items={items} side={placement} minWidth={184} onClose={close} />}
    </>
  );
}
