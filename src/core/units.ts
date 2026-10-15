import type { Unit } from './types';

/** Document pixels per unit (documents use 96 px/in internally, like CSS). */
export const PX_PER: Record<Unit, number> = {
  px: 1,
  in: 96,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  pt: 96 / 72,
};

export function toPx(value: number, unit: Unit): number {
  return value * PX_PER[unit];
}

export function fromPx(px: number, unit: Unit): number {
  return px / PX_PER[unit];
}

/**
 * Decimal places a length shows in each unit, everywhere (inspector, status bar,
 * context bar, rulers' readouts, dialogs, export). One table so the same length
 * never reads 1122.52 in one place and 1122.5 in another (CRITIQUE-3 P2-14).
 */
export const UNIT_DIGITS: Record<Unit, number> = { px: 1, pt: 1, mm: 1, cm: 2, in: 3 };

/** Keyboard/scrub step for a length field in `unit`. */
export const UNIT_STEP: Record<Unit, number> = { px: 1, pt: 1, mm: 1, cm: 0.1, in: 0.125 };

export const UNIT_NAMES: Record<Unit, string> = { px: 'Pixels', mm: 'Millimetres', cm: 'Centimetres', in: 'Inches', pt: 'Points' };

export const UNITS: Unit[] = ['px', 'mm', 'cm', 'in', 'pt'];

/** Round a value already in `unit` to that unit's display precision (no float noise, no -0). */
export function roundForUnit(v: number, unit: Unit, digits = UNIT_DIGITS[unit]): number {
  const p = 10 ** digits;
  const r = Math.round((v + Number.EPSILON * Math.sign(v)) * p) / p;
  return Object.is(r, -0) ? 0 : r;
}

/** A document-px length as a number in `unit`, rounded for display: 793.7007 px → 210 (mm). */
export function lengthIn(px: number, unit: Unit, digits?: number): number {
  return roundForUnit(fromPx(px, unit), unit, digits);
}

/**
 * The one length formatter: document px → "210 mm" (or "210" with `suffix: false`).
 * Trailing zeros are trimmed; precision comes from UNIT_DIGITS.
 */
export function formatLength(px: number, unit: Unit, opts: { digits?: number; suffix?: boolean } = {}): string {
  if (!Number.isFinite(px)) return '';
  const v = String(lengthIn(px, unit, opts.digits));
  return opts.suffix === false ? v : `${v} ${unit}`;
}

/** "210 × 297 mm" for a width/height pair in document px. */
export function formatSize(wPx: number, hPx: number, unit: Unit, digits?: number): string {
  return `${formatLength(wPx, unit, { digits, suffix: false })} × ${formatLength(hPx, unit, { digits, suffix: false })} ${unit}`;
}

/** Output pixels for a document-px length at `dpi` (documents are 96 px/in internally). */
export function pixelsAt(px: number, dpi: number): number {
  return Math.round((px / 96) * dpi);
}

/**
 * Document px per physical inch. Print units are 96 px/in (CSS); a px document
 * (a photo, a screen graphic) has no physical size of its own, so its Output
 * DPI decides it: a 1264 × 848 px photo at 300 dpi is a 107 × 71.8 mm PDF page
 * (CRITIQUE-4 P2-17).
 */
export function docPxPerInch(s: { unit: Unit; dpi: number }): number {
  return s.unit === 'px' && s.dpi > 0 ? s.dpi : 96;
}

/** PDF points per document px (72 pt = 1 in). */
export function pdfPtPerPx(s: { unit: Unit; dpi: number }): number {
  return 72 / docPxPerInch(s);
}

/** A document-px length as 96-px/in "physical px", ready for formatLength in mm/in/pt. */
export function physicalPx(px: number, s: { unit: Unit; dpi: number }): number {
  return (px * 96) / docPxPerInch(s);
}

/** @deprecated use formatLength; kept for callers that pass explicit digits. */
export function formatUnit(px: number, unit: Unit, digits?: number): string {
  return formatLength(px, unit, { digits });
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

/**
 * Parse what a user typed into a length field whose value is in `unit`, returning
 * document px: "210mm", "8.5 in", "12" (taken as `unit`), "100+20", "1\"". NaN when invalid.
 * The inverse of formatLength: parseLength(formatLength(px, u), u) ≈ px.
 */
export function parseLength(input: string, unit: Unit): number {
  const v = parseNumericInput(String(input), unit);
  return Number.isFinite(v) ? toPx(v, unit) : NaN;
}

export const PAPER_SIZES: Record<string, { w: number; h: number; unit: Unit }> = {
  A3: { w: 297, h: 420, unit: 'mm' },
  A4: { w: 210, h: 297, unit: 'mm' },
  A5: { w: 148, h: 210, unit: 'mm' },
  Letter: { w: 8.5, h: 11, unit: 'in' },
  Legal: { w: 8.5, h: 14, unit: 'in' },
  Tabloid: { w: 11, h: 17, unit: 'in' },
};
