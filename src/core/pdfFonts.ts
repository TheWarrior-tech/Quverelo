/**
 * Which bundled font file the canvas actually draws a text style with, so the
 * vector PDF embeds the same face. Mirrors the @fontsource faces loaded in
 * src/renderer/main.tsx (upright only: the browser slants italics itself) and
 * CSS font matching for weights.
 */
import type { TextStyle } from './types';

/** Bundled families and the weights main.tsx loads. Keep in step with main.tsx. */
export const BUNDLED_FACES: Record<string, { pkg: string; weights: number[] }> = {
  inter: { pkg: 'inter', weights: [400, 500, 600, 700, 800] },
  'atkinson hyperlegible': { pkg: 'atkinson-hyperlegible', weights: [400, 700] },
  opendyslexic: { pkg: 'opendyslexic', weights: [400, 700] },
  merriweather: { pkg: 'merriweather', weights: [400, 700] },
  'roboto slab': { pkg: 'roboto-slab', weights: [400, 700] },
  caveat: { pkg: 'caveat', weights: [400, 700] },
  // full-feature OpenType serif for pro typography (bundled in src/renderer/assets/fonts, OFL)
  'eb garamond': { pkg: 'eb-garamond', weights: [400, 700] },
};

/** CSS Fonts 4 §5.2 weight matching against the available weights. */
export function matchWeight(desired: number, available: number[]): number {
  const av = [...available].sort((a, b) => a - b);
  if (av.includes(desired)) return desired;
  const above = (from: number, to = Infinity) => av.filter((w) => w > from && w <= to);
  const below = (from: number) => av.filter((w) => w < from).reverse();
  let order: number[];
  if (desired >= 400 && desired <= 500) order = [...above(desired, 500), ...below(desired), ...above(500)];
  else if (desired < 400) order = [...below(desired), ...above(desired)];
  else order = [...above(desired), ...below(desired)];
  return order[0] ?? av[0];
}

export interface BundledFace {
  /** @fontsource package name */
  pkg: string;
  weight: number;
  /** file inside the package: files/<pkg>-latin-<weight>-normal.woff */
  file: string;
  synthItalic: boolean;
  /** the browser would fake bold (the PDF can't match it, so the text is placed as an image) */
  synthBold: boolean;
}

export function firstFamily(stack: string): string {
  return (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
}

/** The bundled face the canvas uses for this style, or null for system/installed fonts. */
export function bundledFaceFor(style: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'italic'>): BundledFace | null {
  const fam = BUNDLED_FACES[firstFamily(style.fontFamily).toLowerCase()];
  if (!fam) return null;
  const weight = matchWeight(style.fontWeight, fam.weights);
  return {
    pkg: fam.pkg,
    weight,
    file: `files/${fam.pkg}-latin-${weight}-normal.woff`,
    synthItalic: style.italic,
    synthBold: style.fontWeight >= 600 && weight < 600,
  };
}
