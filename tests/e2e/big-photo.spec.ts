/**
 * Big photos: adjustments render at the size the canvas shows first and at
 * full size in a worker (engine/adjustWorker.ts), so the UI never waits for a
 * 24 MP filter. The worker's result must match the main-thread render.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { launch, run, state, type Launched } from './helpers';

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

test('a 3000 × 2000 photo filters at view size, then full size lands from the worker and matches the main thread', async () => {
  L = await launch();
  const jpg = path.join(L.saveDir, 'big.jpg');
  const b64 = await L.page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 2000;
    const x = c.getContext('2d')!;
    for (let i = 0; i < 300; i++) { x.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 40)}%)`; x.fillRect((i * 997) % 3000, (i * 613) % 2000, 300, 200); }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
    return btoa(s);
  });
  fs.writeFileSync(jpg, Buffer.from(b64, 'base64'));
  await L.app.close();

  L = await launch({ QUVRELO_E2E_OPEN: jpg });
  const p = L.page;
  await run(p, 'file.open');
  await expect.poll(() => state<number>(p, 'editor.doc ? editor.doc.settings.width : 0')).toBe(3000);
  await p.evaluate(() => {
    const { editor } = (window as unknown as { __quvrelo: { editor: any } }).__quvrelo;
    const id = editor.doc.pages[0].nodes[0].id;
    editor.commit('blur', (d: any) => ({ ...d, pages: d.pages.map((pg: any) => ({ ...pg, nodes: pg.nodes.map((n: any) => n.id === id ? { ...n, adjustments: [{ id: 'a1', type: 'hue-saturation', enabled: true, params: { hue: 40, saturation: 10, lightness: 0 } }, { id: 'a2', type: 'blur', enabled: true, params: { radius: 6 } }] } : n) })) }));
  });
  // fit view: the canvas shows a reduced level straight away
  const fit = await p.evaluate(() => {
    const { editor } = (window as unknown as { __quvrelo: { editor: any } }).__quvrelo;
    const n = editor.doc.pages[0].nodes[0];
    return editor.assets.rendered(n.assetId, n.adjustments, 0.2).width as number;
  });
  expect(fit).toBeLessThan(3000);
  // 100 %: the view asks for full size; it comes from the worker and the canvas repaints
  await run(p, 'view.zoom-100');
  await expect.poll(() => state<number>(p, 'editor.assets.pendingRenders()'), { timeout: 60_000 }).toBe(0);
  const cmp = await p.evaluate(() => {
    const { editor } = (window as unknown as { __quvrelo: { editor: any } }).__quvrelo;
    const n = editor.doc.pages[0].nodes[0];
    const fromWorker = editor.assets.rendered(n.assetId, n.adjustments, 1) as HTMLCanvasElement;
    // the same stack on the main thread, on a fresh store entry (no cache)
    const id2 = editor.assets.add(editor.assets.get(n.assetId));
    const local = editor.assets.rendered(id2, n.adjustments, false) as HTMLCanvasElement;
    const a = fromWorker.getContext('2d')!.getImageData(0, 0, 3000, 2000).data;
    const b = local.getContext('2d')!.getImageData(0, 0, 3000, 2000).data;
    let diff = 0;
    for (let i = 0; i < a.length; i += 4097) diff = Math.max(diff, Math.abs(a[i] - b[i]));
    return { w: fromWorker.width, h: fromWorker.height, diff };
  });
  expect(cmp).toEqual({ w: 3000, h: 2000, diff: 0 });
  // it really ran in the worker (CSP and the packaged file:// build allow it)
  expect(await state<{ worker: number; fallback: number }>(p, 'editor.assets.stats')).toMatchObject({ fallback: 0 });
  expect(await state<number>(p, 'editor.assets.stats.worker')).toBeGreaterThan(0);
});
