import type { StudioKind } from './types';

export type ExportFormat = 'png' | 'jpg' | 'svg' | 'pdf';

/**
 * Format the Export dialog opens on (UX audit P0-5): the last format used for
 * this document, else PDF for Layout documents (pages to print or hand in),
 * else PNG. Formats disabled by policy are skipped.
 */
export function defaultExportFormat(docStudio: StudioKind | undefined, last: ExportFormat | null | undefined, enabled: ExportFormat[]): ExportFormat {
  const pick = (f: ExportFormat | null | undefined) => (f && enabled.includes(f) ? f : null);
  return pick(last) ?? pick(docStudio === 'layout' ? 'pdf' : 'png') ?? enabled[0] ?? 'png';
}

/**
 * Pages to re-export with "Export again": the remembered page indices that
 * still exist. Returns null when none survive (the dialog should open instead).
 */
export function pagesStillValid(pages: number[], pageCount: number): number[] | null {
  const ok = pages.filter((i) => Number.isInteger(i) && i >= 0 && i < pageCount);
  return ok.length ? ok : null;
}
