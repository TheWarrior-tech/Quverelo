/**
 * Large-file benchmarks (npm run bench). Not part of the normal e2e suite.
 *
 *  Photo  — a 6000 × 4000 JPEG: open, add a live adjustment stack and render it
 *           at full resolution, export full-size JPEG and PNG.
 *  Layout — a 50-page document (threaded story through 50 frames, an image and
 *           shapes on every page): open, page through every page, export vector PDF.
 *
 * Results go to test-results/bench.json and are printed as a Markdown table;
 * docs/BENCHMARKS.md records a run. Timings are wall-clock in the renderer.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDocument, createStory, make } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { packQuvrelo } from '../../src/core/serialization';
import type { QuvreloDocument } from '../../src/core/types';
import { launch, run, state } from '../e2e/helpers';

const results: { scenario: string; step: string; ms: number }[] = [];
const rec = (scenario: string, step: string, ms: number) => {
  results.push({ scenario, step, ms: Math.round(ms) });
  console.log(`${scenario.padEnd(8)} ${step.padEnd(46)} ${Math.round(ms)} ms`);
};

test.afterAll(() => {
  fs.mkdirSync('test-results', { recursive: true });
  const env = { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30) };
  fs.writeFileSync('test-results/bench.json', JSON.stringify({ env, at: new Date().toISOString(), results }, null, 2));
  console.log('\n| Scenario | Step | ms |\n|---|---|---:|\n' + results.map((r) => `| ${r.scenario} | ${r.step} | ${r.ms} |`).join('\n'));
});

/** Two animation frames: the viewport has painted the new state. */
const painted = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function timed<T>(page: Page, fn: () => Promise<T>): Promise<number> {
  const t0 = Date.now();
  await fn();
  await painted(page);
  return Date.now() - t0;
}

test.setTimeout(600_000);

test('photo 6000 × 4000: open, filter, export', async () => {
  const L = await launch();
  const { page, saveDir } = L;
  // make the photo inside the renderer (canvas JPEG encoder), write it to disk, then open it like a user would
  const jpgPath = path.join(saveDir, 'big-photo.jpg');
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 6000; c.height = 4000;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, 6000, 4000);
    g.addColorStop(0, '#264653'); g.addColorStop(0.5, '#e9c46a'); g.addColorStop(1, '#e76f51');
    x.fillStyle = g; x.fillRect(0, 0, 6000, 4000);
    for (let i = 0; i < 4000; i++) { x.fillStyle = `hsl(${i % 360} 60% 50% / .35)`; x.beginPath(); x.arc((i * 7919) % 6000, (i * 104729) % 4000, 20 + (i % 90), 0, 7); x.fill(); }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
    return btoa(s);
  });
  fs.writeFileSync(jpgPath, Buffer.from(b64, 'base64'));
  await L.app.close();

  const L2 = await launch({ QUVRELO_E2E_OPEN: jpgPath });
  const p = L2.page;
  rec('photo', `open 6000×4000 JPEG (${(fs.statSync(jpgPath).size / 2 ** 20).toFixed(1)} MB)`, await timed(p, async () => {
    await run(p, 'file.open');
    await expect.poll(() => state<number>(p, 'editor.doc ? editor.doc.settings.width : 0'), { intervals: [20] }).toBe(6000);
  }));
  const rasterId = await state<string>(p, 'editor.doc.pages[0].nodes[0].id');
  // a live adjustment stack: preview (what the canvas shows while editing) then full resolution (export)
  const addAdj = (type: string, params: Record<string, number>) => p.evaluate(({ id, type, params }) => {
    const { editor } = (window as unknown as { __quvrelo: { editor: { commit: (l: string, f: (d: unknown) => unknown) => void } } }).__quvrelo;
    editor.commit('bench', (d: any) => ({ ...d, pages: d.pages.map((pg: any) => ({ ...pg, nodes: pg.nodes.map((n: any) => n.id === id ? { ...n, adjustments: [...n.adjustments, { id: 'adj' + n.adjustments.length, type, enabled: true, params }] } : n) })) }));
  }, { id: rasterId, type, params });
  rec('photo', 'add Brightness/Contrast (preview render)', await timed(p, () => addAdj('brightness-contrast', { brightness: 10, contrast: 15 })));
  rec('photo', 'add Hue/Saturation (preview render)', await timed(p, () => addAdj('hue-saturation', { hue: 10, saturation: 20, lightness: 0 })));
  rec('photo', 'add Gaussian blur r=8 (preview render)', await timed(p, () => addAdj('blur', { radius: 8 })));
  rec('photo', 'full-resolution adjustment render (24 MP)', await timed(p, () => p.evaluate((id) => {
    const { editor } = (window as unknown as { __quvrelo: { editor: any } }).__quvrelo;
    const n = editor.doc.pages[0].nodes.find((x: any) => x.id === id);
    editor.assets.rendered(n.assetId, n.adjustments, false);
  }, rasterId)));
  for (const [fmt, label] of [['jpg', 'export full-size JPEG'], ['png', 'export full-size PNG']] as const) {
    rec('photo', label, await timed(p, () => p.evaluate(async (f) => {
      const q = (window as unknown as { __quvrelo: { exportForBench?: (f: string) => Promise<unknown> } }).__quvrelo;
      if (!q.exportForBench) throw new Error('bench hook missing');
      await q.exportForBench(f);
    }, fmt)));
  }
  expect(fs.readdirSync(L2.saveDir).some((f) => f.endsWith('.jpg'))).toBe(true);
  await L2.app.close();
});

