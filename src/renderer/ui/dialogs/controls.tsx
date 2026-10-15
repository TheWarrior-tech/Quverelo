/** Small building blocks shared by the dialogs (see docs/DESIGN.md §8). */
import { type ReactNode, type KeyboardEvent } from 'react';
import { Icon } from '../Icons';
import { Segmented as SharedSegmented } from '../controls/Segmented';

export interface SegOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: string;
  title?: string;
  disabled?: boolean;
}

/**
 * Dialog-sized segmented control. A thin adapter over the shared
 * `controls/Segmented` (DESIGN.md §8) so every one-of-few choice in the app is
 * the same component with the same active tile; dialogs use the 28px track.
 */
export function Segmented<T extends string | number>({ value, options, onChange, label, disabled, full }: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
  full?: boolean;
}) {
  return (
    <SharedSegmented
      size="md"
      ariaLabel={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      full={full}
      options={options.map((o) => ({
        value: o.value,
        title: o.title,
        disabled: o.disabled,
        label: o.icon ? (<>{<Icon name={o.icon} size={16} />}{o.label}</>) : o.label,
      }))}
    />
  );
}

/** Compact form row: label column on the left, control on the right. */
export function Field({ label, htmlFor, children, hint }: { label: ReactNode; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="frow">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="flabel">{label}</span>}
      <div className="fctl">
        {children}
        {hint && <div className="fhint">{hint}</div>}
      </div>
    </div>
  );
}

/** Settings row (macOS Settings / Figma preferences): title + description left, control right. */
export function PrefRow({ title, description, children, htmlFor }: { title: ReactNode; description?: ReactNode; children: ReactNode; htmlFor?: string }) {
  const Title = htmlFor ? 'label' : 'span';
  return (
    <div className="pref-row">
      <div className="pref-lbl">
        <Title className="pref-title" htmlFor={htmlFor}>{title}</Title>
        {description && <span className="pref-desc">{description}</span>}
      </div>
      <div className="pref-ctl">{children}</div>
    </div>
  );
}

export function PrefSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="pref-section">
      {title && <h3 className="micro">{title}</h3>}
      <div className="pref-rows">{children}</div>
    </section>
  );
}

export function Check({ checked, onChange, children, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean; id?: string }) {
  return (
    <label className={`check${disabled ? ' disabled' : ''}`}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children && <span>{children}</span>}
    </label>
  );
}

/** Number input with a quiet prefix (W/H) and unit suffix drawn inside the field. */
export function NumberInput({ value, onChange, unit, prefix, label, min, max, step, id }: {
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  prefix?: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
}) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const d = (step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
    onChange(clamp(Math.round((value + d) * 1000) / 1000));
  };
  return (
    <div className={`num-input${prefix ? ' has-prefix' : ''}${unit ? ' has-unit' : ''}`}>
      {prefix && <span className="pre" aria-hidden="true">{prefix}</span>}
      <input
        id={id}
        type="number"
        aria-label={label}
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step ?? 'any'}
        onKeyDown={onKey}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(clamp(v));
        }}
      />
      {unit && <span className="suf" aria-hidden="true">{unit}</span>}
    </div>
  );
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
const KEY_NAMES: Record<string, string> = isMac
  ? { CmdOrCtrl: '⌘', Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↩', Esc: 'Esc' }
  : { CmdOrCtrl: 'Ctrl', Cmd: 'Ctrl' };
const WORDS = /^(drag|scroll|click|double-click|arrows)$/i;

/**
 * Renders a shortcut as separate keycaps. Accepts Electron accelerators
 * ("CmdOrCtrl+Shift+S") and the prose form used in the cheat sheet
 * ("Shift + drag", "[ / ]", "Page Up / Down").
 */
export function Keys({ combo }: { combo: string }) {
  const parts: ReactNode[] = [];
  const isAccel = /^[^\s]+(\+[^\s]+)+$/.test(combo) || /^(CmdOrCtrl|Alt|Shift)/.test(combo);
  if (isAccel && !combo.includes(' ')) {
    combo.split('+').forEach((k, i) => parts.push(<kbd key={i}>{KEY_NAMES[k] ?? k}</kbd>));
  } else {
    const m = combo.match(/^(.*?)\s*(\(.*\))?$/);
    const main = m?.[1] ?? combo;
    main.split(/\s+\+\s+/).forEach((chunk, i) => {
      if (i) parts.push(<span key={`p${i}`} className="key-sep">+</span>);
      chunk.split(/\s+\/\s+/).forEach((k, j) => {
        if (j) parts.push(<span key={`s${i}-${j}`} className="key-sep">/</span>);
        if (WORDS.test(k)) parts.push(<span key={`w${i}-${j}`} className="key-word">{k}</span>);
        else parts.push(<kbd key={`k${i}-${j}`}>{KEY_NAMES[k] ?? k}</kbd>);
      });
    });
    if (m?.[2]) parts.push(<span key="paren" className="key-word">{m[2].slice(1, -1)}</span>);
  }
  return <span className="keys">{parts}</span>;
}

/** Format a byte count for humans (KB/MB, base 1000 like Finder/Explorer). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1000) return `${Math.round(n)} B`;
  if (n < 1e6) return `${Math.round(n / 1000)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}
