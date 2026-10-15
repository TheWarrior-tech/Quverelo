/**
 * Numeric input logic shared by NumberField, slider rows and the colour picker.
 * Pure and DOM-free so it can be unit tested.
 */

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

// Typed-value parsing lives with the unit helpers (one parser for every length field).
export { evalArithmetic, parseNumericInput } from '../../../core/units';

/** Fraction 0..1 of `value` within [min, max] (for slider fills). */
export function fraction(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}
