/**
 * Photo parity: selection tools (marquees, lasso, polygonal lasso, magic wand,
 * add / subtract / intersect, feather, refine edge, colour range), brushes
 * (flow, pressure), retouching (clone, healing, spot healing, dodge, burn,
 * smudge), filters with live preview, liquify, straighten, image / canvas size
 * and the histogram panel. Drives the canvas with the mouse and the real
 * dialogs; reads pixels through window.__quvreloPhoto.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { docToScreen, drag, launch, run, state, type Launched } from './helpers';

type RGBA = [number, number, number, number];

const P = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__quvreloPhoto[f as string](...(a as unknown[])), [fn, args] as const);

async function newPhoto(page: Page, w = 64, h = 64, bg: string | null = '#ffffff') {
  await page.evaluate(([w, h, bg]) => (window as any).__quvreloPhoto.newPhoto(w, h, bg), [w, h, bg] as const);
  await expect(page.locator('.workspace')).toBeVisible();
}

const tool = (page: Page, t: string) => page.evaluate((x) => (window as any).__quvrelo.editor.setTool(x), t);
const opts = (page: Page, o: Record<string, unknown>) => page.evaluate((x) => (window as any).__quvrelo.editor.setToolOptions(x), o);
const ui = (page: Page, o: Record<string, unknown>) => page.evaluate((x) => (window as any).__quvrelo.editor.setUi(x), o);

/** Bounds of the pixel selection outline (document px). */
async function selBounds(page: Page) {
  return state<{ x0: number; y0: number; x1: number; y1: number } | null>(page, `(() => {
    const s = editor.ui.pixelSelection; if (!s) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of s) for (let i = 1; i < c.length; i += 2) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1]); }
    return { x0, y0, x1, y1 };
  })()`);
}

/** A context-bar control, opening "More" when the bar tucked it away (narrow canvas column). */
async function ctx(page: Page, make: (root: Locator) => Locator): Promise<Locator> {
  const inBar = make(page.locator('.contextbar'));
  if ((await inBar.count()) && (await inBar.first().isVisible())) return inBar.first();
  await page.locator('.contextbar .ctx-more-btn').click();
  const pop = make(page.locator('.ctx-more-pop'));
  await expect(pop.first()).toBeVisible();
  return pop.first();
}

async function closeMore(page: Page) {
  if (await page.locator('.ctx-more-pop').count()) await page.keyboard.press('Escape');
}

async function dab(page: Page, x: number, y: number, x2 = x + 0.5, y2 = y) {
  await drag(page, await docToScreen(page, x, y), await docToScreen(page, x2, y2), 6);
}