async function fiftyPageDoc(dir: string): Promise<string> {
  let doc: QuvreloDocument = createDocument({ title: 'Fifty pages', studio: 'layout', pages: 50, settings: { width: 794, height: 1123, unit: 'mm', margins: { top: 57, right: 57, bottom: 57, left: 57 } } });
  const png = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-photo.jpg'));
  const assetId = 'a_bench_photo';
  doc = { ...doc, assets: { [assetId]: { id: assetId, name: 'photo', mime: 'image/jpeg', width: 640, height: 427 } } };
  const para = 'Quvrelo lays out long documents offline. '.repeat(40);
  const story = createStory(Array.from({ length: 120 }, (_, i) => `${i + 1}. ${para}`).join('\n'), { fontSize: 13 });
  const frames: string[] = [];
  for (const [i, pg] of doc.pages.entries()) {
    const tf = make.textframe({ storyId: story.id, x: 397, y: 700, w: 680, h: 700, columns: 2, columnGap: 20, name: `Body ${i + 1}` });
    frames.push(tf.id);
    const img = make.imageframe({ assetId, x: 397, y: 220, w: 680, h: 300, name: `Photo ${i + 1}` });
    const shapes = Array.from({ length: 10 }, (_, k) => make.rect({ x: 80 + k * 70, y: 1080, w: 50, h: 20, name: `Bar ${k}` }));
    const title = make.text({ text: `Chapter ${i + 1}`, x: 397, y: 40, name: 'Title' });
    doc = addNodes(doc, pg.id, [img, tf, title, ...shapes]);
  }
  story.chain = frames;
  doc = { ...doc, stories: { [story.id]: story } };
  const bytes = await packQuvrelo(doc, async (id) => (id === assetId ? { bytes: new Uint8Array(png), mime: 'image/jpeg' } : null));
  const p = path.join(dir, 'Fifty pages.quvrelo');
  fs.writeFileSync(p, bytes);
  return p;
}

test('layout 50 pages: open, scroll every page, export PDF', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-bench-'));
  const file = await fiftyPageDoc(dir);
  const L = await launch({ QUVRELO_E2E_OPEN: file });
  const p = L.page;
  rec('layout', 'open 50-page document', await timed(p, async () => {
    await run(p, 'file.open');
    await expect.poll(() => state<number>(p, 'editor.doc ? editor.doc.pages.length : 0'), { intervals: [20] }).toBe(50);
  }));
  const t0 = Date.now();
  let worst = 0;
  for (let i = 1; i < 50; i++) {
    const ms = await timed(p, () => run(p, 'page.next'));
    worst = Math.max(worst, ms);
  }
  rec('layout', 'page through 49 pages (total)', Date.now() - t0);
  rec('layout', 'slowest single page change', worst);
  rec('layout', 'export 50-page vector PDF', await timed(p, () => p.evaluate(async () => {
    const q = (window as unknown as { __quvrelo: { exportForBench?: (f: string) => Promise<unknown> } }).__quvrelo;
    await q.exportForBench!('pdf');
  })));
  const pdf = fs.readdirSync(L.saveDir).find((f) => f.endsWith('.pdf'));
  expect(pdf).toBeTruthy();
  await L.app.close();
});
