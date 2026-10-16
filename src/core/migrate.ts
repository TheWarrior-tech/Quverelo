import { defaultSettings, DEFAULT_SWATCHES } from './document';
import type { QuvreloDocument } from './types';

/**
 * Validate and upgrade a parsed document to the current schema. Unknown or
 * missing fields are filled with defaults so older files keep opening.
 */
export function migrateDocument(raw: unknown): QuvreloDocument {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid document');
  const d = raw as Partial<QuvreloDocument> & Record<string, unknown>;
  if (d.format !== 'quvrelo' && d.format !== 'easel') throw new Error('Not a Quvrelo document'); // 'easel' = pre-release files
  if (typeof d.version === 'number' && d.version > 1) {
    throw new Error('This document was made with a newer version of Quvrelo. Please update.');
  }
  if (!Array.isArray(d.pages) || d.pages.length === 0) throw new Error('Document has no pages');
  const stories = (d.stories ?? {}) as QuvreloDocument['stories'];
  for (const s of Object.values(stories)) if (!Array.isArray(s.chain)) s.chain = [];
  return {
    format: 'quvrelo',
    version: 1,
    id: String(d.id ?? 'doc_' + Date.now().toString(36)),
    title: String(d.title ?? 'Untitled'),
    createdAt: String(d.createdAt ?? new Date().toISOString()),
    modifiedAt: String(d.modifiedAt ?? new Date().toISOString()),
    settings: { ...defaultSettings(), ...(d.settings ?? {}) },
    pages: d.pages.map((p) => ({ ...p, masterId: p.masterId ?? null, nodes: p.nodes ?? [] })),
    masters: d.masters ?? [],
    stories,
    guides: d.guides ?? [],
    swatches: d.swatches ?? DEFAULT_SWATCHES.map((s) => ({ ...s })),
    assets: d.assets ?? {},
    studio: d.studio ?? 'vector',
    ...(d.assignment ? { assignment: d.assignment } : {}),
    ...(Array.isArray(d.symbols) && d.symbols.length ? { symbols: d.symbols.map((x) => ({ ...x, nodes: Array.isArray(x.nodes) ? x.nodes : [] })) } : {}),
    ...(Array.isArray(d.slices) && d.slices.length ? { slices: d.slices } : {}),
  };
}