test.describe('photo parity: tools', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('selection tools: marquees, lasso, polygonal lasso, magic wand, add / subtract / intersect', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    await P(page, 'addPatternLayer', 'dot');
    // rectangle, then Shift adds, Alt subtracts
    await tool(page, 'marquee-rect');
    await drag(page, await docToScreen(page, 8, 8), await docToScreen(page, 32, 32));
    let b = (await selBounds(page))!;
    expect(Math.round(b.x0)).toBeGreaterThanOrEqual(7);
    expect(Math.round(b.x1)).toBeLessThanOrEqual(33);
    await page.keyboard.down('Shift');
    await drag(page, await docToScreen(page, 24, 24), await docToScreen(page, 56, 56));
    await page.keyboard.up('Shift');
    b = (await selBounds(page))!;
    expect(b.x1).toBeGreaterThan(54);
    await page.keyboard.down('Alt');
    await drag(page, await docToScreen(page, 0, 0), await docToScreen(page, 64, 20));
    await page.keyboard.up('Alt');
    b = (await selBounds(page))!;
    expect(b.y0).toBeGreaterThan(18);
    // intersect via the context-bar mode
    await opts(page, { selectionMode: 'intersect' });
    await drag(page, await docToScreen(page, 26, 26), await docToScreen(page, 40, 40));
    b = (await selBounds(page))!;
    expect(b.x0).toBeGreaterThan(24);
    expect(b.x1).toBeLessThan(42);
    await opts(page, { selectionMode: 'new' });
    // ellipse
    await tool(page, 'marquee-ellipse');
    await drag(page, await docToScreen(page, 10, 20), await docToScreen(page, 50, 40));
    b = (await selBounds(page))!;
    expect(b.x1 - b.x0).toBeGreaterThan(36);
    expect(b.y1 - b.y0).toBeLessThan(24);
    // freehand lasso
    await tool(page, 'lasso');
    const a0 = await docToScreen(page, 10, 10);
    await page.mouse.move(a0.x, a0.y);
    await page.mouse.down();
    for (const [x, y] of [[50, 10], [50, 50], [10, 50], [10, 12]]) {
      const q = await docToScreen(page, x, y);
      await page.mouse.move(q.x, q.y, { steps: 6 });
    }
    await page.mouse.up();
    b = (await selBounds(page))!;
    expect(b.x1 - b.x0).toBeGreaterThan(35);
    // polygonal lasso: click corners, double-click closes
    await tool(page, 'polygon-lasso');
    await expect(page.locator('.toolpalette [data-tool="polygon-lasso"]')).toHaveClass(/active/);
    for (const [x, y] of [[5, 5], [60, 5], [32, 60]]) {
      const q = await docToScreen(page, x, y);
      await page.mouse.click(q.x, q.y);
    }
    const last = await docToScreen(page, 32, 60);
    await page.mouse.dblclick(last.x, last.y);
    b = (await selBounds(page))!;
    expect(Math.round(b.x0)).toBe(5);
    expect(Math.round(b.x1)).toBe(60);
    expect(Math.round(b.y1)).toBe(60);
    // Enter also closes; Esc cancels a polygon in progress
    for (const [x, y] of [[2, 2], [20, 2], [2, 20]]) {
      const q = await docToScreen(page, x, y);
      await page.mouse.click(q.x, q.y);
    }
    await page.keyboard.press('Enter');
    b = (await selBounds(page))!;
    expect(Math.round(b.x1)).toBe(20);

    // magic wand: contiguous red dot at tolerance 32, context bar options
    await tool(page, 'magic-wand');
    await expect(await ctx(page, (r) => r.getByLabel('Tolerance'))).toBeVisible();
    await closeMore(page);
    await expect(await ctx(page, (r) => r.getByLabel('Contiguous'))).toBeChecked();
    await closeMore(page);
    const c = await docToScreen(page, 32, 32);
    await page.mouse.click(c.x, c.y);
    b = (await selBounds(page))!;
    expect(b.x1 - b.x0).toBeGreaterThan(9);
    expect(b.x1 - b.x0).toBeLessThan(16);
    // Shift-click the grey adds it: everything selected
    await page.keyboard.down('Shift');
    const g = await docToScreen(page, 4, 4);
    await page.mouse.click(g.x, g.y);
    await page.keyboard.up('Shift');
    b = (await selBounds(page))!;
    expect(b.x1 - b.x0).toBeGreaterThan(60);
    // tolerance 0 non-contiguous on grey: grey only (the dot is a hole)
    await opts(page, { wandTolerance: 0, wandContiguous: false });
    await page.mouse.click(g.x, g.y);
    expect(await state<number>(page, 'editor.ui.pixelSelection.filter((c) => c[0] === "M").length')).toBe(2);
  });

  test('feather, refine edge (shift edge, output mask), select colour range, save to mask', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    const lay = (await P(page, 'addSolidLayer', '#ffffff')) as string;
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), lay);
    await tool(page, 'marquee-rect');
    await drag(page, await docToScreen(page, 16, 16), await docToScreen(page, 48, 48));
    // Feather dialog from the context bar
    await (await ctx(page, (r) => r.getByRole('button', { name: 'Feather' }))).click();
    await expect(page.getByRole('dialog', { name: 'Feather selection' })).toBeVisible();
    await page.getByLabel('Feather radius', { exact: true }).fill('8');
    await page.getByRole('dialog').getByRole('button', { name: 'Feather' }).click();
    expect(await state<number>(page, 'editor.ui.pixelSelectionFeather')).toBe(8);
    // fill: soft edge, full inside, none far outside
    await ui(page, { fillColor: '#000000' });
    await run(page, 'select.fill');
    const inside = (await P(page, 'layerPixel', lay, 32, 32)) as RGBA;
    const edge = (await P(page, 'layerPixel', lay, 16, 32)) as RGBA;
    const out = (await P(page, 'layerPixel', lay, 4, 32)) as RGBA;
    expect(inside[0]).toBeLessThan(10);
    expect(edge[0]).toBeGreaterThan(60);
    expect(edge[0]).toBeLessThan(200);
    expect(out[0]).toBeGreaterThan(245);

    // Refine edge: shift edge +6 grows the outline; live while dragging, Cancel restores
    const before = (await selBounds(page))!;
    await run(page, 'select.refine');
    const dlg = page.getByRole('dialog', { name: 'Refine edge' });
    await expect(dlg).toBeVisible();
    await page.getByLabel('Shift edge', { exact: true }).fill('6');
    await expect.poll(async () => (await selBounds(page))!.x0).toBeLessThan(before.x0 - 4);
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect((await selBounds(page))!.x0).toBeCloseTo(before.x0, 0);
    await run(page, 'select.refine');
    await page.getByLabel('Shift edge', { exact: true }).fill('-6');
    await page.getByLabel('Smooth', { exact: true }).fill('3');
    await expect.poll(async () => (await selBounds(page))!.x0).toBeGreaterThan(before.x0 + 4);
    await page.getByRole('radio', { name: 'Layer mask' }).click().catch(() => page.getByText('Layer mask').click());
    await page.locator('[data-action="refine-apply"]').click();
    await expect.poll(() => state<boolean>(page, `!!editor.doc.pages[0].nodes.find((n) => n.id === '${lay}').pixelMask`)).toBe(true);

    // colour range on a gradient: highlights only
    await run(page, 'select.none');
    await P(page, 'addPatternLayer', 'gradient');
    await run(page, 'select.color-range');
    const cr = page.getByRole('dialog', { name: 'Select colour range' });
    await expect(cr).toBeVisible();
    await page.locator('#cr-mode').selectOption('highlights');
    await expect.poll(async () => parseFloat((await cr.locator('[data-share]').getAttribute('data-share')) ?? '0')).toBeGreaterThan(0.05);
    const share = parseFloat((await cr.locator('[data-share]').getAttribute('data-share'))!);
    expect(share).toBeLessThan(0.8);
    await page.locator('[data-action="color-range-apply"]').click();
    expect(await state<boolean>(page, '!!editor.ui.pixelSelection')).toBe(true);
    const sb = (await selBounds(page))!;
    expect(sb.x1).toBeGreaterThan(60); // bright = right / bottom of the gradient
  });

  test('brush flow and pen pressure; clone, healing, spot healing, dodge, burn, smudge, eraser', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    await run(page, 'layer.new-pixel');
    const px = await state<string>(page, 'editor.ui.selection[0]');
    await ui(page, { fillColor: '#000000' });
    await opts(page, { brushSize: 16, brushHardness: 1, brushFlow: 0.2, brushOpacity: 1, pressureSize: true });
    await tool(page, 'brush');
    await expect(await ctx(page, (r) => r.getByLabel('Flow', { exact: true }))).toBeVisible();
    await closeMore(page);
    await dab(page, 16, 16);
    const a = ((await P(page, 'layerPixel', px, 16, 16)) as RGBA)[3];
    expect(a).toBeGreaterThan(30);
    expect(a).toBeLessThan(120);
    await opts(page, { brushFlow: 1 });
    await dab(page, 48, 16);
    expect(((await P(page, 'layerPixel', px, 48, 16)) as RGBA)[3]).toBeGreaterThan(240);
    // pressure 0.25 shrinks the tip: 6 px from the centre stays empty
    await P(page, 'setPressure', 0.25);
    await dab(page, 16, 48);
    expect(((await P(page, 'layerPixel', px, 16, 48)) as RGBA)[3]).toBeGreaterThan(200);
    expect(((await P(page, 'layerPixel', px, 22, 48)) as RGBA)[3]).toBe(0);
    await P(page, 'setPressure', null);
    // eraser
    await opts(page, { eraserSize: 20 });
    await tool(page, 'eraser');
    await dab(page, 48, 16);
    expect(((await P(page, 'layerPixel', px, 48, 16)) as RGBA)[3]).toBe(0);

    // clone: Alt-click a source, paint it elsewhere
    const grad = (await P(page, 'addPatternLayer', 'gradient')) as string;
    await opts(page, { retouchSize: 10, brushHardness: 1, brushFlow: 1, brushOpacity: 1, cloneAligned: false });
    await tool(page, 'clone');
    await expect(page.locator('.toolpalette [data-tool="clone"]')).toHaveClass(/active/);
    const src = await docToScreen(page, 8, 32);
    await page.keyboard.down('Alt');
    await page.mouse.click(src.x, src.y);
    await page.keyboard.up('Alt');
    expect(await state<boolean>(page, '!!editor.ui.cloneSource')).toBe(true);
    await dab(page, 56, 32);
    const cl = (await P(page, 'layerPixel', grad, 56, 32)) as RGBA;
    expect(cl[0]).toBeLessThan(60); // x = 8 on the gradient is dark red
    // healing: texture from the source, tone kept
    const before = (await P(page, 'layerPixel', grad, 40, 10)) as RGBA;
    await tool(page, 'heal');
    await dab(page, 40, 10);
    const healed = (await P(page, 'layerPixel', grad, 40, 10)) as RGBA;
    expect(Math.abs(healed[0] - before[0])).toBeLessThan(60);
    expect(await state<string>(page, 'editor.history.list[editor.history.index].label')).toBe('Heal');

    // spot healing removes the red dot
    const dot = (await P(page, 'addPatternLayer', 'dot')) as string;
    await opts(page, { retouchSize: 20 });
    await tool(page, 'spot-heal');
    await dab(page, 32, 32);
    const sp = (await P(page, 'layerPixel', dot, 32, 32)) as RGBA;
    expect(sp[0]).toBeLessThan(160);
    expect(sp[2]).toBeGreaterThan(100);

    // dodge / burn on grey midtones; smudge drags colour
    const grey = (await P(page, 'addSolidLayer', '#808080')) as string;
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), grey);
    await opts(page, { retouchSize: 16, toneRange: 'midtones', toneExposure: 1 });
    await tool(page, 'dodge');
    await dab(page, 16, 16, 18, 16);
    expect(((await P(page, 'layerPixel', grey, 16, 16)) as RGBA)[0]).toBeGreaterThan(150);
    await tool(page, 'burn');
    await dab(page, 48, 48, 50, 48);
    expect(((await P(page, 'layerPixel', grey, 48, 48)) as RGBA)[0]).toBeLessThan(105);
    await tool(page, 'smudge');
    await opts(page, { smudgeStrength: 0.9 });
    await dab(page, 16, 16, 40, 16);
    expect(((await P(page, 'layerPixel', grey, 30, 16)) as RGBA)[0]).toBeGreaterThan(135);
  });

  test('filters with live preview, live filter option, liquify', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    const chk = (await P(page, 'addPatternLayer', 'checker')) as string;
    const orig = (await P(page, 'layerStats', chk)) as { std: number };
    const v0 = ((await P(page, 'viewportPixel', 7.5, 3.5)) as RGBA)[0];
    await run(page, 'filter.gaussian-blur');
    const dlg = page.locator('.dialog.photo-live');
    await expect(dlg).toBeVisible();
    await page.getByLabel('Gaussian Blur Radius (px)', { exact: true }).fill('6');
    // live preview on the canvas before Apply; the layer itself is untouched
    await expect.poll(async () => Math.abs(((await P(page, 'viewportPixel', 7.5, 3.5)) as RGBA)[0] - v0)).toBeGreaterThan(20);
    expect(((await P(page, 'layerStats', chk)) as { std: number }).std).toBeCloseTo(orig.std, 3);
    await page.locator('[data-action="filter-apply"]').click();
    await expect(dlg).toHaveCount(0);
    const blurred = (await P(page, 'layerStats', chk)) as { std: number };
    expect(blurred.std).toBeLessThan(orig.std * 0.7);
    await page.evaluate(() => (window as any).__quvrelo.runCommand('edit.undo'));

    // motion blur, unsharp mask, add noise, reduce noise: each changes the layer, undoably
    for (const [cmd, label, value] of [
      ['filter.motion-blur', 'Motion Blur Distance (px)', '12'],
      ['filter.unsharp-mask', 'Unsharp Mask Amount (%)', '150'],
      ['filter.add-noise', 'Add Noise Amount', '40'],
    ] as const) {
      const assetBefore = await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${chk}').assetId`);
      await run(page, cmd);
      await page.getByLabel(label, { exact: true }).fill(value);
      await page.locator('[data-action="filter-apply"]').click();
      await expect(dlg).toHaveCount(0);
      expect(await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${chk}').assetId`), cmd).not.toBe(assetBefore);
      await page.evaluate(() => (window as any).__quvrelo.runCommand('edit.undo'));
    }
    const noisy = (await P(page, 'addPatternLayer', 'noise')) as string;
    const n0 = (await P(page, 'layerStats', noisy)) as { std: number };
    await run(page, 'filter.reduce-noise');
    await page.getByLabel('Reduce Noise Strength', { exact: true }).fill('100');
    await page.getByLabel('Reduce Noise Preserve detail', { exact: true }).fill('0');
    await page.locator('[data-action="filter-apply"]').click();
    expect(((await P(page, 'layerStats', noisy)) as { std: number }).std).toBeLessThan(n0.std * 0.7);
    // live filter: stays editable in the layer's adjustment stack
    await run(page, 'filter.gaussian-blur');
    await dlg.getByText('Keep as live filter').click();
    await page.locator('[data-action="filter-apply"]').click();
    expect(await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${noisy}').adjustments.map((a) => a.type).join()`)).toBe('blur');

    // liquify: push the checker, Apply in the context bar
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), chk);
    await page.evaluate((id) => {
      const { editor } = (window as any).__quvrelo;
      editor.commit('hide', (d: any) => ({ ...d, pages: d.pages.map((p: any) => ({ ...p, nodes: p.nodes.map((n: any) => (n.id === id ? n : { ...n, visible: false })) })) }));
    }, chk);
    await run(page, 'filter.liquify');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('liquify');
    await expect(page.locator('[data-action="liquify-apply"]')).toBeVisible();
    await opts(page, { liquifySize: 40, liquifyStrength: 1, liquifyMode: 'push' });
    const pre = await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${chk}').assetId`);
    await drag(page, await docToScreen(page, 20, 32), await docToScreen(page, 44, 32), 12);
    // live: the layer is not committed until Apply
    expect(await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${chk}').assetId`)).toBe(pre);
    await page.locator('[data-action="liquify-apply"]').click();
    expect(await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${chk}').assetId`)).not.toBe(pre);
    expect(await state<string>(page, 'editor.history.list[editor.history.index].label')).toBe('Liquify');
  });

  test('straighten (drag a level line), image size with resampling, canvas size with anchor, histogram panel', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page, 120, 80);
    const lay = (await P(page, 'addSolidLayer', '#808080')) as string;
    await tool(page, 'crop');
    await (await ctx(page, (r) => r.locator('[data-action="crop-straighten"]'))).click();
    await closeMore(page);
    expect(await state<boolean>(page, 'editor.ui.toolOptions.cropStraighten')).toBe(true);
    await drag(page, await docToScreen(page, 10, 40), await docToScreen(page, 110, 47), 10);
    const rot = await state<number>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${lay}').rotation`);
    const expected = (-Math.atan2(7, 100) * 180) / Math.PI;
    expect(Math.abs(((rot + 540) % 360) - 180 - expected)).toBeLessThan(0.6);
    const box = await state<{ w: number; h: number }>(page, 'editor.ui.crop');
    expect(box.w).toBeLessThan(120);
    expect(box.w / box.h).toBeCloseTo(1.5, 1);
    await page.locator('[data-action="crop-apply"]').click();
    expect(await state<number>(page, 'editor.doc.settings.width')).toBeLessThan(120);
    // the corners are filled (no transparent wedges): grey everywhere
    const w = await state<number>(page, 'editor.doc.settings.width');
    const h = await state<number>(page, 'editor.doc.settings.height');
    for (const [x, y] of [[0.5, 0.5], [w - 1, h - 1]]) expect(((await P(page, 'renderPixel', x, y)) as RGBA)[0]).toBeLessThan(140);

    // image size: nearest neighbour doubles the pixels of the layer
    await newPhoto(page, 40, 30);
    const g = (await P(page, 'addPatternLayer', 'checker')) as string;
    await run(page, 'doc.resize');
    await page.locator('#resize-resample').selectOption('nearest');
    await page.getByLabel('Width in pixels').fill('80');
    await page.getByRole('dialog').getByRole('button', { name: 'Resize' }).click();
    expect(await state<number>(page, 'editor.doc.settings.height')).toBe(60);
    const assetW = await state<number>(page, `editor.assets.get(editor.doc.pages[0].nodes.find((n) => n.id === '${g}').assetId).width`);
    expect(assetW).toBe(80);
    const px1 = (await P(page, 'layerPixel', g, 14, 0)) as RGBA;
    const px2 = (await P(page, 'layerPixel', g, 15, 0)) as RGBA;
    expect(px1[0]).toBe(px2[0]); // hard pixels doubled
    // canvas size: anchor top-left keeps content where it was
    const x0 = await state<number>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${g}').x`);
    await run(page, 'doc.canvas-size');
    await page.getByLabel('Canvas width in pixels').fill('120');
    await page.getByRole('radio', { name: 'Top left' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Resize canvas' }).click();
    expect(await state<number>(page, 'editor.doc.settings.width')).toBe(120);
    expect(await state<number>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${g}').x`)).toBe(x0);

    // histogram panel: mean of a flat grey layer, layer vs document
    await newPhoto(page, 32, 32);
    await P(page, 'addSolidLayer', '#808080', { x: 0, y: 0, w: 16, h: 32 });
    await page.getByRole('tab', { name: 'Histogram' }).click();
    const stats = page.locator('.histo-stats');
    await expect(stats).toBeVisible();
    await expect.poll(async () => parseFloat((await stats.getAttribute('data-mean')) ?? '0')).toBeCloseTo(128, -1);
    await page.getByRole('radio', { name: 'Document' }).click().catch(() => page.locator('.histo-panel').getByText('Document').click());
    await expect.poll(async () => parseFloat((await stats.getAttribute('data-mean')) ?? '0')).toBeGreaterThan(170); // half white
    const s = (await P(page, 'histogram', 'document')) as { mean: number; pixels: number };
    expect(s.pixels).toBeGreaterThan(0);
  });
});
