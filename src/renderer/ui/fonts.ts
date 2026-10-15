import { editor } from '../state/editor';

import { BUNDLED_FONTS, SYSTEM_FONTS, fontSections as sections, type FontSection } from './fontList';

export { BUNDLED_FONTS, SYSTEM_FONTS, type FontSection };

let localFonts: string[] = [];

export function fontOptions(): string[] {
  return [...new Set([...BUNDLED_FONTS, ...SYSTEM_FONTS, ...localFonts])];
}

/** Families found by the Local Font Access API (policy feature "local-fonts"), sorted. */
export function installedFonts(): string[] {
  return localFonts;
}

export async function loadLocalFonts(): Promise<number> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!q || !editor.feature('local-fonts')) return 0;
  try {
    const list = await q();
    localFonts = [...new Set(list.map((f) => f.family))].sort();
    editor.emit();
    return localFonts.length;
  } catch {
    return 0;
  }
}

export function primaryFamily(f: string): string {
  return f.split(',')[0].replace(/["']/g, '').trim();
}

const RECENT_KEY = 'quvrelo.recentFonts';
export function recentFonts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
export function addRecentFont(f: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([f, ...recentFonts().filter((x) => x !== f)].slice(0, 5)));
  } catch {
    /* storage unavailable */
  }
}

/** Picker sections for a query with the user's recent and installed fonts. */
export function fontSections(query: string): FontSection[] {
  return sections(query, recentFonts(), localFonts);
}
