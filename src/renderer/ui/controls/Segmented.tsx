import { useRef, type ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  /** visible content: text, or an <Icon> for icon-only segments */
  label: ReactNode;
  /** accessible name when the label is an icon (also the tooltip) */
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
}

/**
 * The one segmented control (DESIGN.md §8): a contained track with a
 * contrasting active tile. A radio group with roving focus; arrows move and select.
 * Used everywhere a choice is one-of-few: dialogs, context bar, inspector,
 * colour picker (paint type, colour model), selection mode, frame fit.
 *
 * size: 'sm' 24px track (panels, context bar) · 'md' 28px track (dialogs).
 * disabled: the whole group (e.g. a setting locked by policy). Disabled is never
 * drawn as a translucent accent; see `.segmented` in panels.css.
 */
export function Segmented<T extends string | number>({ value, options, onChange, ariaLabel, className, size = 'sm', disabled, full }: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** stretch to the container, segments share the width evenly */
  full?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const enabled = disabled ? [] : options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const cls = ['segmented', size, full ? 'full' : '', disabled ? 'is-disabled' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          tabIndex={i === idx ? 0 : -1}
          data-tip={o.title ?? o.ariaLabel}
          disabled={disabled || o.disabled}
          className={`${o.value === value ? 'on' : ''}${o.ariaLabel ? ' icon-seg' : ''}`.trim() || undefined}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!d || !enabled.length) return;
            e.preventDefault();
            const at = enabled.indexOf(i);
            const n = enabled[(at + d + enabled.length) % enabled.length];
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
