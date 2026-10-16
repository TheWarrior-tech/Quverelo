/**
 * 16-bit Photo pipeline, DNG raw import and ICC-tagged exports, end to end:
 * open a (generated) DNG from the Open dialog, check it opens as a 16-bit
 * Photo document, adjust it, export a 16-bit PNG and a JPEG (both carry the
 * document profile), and save a .quvrelo that keeps the 16-bit pixels.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { decode } from 'fast-png';
import { docToScreen, drag, launch, pickTool, run, shot, state, type Launched } from './helpers';
import { writeDng } from '../unit/dngFixture';
import { readJpegIcc, readPngIcc } from '../../src/core/colour/embedIcc';

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

function fixtureDng(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-dng-'));
  const file = path.join(dir, 'Gradient.dng');
  // a smooth sky-like gradient over a narrow range plus a grey card: 8 bits would band it
  const bytes = writeDng({ width: 600, height: 400, scene: (x, y) => (y < 300 ? [0.12 + 0.1 * (x / 600), 0.16 + 0.1 * (x / 600), 0.3 + 0.1 * (x / 600)] : [0.18, 0.18, 0.18]) });
  fs.writeFileSync(file, bytes);
  return file;
}

function distinct(data: ArrayLike<number>, channels: number, rows: number, width: number): number {
  const s = new Set<number>();
  for (let i = 0; i < width * rows; i++) s.add(data[i * channels]);
  return s.size;
}

test.describe('16-bit photos, DNG raw and ICC in exports', () => {
  test('a DNG opens as a 16-bit Photo document; PNG exports 16-bit with iCCP, JPEG carries APP2, .quvrelo keeps 16 bits', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: fixtureDng() });
    const { page, saveDir } = L;
    await run(page, 'file.open');
    await expect(page.locator('.workspace')).toBeVisible();
    expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
    await expect(page.getByTestId('status-colour')).toHaveText('sRGB · 16-bit');
    expect(await state<number>(page, 'editor.assets.bitDepth(editor.doc.pages[0].nodes[0].assetId)')).toBe(16);
    expect(await state<number>(page, 'editor.doc.settings.width')).toBe(600);
    await expect(page.locator('.toast').filter({ hasText: 'DNG' }).first()).toContainText('16-bit document');

    // a strong Levels stretch: the 16-bit path keeps the gradient smooth
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const n = editor.doc.pages[0].nodes[0];
      editor.commit('Levels', (d: any) => ({ ...d, pages: d.pages.map((p: any) => ({ ...p, nodes: p.nodes.map((x: any) => (x.id === n.id ? { ...x, adjustments: [{ id: 'lv', type: 'levels', enabled: true, params: { inBlack: 90, inWhite: 140, gamma: 1, outBlack: 0, outWhite: 255 } }] } : x)) })) }));
    });

    await run(page, 'file.export-png');
    const dlg = page.locator('.dialog');
    const depth = dlg.getByRole('radiogroup', { name: 'Bit depth' });
    await expect(depth.getByRole('radio', { name: '16-bit' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('export-colour')).toHaveText('sRGB · 16-bit · profile embedded');
    await shot(page, 'deep-export-png16');
    await page.getByTestId('export-name').fill('deep16');
    await page.getByTestId('export-go').click();
    await expect(dlg).toHaveCount(0);
    const png16 = path.join(saveDir, 'deep16.png');
    await expect.poll(() => fs.existsSync(png16), { timeout: 30_000 }).toBe(true);
    const bytes16 = new Uint8Array(fs.readFileSync(png16));
    expect(bytes16[24]).toBe(16); // IHDR bit depth
    const icc16 = readPngIcc(bytes16);
    expect(icc16?.name).toMatch(/sRGB/i);
    const img16 = decode(bytes16);
    expect(img16.depth).toBe(16);
    expect(img16.width).toBe(600);
    const lv16 = distinct(img16.data, img16.channels, 1, 600);
    expect(lv16).toBeGreaterThan(400);

    // the same export at 8 bits bands: far fewer levels
    await run(page, 'file.export-png');
    await depth.getByRole('radio', { name: '8-bit' }).click();
    await expect(page.getByTestId('export-colour')).toHaveText('sRGB · 8-bit · profile embedded');
    await page.getByTestId('export-name').fill('deep8');
    await page.getByTestId('export-go').click();
    const png8 = path.join(saveDir, 'deep8.png');
    await expect.poll(() => fs.existsSync(png8), { timeout: 30_000 }).toBe(true);
    const bytes8 = new Uint8Array(fs.readFileSync(png8));
    expect(bytes8[24]).toBe(8);
    expect(readPngIcc(bytes8)).not.toBeNull();
    const img8 = decode(bytes8);
    expect(distinct(img8.data, img8.channels, 1, 600)).toBeLessThan(lv16 / 2);

    // JPEG carries the profile as APP2
    await run(page, 'file.export-jpg');
    await page.getByTestId('export-name').fill('deep');
    await page.getByTestId('export-go').click();
    const jpg = path.join(saveDir, 'deep.jpg');
    await expect.poll(() => fs.existsSync(jpg), { timeout: 30_000 }).toBe(true);
    const icc = readJpegIcc(new Uint8Array(fs.readFileSync(jpg)));
    expect(icc?.length).toBe(icc16!.profile.length);

    // save: the asset is stored as a 16-bit PNG
    await run(page, 'file.save');
    await expect.poll(() => fs.readdirSync(saveDir).filter((f) => f.endsWith('.quvrelo')).length, { timeout: 30_000 }).toBe(1);
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(saveDir, fs.readdirSync(saveDir).find((f) => f.endsWith('.quvrelo'))!)));
    const asset = Object.keys(zip.files).find((f) => /^assets\/.+\.png$/.test(f))!;
    const stored = await zip.file(asset)!.async('uint8array');
    expect(stored[24]).toBe(16);
    const doc = JSON.parse(await zip.file('document.json')!.async('string'));
    expect(doc.settings.colour.bitDepth).toBe(16);
  });

  test('painting on a 16-bit layer keeps the untouched pixels at 16 bits; Adobe RGB documents embed Adobe RGB', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: fixtureDng() });
    const { page, saveDir } = L;
    await run(page, 'file.open');
    await expect(page.locator('.workspace')).toBeVisible();
    const probe = `(() => { const n = editor.doc.pages[0].nodes[0]; const h = editor.assets.hi(n.assetId); return h ? [editor.assets.bitDepth(n.assetId), h.data[(10 * h.width + 590) * 4], h.data[(10 * h.width + 590) * 4] % 257] : null; })()`;
    const before = await state<number[]>(page, probe);
    expect(before[0]).toBe(16);
    expect(before[2]).not.toBe(0); // a real 16-bit value, not a widened 8-bit one
    const asset0 = await state<string>(page, 'editor.doc.pages[0].nodes[0].assetId');
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.select([editor.doc.pages[0].nodes[0].id]);
    });
    await pickTool(page, 'brush');
    await drag(page, await docToScreen(page, 60, 200), await docToScreen(page, 300, 220), 10);
    await expect.poll(() => state<string>(page, 'editor.doc.pages[0].nodes[0].assetId')).not.toBe(asset0);
    const after = await state<number[]>(page, probe);
    expect(after[0]).toBe(16);
    expect(after[1]).toBe(before[1]); // untouched corner keeps its exact 16-bit value

    // switch the document to Adobe RGB in Document setup
    await run(page, 'file.document-setup');
    const setup = page.locator('.dialog');
    await setup.getByTestId('ds-rgb-profile').selectOption('adobe-rgb');
    await setup.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('status-colour')).toHaveText('Adobe RGB · 16-bit');
    await run(page, 'file.export-png');
    await expect(page.getByTestId('export-colour')).toHaveText('Adobe RGB · 16-bit · profile embedded');
    await page.getByTestId('export-name').fill('adobe');
    await page.getByTestId('export-go').click();
    const f = path.join(saveDir, 'adobe.png');
    await expect.poll(() => fs.existsSync(f), { timeout: 30_000 }).toBe(true);
    const icc = readPngIcc(new Uint8Array(fs.readFileSync(f)));
    expect(icc?.name).toBe('Adobe RGB (1998)');
  });

  test('Document setup Bit depth switches a document to the 16-bit pipeline', async () => {
    L = await launch();
    const { page } = L;
    await page.locator('[data-start="layout"]').click();
    await page.getByTestId('create-document').click();
    await expect(page.locator('.workspace')).toBeVisible();
    await expect(page.getByTestId('status-colour')).toHaveText('sRGB');
    await run(page, 'file.document-setup');
    const setup = page.locator('.dialog');
    await setup.getByRole('radiogroup', { name: 'Bit depth' }).getByRole('radio', { name: '16-bit' }).click();
    await expect(setup).toContainText('16-bit PNGs and DNG raw files open as 16-bit');
    await setup.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('status-colour')).toHaveText('sRGB · 16-bit');
    await run(page, 'file.export-png');
    await expect(page.locator('.dialog').getByRole('radiogroup', { name: 'Bit depth' }).getByRole('radio', { name: '16-bit' })).toHaveAttribute('aria-checked', 'true');
  });
});
