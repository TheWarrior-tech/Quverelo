/**
 * Export dialog honesty (critique 2 P0-1, P1-11): PDF is real vectors with
 * embedded fonts, "Image PDF" is labelled as pictures, page ranges, Area =
 * Selection with a scale field, and no dead space under the form.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { launch, run, shot, state, type Launched } from './helpers';

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

async function loadPdf(file: string) {
  const pdf = await PDFDocument.load(fs.readFileSync(file));
  const pages = pdf.getPages().map((p) => {
    const c = p.node.lookup(PDFName.of('Contents'));
    const streams = (c instanceof PDFArray ? c.asArray().map((r) => pdf.context.lookup(r)) : [c]) as PDFRawStream[];
    const ops = streams.map((st) => {
      const buf = Buffer.from(st.contents);
      try {
        return inflateSync(buf).toString('latin1');
      } catch {
        return buf.toString('latin1');
      }
    }).join('\n');
    const xo = p.node.Resources()!.lookupMaybe(PDFName.of('XObject'), PDFDict);
    const fonts = p.node.Resources()!.lookupMaybe(PDFName.of('Font'), PDFDict);
    return { ops, images: xo ? xo.entries().length : 0, fonts: fonts ? fonts.entries().length : 0 };
  });
  return { pdf, pages };
}

test.describe('export', () => {
  test('PDF is vectors with live text; Image PDF is one picture per page; page range', async () => {
    L = await launch();
    const { page, saveDir } = L;
    await page.click('[data-template="newsletter"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.waitForTimeout(400);
    const pageCount = await state<number>(page, 'editor.doc.pages.length');
    expect(pageCount).toBe(2);

    await run(page, 'file.export-pdf');
    const dlg = page.locator('.dialog');
    await expect(page.locator('[data-format="pdf"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-format="pdf"] .sub')).toHaveText('Vectors and live text');
    await expect(page.locator('[data-format="pdf-image"]')).toContainText('Image PDF');
    await expect(dlg).not.toContainText('Print-ready');
    await expect(dlg).not.toContainText('rasterised');
    // the plain PDF is not labelled print-ready; PDF/X-4 and PDF/X-1a are their own entries (colour.spec.ts)
    await expect(dlg.locator('.ex-form')).not.toContainText('PDF/X-');
    await expect(dlg.getByText('Image resolution')).toHaveCount(0);
    // the newsletter is A4: page size in mm
    await expect(page.getByTestId('export-dims')).toContainText('mm');
    await shot(page, 'export-pdf-vector');
    // page range
    await dlg.getByRole('radio', { name: 'Range' }).click();
    await page.getByTestId('export-range').fill('9');
    await expect(page.getByTestId('export-go')).toBeDisabled();
    await expect(dlg).toContainText('This document has 2 pages');
    await page.getByTestId('export-range').fill('2');
    await expect(page.getByTestId('export-go')).toBeEnabled();
    await page.getByTestId('export-name').fill('vector-range');
    await page.getByTestId('export-go').click();
    await expect(dlg).toHaveCount(0);
    const vec = path.join(saveDir, 'vector-range.pdf');
    await expect.poll(() => fs.existsSync(vec)).toBe(true);
    const v = await loadPdf(vec);
    expect(v.pdf.getPageCount()).toBe(1);
    expect(v.pages[0].ops).toMatch(/BT\n\/F\d+ [\d.]+ Tf/); // real text
    expect(v.pages[0].ops).toMatch(/> Tj/);
    expect(v.pages[0].fonts).toBeGreaterThan(0);
    const raw = Buffer.from(await v.pdf.save({ useObjectStreams: false })).toString('latin1');
    expect(raw).toContain('/FontFile2'); // the font travels with the file
    // A4 in points
    expect(v.pdf.getPages()[0].getWidth()).toBeCloseTo(595.3, 0);

    // Image PDF: honest label, resolution field, every page is a picture
    await run(page, 'file.export-pdf');
    await page.locator('[data-format="pdf-image"]').click();
    await expect(dlg.getByText('Image resolution')).toBeVisible();
    await expect(page.getByTestId('export-pdf-note')).toContainText("text can't be selected");
    await shot(page, 'export-pdf-image');
    await page.getByTestId('export-name').fill('pictures');
    await page.getByTestId('export-go').click();
    await expect(dlg).toHaveCount(0);
    const img = path.join(saveDir, 'pictures.pdf');
    await expect.poll(() => fs.existsSync(img)).toBe(true);
    const r = await loadPdf(img);
    expect(r.pdf.getPageCount()).toBe(2);
    for (const p of r.pages) {
      expect(p.images).toBe(1);
      expect(p.ops).not.toContain(' Tj');
    }
  });

  test('raster Area = Selection with a scale field; the form has no dead space', async () => {
    L = await launch();
    const { page, saveDir } = L;
    await page.locator('[data-start="layout"]').click();
    await page.getByTestId('create-document').click();
    await expect(page.locator('.workspace')).toBeVisible();
    // one 100×50 rectangle
    await page.evaluate(() => {
      const q = (window as any).__quvrelo;
      const { editor } = q;
      const rect = { id: 'sel-rect', name: 'Box', type: 'rect', x: 200, y: 200, w: 100, h: 50, radius: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false, visible: true, locked: false, opacity: 1, blend: 'normal', fill: { type: 'solid', color: '#e63946' }, stroke: { paint: { type: 'none' }, width: 0, dash: [], cap: 'butt', join: 'miter' } };
      editor.commit('Add', (d: any) => ({ ...d, pages: d.pages.map((p: any, i: number) => (i === 0 ? { ...p, nodes: [...p.nodes, rect] } : p)) }));
      editor.select(['sel-rect']);
    });
    await run(page, 'file.export-png');
    const dlg = page.locator('.dialog');
    await expect(page.locator('[data-format="png"]')).toHaveAttribute('aria-selected', 'true');
    await dlg.getByRole('radio', { name: 'Selection' }).click();
    const scale = dlg.getByRole('spinbutton', { name: 'Scale' });
    await scale.fill('2');
    await scale.press('Tab');
    // factor mode: the hint under the Scale field reads out the pixel size
    await expect(page.getByTestId('export-scale-hint')).toHaveText('200 × 100 px');
    await expect(page.getByTestId('export-dims')).toHaveText('200 × 100 px');
    // dialog hugs its content: the form's last row ends near the body's bottom or the preview sets the height
    const gap = await page.evaluate(() => {
      const main = document.querySelector('.ex-form') as HTMLElement;
      const aside = document.querySelector('.ex-preview') as HTMLElement;
      const grid = main.querySelector('.fgrid') as HTMLElement;
      const contentBottom = Math.max(grid.getBoundingClientRect().bottom + 20, (aside.lastElementChild as HTMLElement).getBoundingClientRect().bottom + 16);
      return main.getBoundingClientRect().bottom - contentBottom;
    });
    expect(gap).toBeLessThan(8);
    await shot(page, 'export-png-selection');
    await page.getByTestId('export-name').fill('sel');
    await page.getByTestId('export-go').click();
    await expect(dlg).toHaveCount(0);
    const out = path.join(saveDir, 'sel - selection.png');
    await expect.poll(() => fs.existsSync(out)).toBe(true);
    const png = fs.readFileSync(out);
    expect(png.readUInt32BE(16)).toBe(200);
    expect(png.readUInt32BE(20)).toBe(100);
  });
});
