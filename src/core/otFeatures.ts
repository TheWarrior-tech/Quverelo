/**
 * OpenType feature settings for a text style. The canvas renderer registers
 * an alias FontFace with these settings (Chromium honours the FontFace
 * `featureSettings` descriptor, so HarfBuzz shapes the text with them) and the
 * vector PDF embeds the font laid out with the same features, so screen and
 * print agree.
 */
import type { TextStyle } from './types';

/** Features that differ from the font's defaults, as fontkit feature flags. */
export function otFeatures(s: Partial<TextStyle>): Record<string, boolean> {
  const f: Record<string, boolean> = {};
  if (s.ligatures === false) {
    f.liga = false;
    f.clig = false;
  }
  if (s.discretionaryLigatures) f.dlig = true;
  if (s.figures === 'lining') f.lnum = true;
  else if (s.figures === 'oldstyle') f.onum = true;
  if (s.figureSpacing === 'tabular') f.tnum = true;
  else if (s.figureSpacing === 'proportional') f.pnum = true;
  return f;
}

/** CSS font-feature-settings for the same features ('' = font defaults). */
export function featureSettings(s: Partial<TextStyle>): string {
  return Object.entries(otFeatures(s))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `"${k}" ${v ? 1 : 0}`)
    .join(', ');
}

/** The OpenType features each bundled family really has (from the font files). */
export const BUNDLED_FEATURES: Record<string, string[]> = {
  'eb garamond': ['liga', 'dlig', 'onum', 'lnum', 'tnum', 'pnum', 'smcp', 'c2sc', 'kern', 'frac', 'sups', 'subs'],
  inter: ['tnum', 'pnum', 'kern', 'frac', 'calt'],
  merriweather: ['liga', 'tnum', 'pnum', 'kern', 'frac'],
  'roboto slab': ['liga', 'lnum', 'kern', 'frac'],
  'atkinson hyperlegible': ['tnum', 'pnum', 'kern', 'frac'],
  caveat: ['liga', 'calt', 'kern'],
  opendyslexic: ['kern'],
};
