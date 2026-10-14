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

export function formatUnit(px: number, unit: Unit, digits?: number): string {
  const v = fromPx(px, unit);
  const d = digits ?? (unit === 'px' || unit === 'pt' ? 0 : unit === 'in' ? 2 : 1);
  return `${Number(v.toFixed(d))} ${unit}`;
}

/** Parse "210mm", "8.5 in", "12" (assumes defaultUnit) into document px. Returns NaN when invalid. */
export function parseLength(input: string, defaultUnit: Unit): number {
  const m = String(input).trim().match(/^(-?\d*\.?\d+)\s*(px|mm|cm|in|pt|")?$/i);
  if (!m) return NaN;
  const raw = m[2]?.toLowerCase();
  const unit = (raw === '"' ? 'in' : raw) as Unit | undefined;
  return toPx(parseFloat(m[1]), unit ?? defaultUnit);
}

export const PAPER_SIZES: Record<string, { w: number; h: number; unit: Unit }> = {
  A3: { w: 297, h: 420, unit: 'mm' },
  A4: { w: 210, h: 297, unit: 'mm' },
  A5: { w: 148, h: 210, unit: 'mm' },
  Letter: { w: 8.5, h: 11, unit: 'in' },
  Legal: { w: 8.5, h: 14, unit: 'in' },
  Tabloid: { w: 11, h: 17, unit: 'in' },
};
