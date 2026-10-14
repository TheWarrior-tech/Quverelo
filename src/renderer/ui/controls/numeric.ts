/**
 * Numeric input logic shared by NumberField, slider rows and the colour picker.
 * Pure and DOM-free so it can be unit tested.
 */
import type { Unit } from '../../../core/types';
import { PX_PER } from '../../../core/units';

export interface Modifiers {
  shiftKey?: boolean;
  altKey?: boolean;
}

export const clamp = (v: number, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, v));

/** Round to `digits` decimals, killing float noise and negative zero. */
export function roundTo(v: number, digits: number): number {
  const p = 10 ** digits;
  const r = Math.round((v + Number.EPSILON * Math.sign(v)) * p) / p;
  return Object.is(r, -0) ? 0 : r;
}

/** Display string: at most `digits` decimals, trailing zeros trimmed. */
export function formatNumber(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '';
  return String(roundTo(v, digits));
}

/** Shift = ×10, Alt = ×0.1 (Figma / Affinity convention). */
export function stepMultiplier(m: Modifiers): number {
  if (m.shiftKey) return 10;
  if (m.altKey) return 0.1;
  return 1;
}

/** Decimal places implied by a step (0.25 → 2), used to keep stepped values clean. */
export function stepDigits(step: number): number {
  const s = String(step);
  if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

/** Arrow-key step from `value` in direction `dir` (+1 / -1). */
export function stepValue(value: number, dir: 1 | -1, step: number, mods: Modifiers = {}, min?: number, max?: number): number {
  const mult = stepMultiplier(mods);
  const d = step * mult;
  const digits = Math.max(stepDigits(step), stepDigits(d));
  return clamp(roundTo(value + dir * d, digits + 2), min, max);
}

/**
 * Value after dragging a scrub label `dx` CSS pixels from where the drag began.
 * One pixel moves one `step` (scaled by modifiers); `pxPerStep` slows it for coarse ranges.
 */
export function scrubValue(start: number, dx: number, step: number, mods: Modifiers = {}, min?: number, max?: number, pxPerStep = 1): number {
  const ticks = Math.trunc(dx / pxPerStep);
  const d = ticks * step * stepMultiplier(mods);
  const digits = Math.max(stepDigits(step), stepDigits(step * stepMultiplier(mods)));
  return clamp(roundTo(start + d, digits + 2), min, max);
}

/** Evaluate + - * / and parentheses safely (no eval; CSP forbids it anyway). NaN when malformed. */
export function evalArithmetic(src: string): number {
  const t = src.match(/\d*\.?\d+|[-+*/()]/g) ?? [];
  let i = 0;
  const expr = (): number => {
    let v = term();
    while (t[i] === '+' || t[i] === '-') v = t[i++] === '+' ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (t[i] === '*' || t[i] === '/') v = t[i++] === '*' ? v * factor() : v / factor();
    return v;
  };
  const factor = (): number => {
    const tok = t[i++];
    if (tok === '-') return -factor();
    if (tok === '+') return factor();
    if (tok === '(') {
      const v = expr();
      if (t[i] !== ')') return NaN;
      i++;
      return v;
    }
    return parseFloat(tok ?? 'NaN');
  };
  const v = expr();
  return i === t.length ? v : NaN;
}

const UNIT_RE = /(px|mm|cm|in|pt|")\s*$/i;

/**
 * Parse what a user typed into a numeric field.
 * - plain numbers and arithmetic ("100+20", "50*2", "(3+1)/2")
 * - display suffixes are ignored ("45°", "80 %")
 * - for length fields (`unit` given) a different unit converts: "10mm" in a px field → 37.8
 * Returns NaN when the text is not a number.
 */
export function parseNumericInput(raw: string, unit?: Unit): number {
  let s = raw.trim().replace(/,/g, '.');
  if (!s) return NaN;
  let factor = 1;
  const um = s.match(UNIT_RE);
  if (um) {
    const u = (um[1] === '"' ? 'in' : um[1].toLowerCase()) as Unit;
    if (unit) factor = PX_PER[u] / PX_PER[unit];
    s = s.slice(0, um.index).trim();
  }
  s = s.replace(/[%°\s]+$/u, '').replace(/\s+/g, '');
  if (!/^[\d.+\-*/()]+$/.test(s)) return NaN;
  const v = /^[-+]?\d*\.?\d+$/.test(s) ? parseFloat(s) : evalArithmetic(s);
  return Number.isFinite(v) ? v * factor : NaN;
}

/** Fraction 0..1 of `value` within [min, max] (for slider fills). */
export function fraction(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}
