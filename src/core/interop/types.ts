import type { Pixels } from '../pixels';
import type { Id, QuvreloDocument } from '../types';

/**
 * What every importer returns. Importers are pure (no DOM): pixel data comes
 * back as RGBA buffers keyed by the asset id the document already references,
 * and the renderer registers them in its AssetStore. Encoded images (JPEG/PNG
 * found inside an IDML or PDF) come back as bytes instead.
 */
export interface ImportResult {
  doc: QuvreloDocument;
  pixels: Map<Id, Pixels>;
  encoded: Map<Id, { bytes: Uint8Array; mime: string }>;
  /** Plain-language notes about anything that could not be kept editable. */
  warnings: string[];
}

export function emptyResult(doc: QuvreloDocument): ImportResult {
  return { doc, pixels: new Map(), encoded: new Map(), warnings: [] };
}

/** Collapse repeated warnings ("3 × clipping masks were…"). */
export function summariseWarnings(list: string[]): string[] {
  const counts = new Map<string, number>();
  for (const w of list) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].map(([w, n]) => (n > 1 ? `${w} (×${n})` : w));
}
