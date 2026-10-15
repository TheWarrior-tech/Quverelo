/** Font lists and picker sections. Pure: no editor or DOM access, unit-tested. */

/** Typefaces bundled with the app (always available offline). */
export const BUNDLED_FONTS = ['Inter', 'Atkinson Hyperlegible', 'OpenDyslexic', 'Merriweather', 'Roboto Slab', 'Caveat'];
/** Common system families, shown when present on most school machines. */
export const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Comic Sans MS', 'Segoe UI', 'Calibri'];
export interface FontSection {
  title: string;
  fonts: string[];
}

/**
 * Picker sections for a query: Recent (5), Bundled, System, Installed. Matching
 * is case-insensitive on any word start or substring; a font appears once, in
 * its first section.
 */
export function fontSections(query: string, recent: string[], installed: string[]): FontSection[] {
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
