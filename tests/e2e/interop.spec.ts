/**
 * Interop end to end: open Photoshop, Illustrator (PDF-compatible) and InDesign
 * IDML files through File › Open, place a PSD into a document, export PSD and
 * read it back, and the import notes dialog.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readPsd, initializeCanvas } from 'ag-psd';
import { samplePdf, samplePsd, sampleIdml } from '../fixtures/interop';
import { launch, run, shot, state, type Launched } from './helpers';

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-interop-'));
async function fixture(name: string, data: Uint8Array | Promise<Uint8Array>): Promise<string> {
  const p = path.join(dir, name);
  fs.writeFileSync(p, await data);
  return p;
}

test.describe('interop', () => {
  test('opens a layered PSD with groups, blend modes and masks, then exports PSD', async () => {
    const psd = await fixture('Poster.psd', samplePsd());
    L = await launch({ QUVRELO_E2E_OPEN: psd });
    const { page, saveDir } = L;
    await run(page, 'file.open');
    await expect(page.locator('.workspace')).toBeVisible();
    await expect.poll(() => state<string>(page, 'editor.doc && editor.doc.title')).toBe('Poster');
    const info = await state<{ studio: string; names: string[]; groupKids: string[]; blend: string; assets: boolean }>(page, `(() => {
      const nodes = editor.doc.pages[0].nodes;
      const g = nodes.find((n) => n.type === 'group');
      return { studio: editor.doc.studio, names: nodes.map((n) => n.name), groupKids: g.children.map((c) => c.name), blend: g.children[0].blend,
        assets: nodes.filter((n) => n.type === 'raster').every((n) => editor.assets.has(n.assetId)) };
    })()`);
    expect(info).toEqual({ studio: 'photo', names: ['Background', 'Stuff', 'Masked', 'Box'], groupKids: ['Red', 'Hidden'], blend: 'multiply', assets: true });
    // import notes are offered from the toast
    await page.getByRole('button', { name: 'Details' }).click();
    const dlg = page.getByRole('dialog', { name: 'Import notes' });
    await expect(dlg).toContainText('linear burn');
    await shot(page, 'interop-import-notes');
    await dlg.getByRole('button', { name: 'Done' }).click();

    await run(page, 'file.export-psd');
    const out = path.join(saveDir, 'Poster.psd');
    await expect.poll(() => fs.existsSync(out)).toBe(true);
    initializeCanvas(() => { throw new Error('no canvas'); }, (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) as ImageData);
    const back = readPsd(fs.readFileSync(out), { useImageData: true });
    expect(back.width).toBe(200);
    const names = (back.children ?? []).map((l) => l.name);
    expect(names).toEqual(['Background', 'Stuff', 'Masked', 'Box']);
    const group = back.children!.find((l) => l.name === 'Stuff')!;
    expect(group.children?.map((c) => [c.name, c.blendMode, !!c.hidden])).toEqual([['Red', 'multiply', false], ['Hidden', 'color burn', true]]);
    expect(group.opacity).toBeCloseTo(0.5, 1);
  });

  test('opens an Illustrator file with editable paths, text and layers', async () => {
    const ai = await fixture('Logo.ai', samplePdf());
    L = await launch({ QUVRELO_E2E_OPEN: ai });
    const { page } = L;
    await run(page, 'file.open');
    await expect.poll(() => state<string>(page, 'editor.doc && editor.doc.title')).toBe('Logo');
    const info = await state<{ studio: string; paths: number; text: string; layers: string[] }>(page, `(() => {
      const all = []; const walk = (l) => l.forEach((n) => { all.push(n); if (n.type === 'group') walk(n.children); });
      walk(editor.doc.pages[0].nodes);
      return { studio: editor.doc.studio, paths: all.filter((n) => n.type === 'path').length, text: all.find((n) => n.type === 'text').text,
        layers: editor.doc.pages[0].nodes.filter((n) => n.type === 'group').map((g) => g.name) };
    })()`);
    expect(info.studio).toBe('vector');
    expect(info.paths).toBeGreaterThanOrEqual(4);
    expect(info.text).toBe('Hello PDF');
    expect(info.layers).toEqual(['Artwork', 'Sketch']);
    // the Layers panel shows the Illustrator layers by name
    await expect(page.locator('.layer-row', { hasText: 'Artwork' })).toBeVisible();
    await shot(page, 'interop-ai-open');
  });

  test('opens an IDML layout with threaded frames, master and styles', async () => {
    const idml = await fixture('Newsletter.idml', sampleIdml());
    L = await launch({ QUVRELO_E2E_OPEN: idml });
    const { page } = L;
    await run(page, 'file.open');
    await expect.poll(() => state<string>(page, 'editor.doc && editor.doc.title')).toBe('Newsletter');
    const info = await state<{ studio: string; pages: number; masters: number; chain: number; text: string; image: boolean }>(page, `(() => {
      const d = editor.doc; const s = Object.values(d.stories)[0];
      const frame = d.pages[0].nodes.find((n) => n.type === 'imageframe');
      return { studio: d.studio, pages: d.pages.length, masters: d.masters.length, chain: s.chain.length, text: s.text, image: !!frame && editor.assets.has(frame.assetId) };
    })()`);
    expect(info).toEqual({ studio: 'layout', pages: 2, masters: 1, chain: 2, text: 'Fish & chips\nSecond paragraph', image: true });
    await shot(page, 'interop-idml-open');
  });

  test('places a PSD into an open document as one group (undoable)', async () => {
    const psd = await fixture('Badge.psd', samplePsd());
    L = await launch({ QUVRELO_E2E_OPEN: psd });
    const { page } = L;
    await page.click('[data-template="newsletter"]');
    await expect(page.locator('.workspace')).toBeVisible();
    const before = await state<number>(page, 'editor.activeContainer.nodes.length');
    await run(page, 'file.place');
    await expect.poll(() => state<number>(page, 'editor.activeContainer.nodes.length')).toBe(before + 1);
    const g = await state<{ type: string; name: string; kids: number; sel: boolean }>(page, `(() => { const n = editor.activeContainer.nodes.at(-1); return { type: n.type, name: n.name, kids: n.children.length, sel: editor.ui.selection[0] === n.id }; })()`);
    expect(g).toEqual({ type: 'group', name: 'Badge', kids: 4, sel: true });
    await run(page, 'edit.undo');
    await expect.poll(() => state<number>(page, 'editor.activeContainer.nodes.length')).toBe(before);
  });
});
