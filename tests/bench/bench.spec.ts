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
import { fiftyPageDoc } from './fixtures';
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
  const pending = () => state<number>(p, 'editor.assets.pendingRenders()');
  // "shown": the canvas has painted the new stack at the size the view needs (or a smaller level while
  // the full one is in the worker); "full detail": the worker render for the current zoom has landed
  const step = async (label: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    rec('photo', `${label}: shown`, await timed(p, fn));
    await expect.poll(pending, { intervals: [20], timeout: 120_000 }).toBe(0);
    await painted(p);
    rec('photo', `${label}: full detail`, Date.now() - t0);
  };
  await step('fit view, add Brightness/Contrast', () => addAdj('brightness-contrast', { brightness: 10, contrast: 15 }));
  await step('fit view, add Hue/Saturation', () => addAdj('hue-saturation', { hue: 10, saturation: 20, lightness: 0 }));
  await step('fit view, add Gaussian blur r=8', () => addAdj('blur', { radius: 8 }));
  await step('zoom to 100 % (3 adjustments)', () => run(p, 'view.zoom-100'));
  await step('100 %, add Vibrance', () => addAdj('vibrance', { amount: 30 }));
  rec('photo', 'full-resolution adjustment render (24 MP, cached by the view)', await timed(p, () => p.evaluate((id) => {
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
