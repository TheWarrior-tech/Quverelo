import { useRef, type ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
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
 * Used for paint type, colour model, selection mode, frame fit, curves channel.
 *
 * size: 'sm' 24px track (panels, context bar) · 'md' 28px track (top bar).
 */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, className, size = 'sm' }: { value: T; options: SegmentedOption<T>[]; onChange: (v: T) => void; ariaLabel: string; className?: string; size?: 'sm' | 'md' }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  return (
    <div className={`segmented ${size}${className ? ' ' + className : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          tabIndex={i === idx ? 0 : -1}
          data-tip={o.title ?? o.ariaLabel}
          disabled={o.disabled}
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
