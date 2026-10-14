import { defaultSettings, DEFAULT_SWATCHES } from './document';
import type { EaselDocument } from './types';

/**
 * Validate and upgrade a parsed document to the current schema. Unknown or
 * missing fields are filled with defaults so older files keep opening.
 */
export function migrateDocument(raw: unknown): EaselDocument {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid document');
  const d = raw as Partial<EaselDocument> & Record<string, unknown>;
  if (d.format !== 'easel') throw new Error('Not an Easel Studio document');
  if (typeof d.version === 'number' && d.version > 1) {
    throw new Error('This document was made with a newer version of Easel Studio. Please update.');
  }
  if (!Array.isArray(d.pages) || d.pages.length === 0) throw new Error('Document has no pages');
  const stories = (d.stories ?? {}) as EaselDocument['stories'];
  for (const s of Object.values(stories)) if (!Array.isArray(s.chain)) s.chain = [];
  return {
    format: 'easel',
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
  };
}
