import type { StudioKind } from './types';

/** New Document dialog categories (left list). */
export type NewDocCategory = 'print' | 'screen' | 'photo' | 'school' | 'templates';

/**
 * The studio a new document opens in, inferred from where the user started
 * (UX audit P1-7) so newcomers never have to answer "Open in" up front:
 * Photo → Photo, Screen → Vector, Print and School → Layout. Multi-page
 * documents (booklets, slide decks) always open in Layout, which owns pages.
 * Falls back to the first studio the policy allows.
 */
export function inferStudio(cat: NewDocCategory, opts: { pages?: number } = {}, allowed: StudioKind[] = ['photo', 'vector', 'layout']): StudioKind {
  let s: StudioKind = cat === 'photo' ? 'photo' : cat === 'screen' ? 'vector' : 'layout';
  if ((opts.pages ?? 1) > 1) s = 'layout';
  if (allowed.includes(s)) return s;
  return (['layout', 'vector', 'photo'] as StudioKind[]).find((x) => allowed.includes(x)) ?? 'layout';
}
