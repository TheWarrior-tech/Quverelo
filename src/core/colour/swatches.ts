/**
 * CMYK and spot colour swatches. A CMYK swatch keeps its exact ink values; a
 * spot swatch is a named ink (a Pantone or house colour the printer mixes) with
 * a CMYK alternate for presses that print it in process colours. The `color`
 * string is the on-screen preview in the document's RGB space. PDF output writes
 * CMYK swatches as their CMYK numbers and spot swatches as Separation colour
 * spaces (core/pdfVector.ts).
 */
import { newId } from '../ids';
import type { Paint, QuvreloDocument, Swatch } from '../types';

export type Cmyk = [number, number, number, number];

/** "C0 M100 Y80 K0" (whole percent). */
export function formatCmyk(c: Cmyk): string {
  return `C${pct(c[0])} M${pct(c[1])} Y${pct(c[2])} K${pct(c[3])}`;
}

function pct(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 100);
}

/** Percent values (0..100) → CMYK 0..1, clamped. */
export function cmykFromPercent(v: number[]): Cmyk {
  return [0, 1, 2, 3].map((i) => Math.min(100, Math.max(0, Number.isFinite(v[i]) ? v[i] : 0)) / 100) as Cmyk;
}

/** PDF names can't be empty and the Separation name is what the printer reads: trim, collapse spaces. */
export function cleanInkName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 127);
}

export interface SwatchInput {
  name: string;
  /** on-screen preview (document RGB) */
  color: string;
  cmyk?: Cmyk;
  spot?: boolean;
}

/** Why a swatch can't be added, or null. */
export function swatchProblem(doc: QuvreloDocument, s: SwatchInput): string | null {
  const name = cleanInkName(s.name);
  if (s.spot && !s.cmyk) return 'A spot colour needs CMYK values for presses that print it in process colours.';
  if (s.spot && !name) return 'Give the spot colour the ink name your printer uses.';
  if (/^(All|None|Cyan|Magenta|Yellow|Black)$/i.test(name) && s.spot) return `“${name}” is reserved for process inks in PDF.`;
  if (name && doc.swatches.some((x) => x.name.toLowerCase() === name.toLowerCase())) return `There is already a swatch called “${name}”.`;
  return null;
}

export function addColourSwatch(doc: QuvreloDocument, s: SwatchInput): QuvreloDocument {
  if (swatchProblem(doc, s)) return doc;
  const name = cleanInkName(s.name) || (s.cmyk ? formatCmyk(s.cmyk) : s.color);
  const sw: Swatch = { id: newId('sw'), name, color: s.color };
  if (s.cmyk) sw.cmyk = s.cmyk.map((v) => Math.round(v * 10000) / 10000) as Cmyk;
  if (s.spot) sw.spot = true;
  return { ...doc, swatches: [...doc.swatches, sw] };
}

/** The paint a swatch applies: CMYK and spot swatches carry their inks along. */
export function swatchPaint(s: Swatch): Paint {
  if (!s.cmyk) return { type: 'solid', color: s.color };
  return s.spot ? { type: 'solid', color: s.color, cmyk: s.cmyk, spot: s.name } : { type: 'solid', color: s.color, cmyk: s.cmyk };
}

/** "Swatch kind · values" for tooltips and screen readers. */
export function swatchDetail(s: Swatch): string {
  if (s.spot && s.cmyk) return `Spot colour · ${formatCmyk(s.cmyk)} for process`;
  if (s.cmyk) return `CMYK · ${formatCmyk(s.cmyk)}`;
  return s.color;
}

/** Does this paint use this swatch (same inks, or same colour for an RGB swatch)? */
export function paintUsesSwatch(p: Paint | null | undefined, s: Swatch): boolean {
  if (!p || p.type !== 'solid') return false;
  if (s.spot) return p.spot === s.name;
  if (s.cmyk) return !!p.cmyk && p.cmyk.every((v, i) => Math.abs(v - s.cmyk![i]) < 0.005) && !p.spot;
  return false;
}
