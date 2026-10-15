import { useRef, useState } from 'react';
import { Icon } from '../Icons';
import { Popover } from './Panel';

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  /** shortcut text shown right-aligned in text-3 */
  keys?: string;
  disabled?: boolean;
  run: () => void;
}

/**
 * Small action menu (DESIGN.md §8 "Menus"): a ghost trigger with a chevron
 * opens an 8px-radius popover of 28px items. Arrow keys move, Home/End jump,
 * Enter runs, Esc closes and returns focus to the trigger.
 */
export function MenuButton({ label, icon, items, className, showLabel = false, placement = 'below' }: { label: string; icon?: string; items: MenuItem[]; className?: string; showLabel?: boolean; placement?: 'below' | 'above' }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number, d: number) => {
    const n = items.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + d * k + n * 4) % n;
      if (!items[j].disabled) return refs.current[j]?.focus();
    }
  };
  return (
    <>
      <button
        type="button"
        className={`menu-trigger${showLabel ? ' labelled' : ''}${anchor ? ' open' : ''}${className ? ' ' + className : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={label}
        title={label}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {icon && <Icon name={icon} size={16} />}
        {showLabel && <span>{label}</span>}
        <Icon name="chevron-down" size={16} />
      </button>
      {anchor && (
        <Popover anchor={anchor} label={label} onClose={() => setAnchor(null)} placement={placement} className="menu-popover" role="menu">
          {items.map((it, i) => (
            <button
              key={it.id}
              ref={(el) => (refs.current[i] = el)}
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={it.disabled}
              tabIndex={-1}
              data-autofocus={i === items.findIndex((x) => !x.disabled) ? '' : undefined}
              onClick={() => {
                setAnchor(null);
                it.run();
                anchor.focus();
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
                else if (e.key === 'Home') { e.preventDefault(); move(-1, 1); }
                else if (e.key === 'End') { e.preventDefault(); move(items.length, -1); }
              }}
            >
              {it.icon ? <Icon name={it.icon} size={16} /> : <span className="menu-icon-space" />}
              <span className="menu-label">{it.label}</span>
              {it.keys && <span className="menu-keys">{it.keys}</span>}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}
