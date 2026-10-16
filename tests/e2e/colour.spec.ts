/**
 * Colour management and print: CMYK document mode in Document setup, soft proof
 * and gamut warning on the canvas, and PDF/X-4 / PDF/X-1a export from the Export
 * dialog. Set QUVRELO_COLOUR_OUT=<dir> to keep the exported PDFs (for veraPDF).
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { docToScreen, launch, run, shot, state, type Launched } from './helpers';

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

const keepDir = process.env.QUVRELO_COLOUR_OUT ?? '';

async function newLayoutDoc(page: Page) {
  await page.locator('[data-start="layout"]').click();
  await page.getByTestId('create-document').click();
  await expect(page.locator('.workspace')).toBeVisible();
}

/** Add a filled rectangle through the editor (drawing it is covered elsewhere). */
async function addRect(page: Page, id: string, x: number, y: number, fill: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  await page.evaluate(({ id, x, y, fill, extra }) => {
    const { editor } = (window as any).__quvrelo;
    const rect = { id, name: id, type: 'rect', x, y, w: 160, h: 120, radius: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false, visible: true, locked: false, opacity: 1, blend: 'normal', fill, stroke: { paint: { type: 'none' }, width: 0, dash: [], cap: 'butt', join: 'miter' }, ...extra };
    editor.commit('Add', (d: any) => ({ ...d, pages: d.pages.map((p: any, i: number) => (i === 0 ? { ...p, nodes: [...p.nodes, rect] } : p)) }));
  }, { id, x, y, fill, extra });
}

