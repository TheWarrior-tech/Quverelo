import { expect, test } from '@playwright/test';
import * as path from 'node:path';
import { launch, run, shot, state, type Launched } from './helpers';

const fixture = path.resolve(__dirname, '../fixtures/sample-photo.jpg');
let L: Launched | null = null;

test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

async function openPhoto(l: Launched) {
  await run(l.page, 'file.open');
  await expect(l.page.locator('.workspace')).toBeVisible();
}

test('Select Subject: model backend loads offline and a 1024 px analysis runs end to end', async () => {
  L = await launch({ QUVRELO_E2E_OPEN: fixture });
  const { page } = L;
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await openPhoto(L);
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => (window as any).__quvrelo.editor.setUi({ pixelSelection: null, status: '' }));
    await run(page, 'select.subject');
    await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection'), { timeout: 30_000 }).toBe(true);
    const status = await state<string>(page, 'editor.ui.status');
    expect(status, logs.join('\n')).toContain('on-device model');
    times.push(Number(/(\d+) ms/.exec(status)?.[1] ?? NaN));
  }
  const backend = logs.find((t) => t.startsWith('[ml] backend'));
  expect(backend, logs.join('\n')).toBeTruthy();
  const warm = times.slice(1).sort((a, b) => a - b);
  const median = (warm[1] + warm[2]) / 2;
  console.log(`${backend}; Select Subject end-to-end ms (first, then 4 warm): ${times.join(', ')}; warm median ${median}`);
  console.log(logs.filter((t) => t.startsWith('[ml] select subject')).join('\n'));
  // the first run includes creating the session; warm runs are the per-use cost. CI-safe bound; the
  // measured figure is recorded in ml/MODEL_CARD.md
  expect(median).toBeLessThan(2000);
});

test('Cut Out Subject (soft edges): new layer with a soft alpha matte, photo hidden, one undo', async () => {
  L = await launch({ QUVRELO_E2E_OPEN: fixture });
  const { page } = L;
  await openPhoto(L);
  const before = await state<number>(page, 'editor.doc.pages[0].nodes.length');
  await run(page, 'select.cutout');
  await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length'), { timeout: 30_000 }).toBe(before + 1);
  const info = await state<{ name: string; hiddenPhoto: boolean; total: number; soft: number; clear: number; opaque: number }>(page, `(() => {
    const nodes = editor.doc.pages[0].nodes;
    const cut = nodes.find((n) => n.type === 'raster' && n.name.endsWith('(cut-out)'));
    const photo = nodes.find((n) => n.type === 'raster' && n !== cut);
    const c = editor.assets.get(cut.assetId);
    const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let soft = 0, clear = 0, opaque = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] === 0) clear++; else if (d[i] === 255) opaque++; else soft++; }
    return { name: cut.name, hiddenPhoto: photo.visible === false, total: d.length / 4, soft, clear, opaque };
  })()`);
  expect(info.hiddenPhoto).toBe(true);
  expect(info.opaque).toBeGreaterThan(info.total * 0.01); // a subject was kept
  expect(info.clear).toBeGreaterThan(info.total * 0.2); // background removed
  expect(info.soft).toBeGreaterThan(200); // soft (matted) edge, not a hard binary cut
  const status = await state<string>(page, 'editor.ui.status');
  expect(status).toContain('soft edges');
  await shot(page, 'photo-cutout-soft');
  await run(page, 'edit.undo');
  await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(before);
  expect(await state<boolean>(page, 'editor.doc.pages[0].nodes.every((n) => n.visible !== false)')).toBe(true);
});
