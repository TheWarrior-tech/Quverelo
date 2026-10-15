import { editor } from '../state/editor';

/** Typefaces bundled with the app (always available offline). */
export const BUNDLED_FONTS = ['Inter', 'Atkinson Hyperlegible', 'OpenDyslexic', 'Merriweather', 'Roboto Slab', 'Caveat'];
/** Common system families, shown when present on most school machines. */
export const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Comic Sans MS', 'Segoe UI', 'Calibri'];
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

export interface FontSection {
  title: string;
  fonts: string[];
}

/**
 * Picker sections for a query: Recent (5), Bundled, System, Installed. Matching
 * is case-insensitive on any word start or substring; a font appears once, in
 * its first section.
 */
export function fontSections(query: string, recent: string[] = recentFonts(), installed: string[] = localFonts): FontSection[] {
  const q = query.trim().toLowerCase();
  const match = (f: string) => !q || f.toLowerCase().includes(q);
  const seen = new Set<string>();
  const take = (list: string[]) => list.filter((f) => match(f) && !seen.has(f) && (seen.add(f), true));
  const out: FontSection[] = [
    { title: 'Recent', fonts: q ? [] : take(recent) },
    { title: 'Bundled', fonts: take(BUNDLED_FONTS) },
    { title: 'System', fonts: take(SYSTEM_FONTS) },
    { title: 'Installed', fonts: take(installed) },
  ];
  return out.filter((s) => s.fonts.length);
}