/** The colour the canvas shows at a document point (after colour management). */
async function canvasPixel(page: Page, x: number, y: number): Promise<number[]> {
  const s = await docToScreen(page, x, y);
  return page.evaluate(({ sx, sy }) => {
    const vp = (window as any).__quvrelo.getViewport();
    const el = vp.canvas.lowerCanvasEl as HTMLCanvasElement;
    const r = el.getBoundingClientRect();
    const k = el.width / r.width;
    const d = el.getContext('2d')!.getImageData(Math.round((sx - r.left) * k), Math.round((sy - r.top) * k), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { sx: s.x, sy: s.y });
}

async function waitRendered(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(150);
}

async function loadPdf(file: string) {
  const bytes = fs.readFileSync(file);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const ops = pdf.getPages().map((p) => inflateSync(Buffer.from((p.node.lookup(PDFName.of('Contents')) as PDFRawStream).contents)).toString('latin1'));
  return { pdf, ops, raw: bytes.toString('latin1') };
}

test.describe('colour management', () => {
  test('soft proof and gamut warning change what the page shows; CMYK mode always proofs', async () => {
    L = await launch();
    const { page } = L;
    await newLayoutDoc(page);
    await addRect(page, 'blue', 150, 150, { type: 'solid', color: '#0000ff' });
    await addRect(page, 'skin', 350, 150, { type: 'solid', color: '#c8a08c' });
    await run(page, 'view.zoom-fit');
    await waitRendered(page);
    const toggle = page.getByTestId('proof-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('status-colour')).toHaveText('sRGB');
    const before = await canvasPixel(page, 150, 150);
    expect(before[2]).toBeGreaterThan(240);
    expect(before[0]).toBeLessThan(15);

    // soft proof: screen blue can't be printed, the proof shows the press's duller blue
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status-colour')).toHaveText('Proof · FOGRA39');
    await expect.poll(async () => (await canvasPixel(page, 150, 150))[2], { timeout: 10_000 }).toBeLessThan(235);
    const proofed = await canvasPixel(page, 150, 150);
    expect(proofed[0]).toBeGreaterThan(20);
    expect(await state<boolean>(page, 'window.__quvrelo.getViewport().displayColourActive')).toBe(true);
    // a printable colour barely moves
    const skin = await canvasPixel(page, 350, 150);
    expect(Math.abs(skin[0] - 200)).toBeLessThan(16);
    await shot(page, 'colour-soft-proof');

    // gamut warning: the blue turns flat grey, the skin tone stays
    await page.getByTestId('gamut-toggle').click();
    await expect(page.getByTestId('gamut-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => {
      const [r, g, b] = await canvasPixel(page, 150, 150);
      return Math.max(r, g, b) - Math.min(r, g, b);
    }).toBeLessThan(30);
    const skin2 = await canvasPixel(page, 350, 150);
    expect(skin2[0] - skin2[2]).toBeGreaterThan(30);
    await shot(page, 'colour-gamut-warning');
    await page.getByTestId('gamut-toggle').click();
    await toggle.click();
    await expect.poll(async () => (await canvasPixel(page, 150, 150))[2]).toBeGreaterThan(240);

    // Document setup › Colour mode CMYK: the press proof is always on
    await run(page, 'file.document-setup');
    const dlg = page.locator('.dialog');
    await dlg.getByRole('radio', { name: 'CMYK' }).click();
    await page.getByTestId('ds-cmyk-profile').selectOption('crpc6');
    await expect(dlg).toContainText('North America');
    await shot(page, 'colour-document-setup');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect(dlg).toHaveCount(0);
    expect(await state<string>(page, 'editor.doc.settings.colour.mode')).toBe('cmyk');
    await expect(page.getByTestId('status-colour')).toHaveText('CMYK · CRPC6');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await canvasPixel(page, 150, 150))[2]).toBeLessThan(235);
    // the menu command explains instead of switching the proof off
    await toggle.click();
    await expect(page.locator('.toast').last()).toContainText('CMYK documents always show the press proof');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // undo restores RGB
    await run(page, 'edit.undo');
    await expect(page.getByTestId('status-colour')).toHaveText('sRGB');
  });

  test('Export offers PDF/X-4 and PDF/X-1a with a press choice; files are CMYK with an OutputIntent', async () => {
    L = await launch();
    const { page, saveDir } = L;
    await newLayoutDoc(page);
    await addRect(page, 'red', 150, 150, { type: 'solid', color: '#e63946' });
    await addRect(page, 'see-through', 250, 200, { type: 'solid', color: '#1d3557' }, { opacity: 0.5 });
    await addRect(page, 'ink', 350, 300, { type: 'solid', color: '#e4002b', cmyk: [0, 1, 0.8, 0], spot: 'PANTONE 185 C' });
    await run(page, 'file.export-pdf');
    const dlg = page.locator('.dialog');
    await expect(page.locator('[data-format="pdf-x4"]')).toContainText('PDF/X-4');
    await expect(page.locator('[data-format="pdf-x1a"]')).toContainText('PDF/X-1a');
    await page.locator('[data-format="pdf-x4"]').click();
    await expect(page.getByTestId('export-colour')).toHaveText('CMYK · FOGRA39 · PDF/X-4');
    await expect(page.getByTestId('export-pdf-note')).toContainText('press profile travels with the file');
    // the preview is soft-proofed
    await expect.poll(() => page.evaluate(() => (document.querySelector('.page-preview canvas') as HTMLCanvasElement | null)?.dataset.proof ?? '')).toBe('fogra39');
    await page.getByTestId('export-press').selectOption('crpc6');
    await expect(page.getByTestId('export-colour')).toHaveText('CMYK · CRPC6 · PDF/X-4');
    await shot(page, 'colour-export-pdfx4');
    await page.getByTestId('export-name').fill('press-x4');
    await page.getByTestId('export-go').click();
    await expect(dlg).toHaveCount(0);
    const x4 = path.join(saveDir, 'press-x4.pdf');
    await expect.poll(() => fs.existsSync(x4), { timeout: 30_000 }).toBe(true);

    await run(page, 'file.export-pdf');
    await page.locator('[data-format="pdf-x1a"]').click();
    await expect(page.getByTestId('export-colour')).toHaveText('CMYK · FOGRA39 · PDF/X-1a:2003');
    await expect(page.getByTestId('export-pdf-note')).toContainText('flattened');
    await shot(page, 'colour-export-pdfx1a');
    await page.getByTestId('export-name').fill('press-x1a');
    await page.getByTestId('export-go').click();
    await expect(dlg).toHaveCount(0);
    const x1a = path.join(saveDir, 'press-x1a.pdf');
    await expect.poll(() => fs.existsSync(x1a), { timeout: 30_000 }).toBe(true);
    // the see-through rectangle was flattened, and the toast says so
    await expect(page.locator('.toast').last()).toContainText('PDF/X-1a has no transparency');

    for (const [file, ver, id] of [[x4, '%PDF-1.6', 'CGATS21_CRPC6'], [x1a, '%PDF-1.4', 'FOGRA39']] as const) {
      const { pdf, ops, raw } = await loadPdf(file);
      if (keepDir) {
        fs.mkdirSync(keepDir, { recursive: true });
        fs.copyFileSync(file, path.join(keepDir, path.basename(file)));
      }
      expect(raw.startsWith(ver)).toBe(true);
      expect(raw).not.toContain('/DeviceRGB');
      expect(ops[0]).not.toMatch(/ rg\n/);
      expect(ops[0]).toMatch(/ k\n/);
      expect(ops[0]).toMatch(/\/CS\d+ cs 1 scn/); // the spot ink
      const oi = pdf.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).lookup(0, PDFDict);
      expect(oi.lookup(PDFName.of('OutputConditionIdentifier'), PDFString).decodeText()).toBe(id);
      const info = pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict);
      expect(info.lookup(PDFName.of('GTS_PDFXVersion'), PDFString).decodeText()).toBe(ver === '%PDF-1.6' ? 'PDF/X-4' : 'PDF/X-1a:2003');
      expect(info.get(PDFName.of('Trapped'))).toEqual(PDFName.of('False'));
      if (ver === '%PDF-1.4') expect(raw).not.toContain('/SMask');
      else expect(raw).toMatch(/\/ca 0\.5/);
    }
  });

  test('CMYK and spot swatches: create in the dialog, apply, picker CMYK uses the press profile, PDF keeps the ink', async () => {
    L = await launch();
    const { page, saveDir } = L;
    await newLayoutDoc(page);
    await addRect(page, 'box', 200, 200, { type: 'solid', color: '#888888' });
    // the Swatches panel lives in the left rail's Assets tab
    await page.getByRole('tab', { name: 'Assets' }).click();
    await page.getByTestId('swatch-new-cmyk').click();
    const dlg = page.locator('.dialog');
    await expect(dlg).toContainText('New CMYK swatch');
    await dlg.getByRole('radio', { name: 'Spot colour' }).click();
    await expect(dlg).toContainText('New spot colour');
    await expect(page.getByTestId('swatch-add')).toBeDisabled(); // a spot needs its ink name
    await page.getByTestId('swatch-name').fill('PANTONE 185 C');
    for (const [label, v] of [['Cyan percent', '0'], ['Magenta percent', '100'], ['Yellow percent', '80'], ['Black percent', '0']] as const) {
      const f = dlg.getByRole('spinbutton', { name: label });
      await f.fill(v);
      await f.press('Tab');
    }
    // preview through the press profile: a strong red, not the device-CMYK pure red
    await expect.poll(async () => page.getByTestId('swatch-preview').getAttribute('data-color')).not.toBe('#ff0033');
    const pv = await page.getByTestId('swatch-preview').getAttribute('data-color');
    expect(parseInt(pv!.slice(1, 3), 16)).toBeGreaterThan(180);
    await shot(page, 'colour-new-spot');
    await page.getByTestId('swatch-add').click();
    await expect(dlg).toHaveCount(0);
    const spot = page.locator('.swatch[data-swatch-kind="spot"]');
    await expect(spot).toHaveCount(1);
    await expect(spot).toHaveAttribute('aria-label', /PANTONE 185 C · Spot colour · C0 M100 Y80 K0/);
    // apply to the selected box: the fill carries the ink
    await page.evaluate(() => (window as any).__quvrelo.editor.select(['box']));
    await spot.click();
    expect(await state<unknown>(page, "editor.doc.pages[0].nodes.find(n => n.id === 'box').fill")).toEqual({ type: 'solid', color: pv, cmyk: [0, 1, 0.8, 0], spot: 'PANTONE 185 C' });
    await expect(spot).toHaveAttribute('aria-selected', 'true');
    await shot(page, 'colour-swatches');

    // the picker's CMYK fields are ICC, named after the press, and read the ink back
    await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Fill colour' }).click();
    const pop = page.getByTestId('color-popover');
    const cmykRadio = pop.getByRole('radio', { name: 'CMYK' });
    await cmykRadio.click();
    await expect(cmykRadio).toHaveAttribute('data-tip', 'CMYK · Coated FOGRA39');
    const m = Number(await pop.getByRole('spinbutton', { name: 'CMYK M percent' }).inputValue());
    expect(m).toBeGreaterThan(88);
    await page.keyboard.press('Escape');

    await run(page, 'file.export-pdf');
    await page.locator('[data-format="pdf-x4"]').click();
    await page.getByTestId('export-name').fill('spot');
    await page.getByTestId('export-go').click();
    const file = path.join(saveDir, 'spot.pdf');
    await expect.poll(() => fs.existsSync(file), { timeout: 30_000 }).toBe(true);
    const { pdf } = await loadPdf(file);
    const cs = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('ColorSpace'), PDFDict);
    const sep = pdf.context.lookup(cs.entries()[0][1], PDFArray);
    expect(sep.get(0)).toEqual(PDFName.of('Separation'));
    expect((sep.get(1) as PDFName).decodeText()).toBe('PANTONE 185 C');
  });
});
