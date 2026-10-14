import { describe, expect, it } from 'vitest';
import { packEasel, unpackEasel } from '../../src/core/serialization';
import { createDocument, make } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { migrateDocument } from '../../src/core/migrate';

describe('.easel format', () => {
  it('round-trips document and assets', async () => {
    let d = createDocument({ title: 'Round trip' });
    const raster = make.raster({ assetId: 'a1', w: 2, h: 2 });
    d = addNodes(d, d.pages[0].id, [raster, make.rect()]);
    d = { ...d, assets: { a1: { id: 'a1', name: 'img', mime: 'image/png', width: 2, height: 2 }, unused: { id: 'unused', name: 'x', mime: 'image/png', width: 1, height: 1 } } };
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const zip = await packEasel(d, async (id) => (id === 'a1' ? { bytes, mime: 'image/png' } : null));
    const out = await unpackEasel(zip);
    expect(out.doc.title).toBe('Round trip');
    expect(out.doc.pages[0].nodes).toHaveLength(2);
    expect(Array.from(out.assets.get('a1')!.bytes)).toEqual(Array.from(bytes));
    expect(out.doc.assets.unused).toBeUndefined();
  });
  it('rejects non-easel data', () => {
    expect(() => migrateDocument({ format: 'nope' })).toThrow();
    expect(() => migrateDocument({ format: 'easel', version: 99, pages: [{}] })).toThrow(/newer/);
  });
  it('fills defaults when migrating', () => {
    const d = migrateDocument({ format: 'easel', pages: [{ id: 'p', name: 'P' }] });
    expect(d.pages[0].nodes).toEqual([]);
    expect(d.settings.width).toBeGreaterThan(0);
    expect(d.swatches.length).toBeGreaterThan(0);
  });
});
