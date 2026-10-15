import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Unit } from '../../../core/types';
import { clamp, formatNumber, fraction, parseNumericInput, scrubValue, stepValue } from './numeric';

export interface NumberFieldProps {
  value: number;
  /** final value: Enter, blur, arrow keys, end of a scrub */
  onCommit: (v: number) => void;
  /** live value while scrubbing; when omitted the field only commits at the end */
  onChange?: (v: number) => void;
  /** accessible name (also the tooltip) */
  ariaLabel: string;
  /** visible scrub handle: a letter ("W") or an icon. Drag it horizontally to change the value. */
  label?: ReactNode;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  /** suffix drawn inside the field ("px", "%", "°") */
  unit?: string;
  /** length unit of the value; lets "10mm" convert when typed into a px field */
  lengthUnit?: Unit;
  /** pixels of drag per step (slows coarse fields) */
  pxPerStep?: number;
  /** several objects with different values selected */
  mixed?: boolean;
  /** nothing to show yet (no point picked): an empty field with an en dash placeholder; this text is read to AT */
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  /**
   * Draw the unit directly after the digits ("2×", left-aligned) instead of at
   * the field's right edge, where a suffix reads as a clear button (critique 3 N5).
   */
  unitInline?: boolean;
  /** Control drawn inside the field's right edge (a preset chevron). */
  trailing?: ReactNode;
}

/**
 * Figma-style numeric field: drag the label to scrub (Shift ×10, Alt ×0.1),
 * arrow keys step (same modifiers), type numbers, units or arithmetic, Esc reverts.
 * The input is the accessible spinbutton; the scrub label is decorative for AT.
 */
export function NumberField(p: NumberFieldProps) {
  const { value, onCommit, onChange, ariaLabel, label, min, max, step = 1, digits = 2, unit, lengthUnit, pxPerStep = 1, disabled, className, title, unitInline, trailing, emptyText } = p;
  const mixed = p.mixed || emptyText !== undefined;
  const fmt = (v: number) => (mixed ? '' : formatNumber(v, digits));
  const [text, setText] = useState(fmt(value));
  const [scrubbing, setScrubbing] = useState(false);
  const editing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing.current) setText(fmt(value));
  }, [value, mixed, digits]);

  const current = () => {
    const v = parseNumericInput(text, lengthUnit);
    return Number.isFinite(v) ? v : value;
  };
  const commit = (raw: string) => {
    const v = parseNumericInput(raw, lengthUnit);
    if (Number.isFinite(v)) {
      const c = clamp(v, min, max);
      setText(formatNumber(c, digits));
      if (c !== value || mixed) onCommit(c);
    } else setText(fmt(value));
  };

  const startScrub = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = mixed ? 0 : value;
    let dx = 0;
    let moved = false;
    let last = start;
    const move = (ev: PointerEvent) => {
      dx += ev.movementX;
      if (!moved) {
        if (Math.abs(dx) < 2) return;
        moved = true;
        setScrubbing(true);
        p.onScrubStart?.();
        // hide the cursor and allow endless drags; harmless if the platform refuses
        try {
          const r = el.requestPointerLock?.() as unknown as Promise<void> | undefined;
          r?.catch?.(() => undefined);
        } catch {
          /* ignore */
        }
      }
      const v = scrubValue(start, dx, step, ev, min, max, pxPerStep);
      if (v === last) return;
      last = v;
      setText(formatNumber(v, digits));
      onChange?.(v);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      if (document.pointerLockElement) document.exitPointerLock();
      setScrubbing(false);
      if (moved) {
        if (last !== start) onCommit(last);
        p.onScrubEnd?.();
      } else {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };

  const numericNow = mixed ? undefined : value;
  return (
    <div
      className={`nf${scrubbing ? ' scrubbing' : ''}${disabled ? ' disabled' : ''}${label === undefined ? ' no-label' : ''}${unitInline ? ' unit-inline' : ''}${trailing ? ' has-trailing' : ''}${className ? ' ' + className : ''}`}
      data-tip={title ?? ariaLabel}
      onPointerDown={unitInline ? (e) => {
        // the inline input is only as wide as its digits: a press on the empty rest of the field still edits it
        if (disabled || e.button !== 0) return;
        const t = e.target as HTMLElement;
        if (t === e.currentTarget || t.classList.contains('nf-unit') || t.classList.contains('nf-fill')) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      } : undefined}
    >
      {label !== undefined && (
        <span className="nf-label" aria-hidden="true" onPointerDown={startScrub}>
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        spellCheck={false}
        autoComplete="off"
        aria-label={ariaLabel}
        aria-valuenow={numericNow}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={emptyText ?? (mixed ? 'Mixed' : `${formatNumber(value, digits)}${unit ? ' ' + unit : ''}`)}
        placeholder={emptyText !== undefined ? '–' : mixed ? 'Mixed' : undefined}
        disabled={disabled}
        value={text}
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          editing.current = false;
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.select();
          } else if (e.key === 'Escape') {
            setText(fmt(value));
            editing.current = false;
            e.currentTarget.blur();
            e.stopPropagation();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = stepValue(current(), e.key === 'ArrowUp' ? 1 : -1, step, e, min, max);
            setText(formatNumber(v, digits));
            onCommit(v);
          } else if ((e.key === 'Home' || e.key === 'End') && e.altKey) {
            const v = e.key === 'Home' ? min : max;
            if (v !== undefined && Number.isFinite(v)) {
              e.preventDefault();
              setText(formatNumber(v, digits));
              onCommit(v);
            }
          }
        }}
      />
      {unit && <span className="nf-unit" aria-hidden="true">{unit}</span>}
      {unitInline && <span className="nf-fill" aria-hidden="true" />}
      {trailing}
    </div>
  );
}

export interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  digits?: number;
  unit?: string;
  /** live value while dragging the track, scrubbing or typing */
  onChange: (v: number) => void;
  /** end of a gesture (pointer up, key up, Enter); defaults to onChange */
  onCommit?: (v: number) => void;
  ariaLabel?: string;
  onInteractStart?: () => void;
  onInteractEnd?: () => void;
  /** draw the fill from this value (e.g. 0 on a -100..100 range) */
  origin?: number;
  compact?: boolean;
  /** the row already names the value (a Preferences or dialog row): track · field only, `label` stays the accessible name */
  hideLabel?: boolean;
  disabled?: boolean;
  /** extra class on the row */
  className?: string;
}

/** Label (scrubbable) · track · value field. Used in panels and the context bar. */
export function SliderField(p: SliderFieldProps) {
  const { label, value, min, max, step = 1, digits = 0, unit, onChange, ariaLabel = label, origin = min } = p;
  const commit = p.onCommit ?? onChange;
  const a = fraction(Math.min(value, origin), min, max);
  const b = fraction(Math.max(value, origin), min, max);
  const range = max - min;
  const startScrub = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = value;
    let dx = 0;
    let last = start;
    let moved = false;
    const pxPerStep = Math.max(1, Math.min(4, 160 / Math.max(1, range / step)));
    const move = (ev: PointerEvent) => {
      dx += ev.movementX;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) p.onInteractStart?.();
      moved = true;
      const v = scrubValue(start, dx, step, ev, min, max, pxPerStep);
      if (v !== last) onChange((last = v));
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (moved) {
        commit(last);
        p.onInteractEnd?.();
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  return (
    <div className={`slider-row${p.compact ? ' compact' : ''}${p.hideLabel ? ' no-label' : ''}${p.disabled ? ' disabled' : ''}${p.className ? ' ' + p.className : ''}`}>
      {!p.hideLabel && (
        <label className="sf-label" onPointerDown={p.disabled ? undefined : startScrub} data-tip="Drag to adjust">
          {label}
        </label>
      )}
      <input
        type="range"
        disabled={p.disabled}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        aria-valuetext={`${formatNumber(value, digits)}${unit ?? ''}`}
        style={{ ['--a' as string]: `${a * 100}%`, ['--b' as string]: `${b * 100}%` }}
        onPointerDown={p.onInteractStart}
        onPointerUp={(e) => {
          commit(parseFloat((e.target as HTMLInputElement).value));
          p.onInteractEnd?.();
        }}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) {
            commit(parseFloat((e.target as HTMLInputElement).value));
            p.onInteractEnd?.();
          }
        }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <NumberField value={value} min={min} max={max} step={step} digits={digits} unit={unit} ariaLabel={`${ariaLabel} value`} onCommit={commit} disabled={p.disabled} />
    </div>
  );
}
