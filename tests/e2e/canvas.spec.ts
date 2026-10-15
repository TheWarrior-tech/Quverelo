/**
 * Canvas chrome regressions from design review 1 (P0-1..P0-5, toasts, Layout).
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { docToScreen, drag, launch, run, shot, state, pickTool, type Launched } from './helpers';

const photo = path.resolve('tests/fixtures/sample-photo.jpg');

/** Count overlay pixels that are opaque, and those close to the selection accent #2fb8a6. */
async function overlayStats(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('.viewport-overlay') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    let accent = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 10) continue;
      opaque++;
      if (Math.abs(d[i] - 47) < 24 && Math.abs(d[i + 1] - 184) < 24 && Math.abs(d[i + 2] - 166) < 24) accent++;
    }
    return { opaque, accent };
  });
}

/** Fingerprint of what the document canvas currently renders. */
async function canvasPixels(page: Page) {
  return page.evaluate(() => (document.querySelector('.viewport canvas.lower-canvas') as HTMLCanvasElement).toDataURL());
}

async function openPhoto(page: Page) {
  await run(page, 'file.open');
  await expect(page.locator('.workspace')).toBeVisible();
}

test.describe('canvas chrome', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('photo marquee never shows outside Photo; vector selection has box and handles', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await pickTool(page, 'marquee-ellipse');
    await drag(page, await docToScreen(page, 700, 330), await docToScreen(page, 1000, 560));
    expect(await state<boolean>(page, '!!editor.ui.pixelSelection')).toBe(true);
    await page.waitForTimeout(150);
    expect((await overlayStats(page)).opaque).toBeGreaterThan(100); // ants drawn in Photo

    await page.click('.studio-switch [data-studio="vector"]');
    await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
    await page.waitForTimeout(150);
    expect((await overlayStats(page)).opaque).toBe(0); // nothing leaks into Vector
    // the selection is kept in the model for when you go back
    expect(await state<boolean>(page, '!!editor.ui.pixelSelection')).toBe(true);

    await pickTool(page, 'rect');
    await drag(page, await docToScreen(page, 300, 300), await docToScreen(page, 500, 420));
    await page.waitForTimeout(150);
    const withRectTool = await overlayStats(page);
    expect(withRectTool.accent).toBeGreaterThan(200); // 1px box + handles, even with the Rectangle tool
    // zoom in: handles keep their screen size, so the accent pixel count barely changes per handle
    await run(page, 'view.zoom-in');
    await page.waitForTimeout(150);
    expect((await overlayStats(page)).accent).toBeGreaterThan(200);

    await page.click('.studio-switch [data-studio="layout"]');
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.select([editor.doc.pages[0].nodes.at(-1).id]);
    });
    await page.waitForTimeout(150);
    expect((await overlayStats(page)).accent).toBeGreaterThan(200);
  });

  test('studio switch shows exactly one active segment', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    for (const s of ['vector', 'layout', 'photo', 'vector']) {
      await page.click(`.studio-switch [data-studio="${s}"]`);
      await expect(page.locator('.studio-switch [aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator(`.studio-switch [data-studio="${s}"]`)).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(200); // let the 120ms fade finish
      // every other segment has no fill, even under the pointer
      const fills = await page.locator('.studio-switch button[aria-pressed="false"]').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
      for (const f of fills) expect(f).toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('opening a dialog does not change what the canvas renders', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await page.click('.studio-switch [data-studio="vector"]');
    await pickTool(page, 'star');
    await drag(page, { x: 400, y: 300 }, { x: 560, y: 440 });
    await pickTool(page, 'move');
    await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
    await page.waitForTimeout(200);
    const before = await canvasPixels(page);
    for (const cmd of ['app.preferences', 'file.export-png', 'help.shortcuts', 'file.new']) {
      await run(page, cmd);
      await expect(page.locator('.dialog')).toBeVisible();
      await page.waitForTimeout(200);
      expect(await canvasPixels(page)).toBe(before);
      await page.keyboard.press('Escape');
      await expect(page.locator('.dialog')).toHaveCount(0);
    }
  });

  test('curves: real editor with points applied to pixels', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.select([editor.doc.pages[0].nodes[0].id]);
    });
    await page.locator('select[aria-label="Add adjustment"]').selectOption('curves');
    const graph = page.locator('.curves-graph');
    await expect(graph).toBeVisible();
    await graph.scrollIntoViewIfNeeded();
    const box = (await graph.boundingBox())!;
    expect(Math.round(box.width)).toBe(Math.round(box.height));
    // click the middle of the diagonal and pull it up: adds a point and brightens
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await drag(page, mid, { x: mid.x, y: mid.y - box.height * 0.2 }, 6);
    const rgb = await state<{ x: number; y: number }[]>(page, 'editor.doc.pages[0].nodes[0].adjustments[0].curves.rgb');
    expect(rgb).toHaveLength(3);
    expect(rgb[1].y).toBeGreaterThan(rgb[1].x + 20);
    await expect(page.locator('input[aria-label="Curve point output"]')).toHaveValue(String(rgb[1].y));
    // channel switch edits the red curve only
    await page.getByRole('radio', { name: 'R', exact: true }).click();
    // no point selected: the fields show the black point instead of sitting empty (critique 2 P1-2)
    await expect(page.locator('input[aria-label="Curve point input"]')).toHaveValue('0');
    await expect(page.locator('input[aria-label="Curve point output"]')).toHaveValue('0');
    await expect(page.locator('input[aria-label="Curve point output"]')).toBeEnabled();
    // Reset sits beside the channel switch, not inside it, and is off while the curve is straight
    const reset = page.getByRole('button', { name: 'Reset Red curve' });
    await expect(reset).toBeDisabled();
    expect(await page.locator('[role="radiogroup"][aria-label="Curve channel"] button').count()).toBe(4);
    await graph.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } });
    expect(await state<number>(page, 'editor.doc.pages[0].nodes[0].adjustments[0].curves.r.length')).toBe(3);
    expect(await state<number>(page, 'editor.doc.pages[0].nodes[0].adjustments[0].curves.rgb.length')).toBe(3);
    // typed Input/Output move the selected point
    const out = page.locator('input[aria-label="Curve point output"]');
    await out.fill('100');
    await out.press('Enter');
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes[0].adjustments[0].curves.r[1].y')).toBe(100);
    const inp = page.locator('input[aria-label="Curve point input"]');
    await inp.fill('70');
    await inp.press('Enter');
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes[0].adjustments[0].curves.r[1].x')).toBe(70);
    await expect(reset).toBeEnabled();
    // keyboard: delete the selected red point
    await graph.focus();
    await page.keyboard.press('Delete');
    expect(await state<number>(page, 'editor.doc.pages[0].nodes[0].adjustments[0].curves.r.length')).toBe(2);
    // the black point can be set from the fields with nothing selected
    await out.fill('20');
    await out.press('Enter');
    await expect.poll(() => state<string>(page, 'JSON.stringify(editor.doc.pages[0].nodes[0].adjustments[0].curves.r[0])')).toBe('{"x":0,"y":20}');
    await reset.click();
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes[0].adjustments[0].curves.r[0].y')).toBe(0);
    // histogram has a header with a channel menu
    await expect(page.getByRole('combobox', { name: 'Histogram channel' })).toBeVisible();
    await shot(page, 'curves');
  });

  test('toasts sit over the canvas, clear of the panels, and go away', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await run(page, 'text.link'); // nothing selected: shows an informational toast
    const t = page.locator('.toast').last();
    await expect(t).toBeVisible();
    const tb = (await t.boundingBox())!;
    const cb = (await page.locator('.canvas-area').boundingBox())!;
    const pb = (await page.locator('.panels').boundingBox())!;
    expect(tb.x).toBeGreaterThanOrEqual(cb.x);
    expect(tb.x + tb.width).toBeLessThanOrEqual(pb.x);
    expect(Math.abs(tb.x + tb.width / 2 - (cb.x + cb.width / 2))).toBeLessThan(2);
    expect(tb.y + tb.height).toBeLessThanOrEqual(cb.y + cb.height);
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 4500 });
  });

  test('layout studio shows page controls and lands on Move', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await page.click('.studio-switch [data-studio="vector"]');
    await pickTool(page, 'rect');
    await page.click('.studio-switch [data-studio="layout"]');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('move');
    await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
    // margins read in the document unit (a photo document is px)
    await expect(page.locator('.contextbar [aria-label="Top margin (px)"]')).toBeVisible();
    await page.locator('.contextbar [aria-label="Top margin (px)"]').fill('40');
    await page.locator('.contextbar [aria-label="Top margin (px)"]').press('Enter');
    expect(await state<number>(page, 'Math.round(editor.doc.settings.margins.top)')).toBe(40);
    await page.locator('.contextbar [aria-label="Add page"]').click();
    // groups that don't fit the canvas column sit under More (critique 3 N2)
    const facing = page.locator('.contextbar button[aria-pressed]', { hasText: 'Facing pages' });
    if (!(await facing.count())) await page.getByRole('button', { name: 'More options' }).click();
    await page.locator('.contextbar button[aria-pressed], .ctx-more-pop button[aria-pressed]').filter({ hasText: 'Facing pages' }).click();
    await expect(page.locator('.pages-grid.spreads .spread')).toHaveCount(2);
  });
});
