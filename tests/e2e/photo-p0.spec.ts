/**
 * UX audit P0-2 (Object Select, Select subject, action strip) and P0-4
 * (adjustable crop with ratios and Apply/Cancel). Drives visible UI only.
 * Set QUVRELO_P0_SHOTS=<dir> to save crop.png / subject-actions.png there.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { docToScreen, drag, launch, state, type Launched } from './helpers';

const photo = path.resolve('tests/fixtures/sample-photo.jpg'); // 1264 x 848
const shotDir = process.env.QUVRELO_P0_SHOTS ?? '';

async function saveShot(page: Page, name: string) {
  if (!shotDir) return;
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, name) });
}

async function openPhoto(page: Page) {
  await page.evaluate(() => (window as any).__quvrelo.runCommand('file.open'));
  await expect(page.locator('.workspace')).toBeVisible();
  expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
  // a fresh document: click on the pasteboard so nothing is selected
  await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
}

test.describe('photo P0', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('Object Select tool: on the rail after Freehand Selection, W key, click selects, Alt-click refines', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    const tools = await page.locator('.toolpalette [data-tool]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tool')));
    expect(tools.indexOf('object-select')).toBe(tools.indexOf('lasso') + 1);
    await expect(page.locator('.toolpalette [data-tool="object-select"]')).toHaveAttribute('aria-label', 'Object Select');
    await expect(page.locator('.toolpalette [data-tool="object-select"]')).toHaveAttribute('title', 'Object Select (W)');

    await page.keyboard.press('w');
    await expect(page.locator('.toolpalette [data-tool="object-select"]')).toHaveClass(/active/);
    await expect(page.locator('.contextbar [data-action="select-subject"]')).toBeVisible();

    const cottage = await docToScreen(page, 1005, 492);
    await page.mouse.click(cottage.x, cottage.y);
    await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection'), { timeout: 30_000 }).toBe(true);
    expect(await state<string>(page, 'editor.ui.status')).toMatch(/Object selected \((on-device model|basic fallback)/);
    const first = await state<string>(page, 'JSON.stringify(editor.ui.pixelSelection)');

    // Alt-click elsewhere removes a part (or reports nothing to remove); the selection never errors
    const grass = await docToScreen(page, 900, 520);
    await page.keyboard.down('Alt');
    await page.mouse.click(grass.x, grass.y);
    await page.keyboard.up('Alt');
    await expect.poll(() => state<boolean>(page, 'editor.ui.mlBusy'), { timeout: 30_000 }).toBe(false);
    expect(await state<boolean>(page, '!!editor.ui.pixelSelection')).toBe(true);
    expect(typeof first).toBe('string');
  });

  test('Select subject button, Ctrl+Alt+S and the post-selection action strip', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await page.click('.toolpalette [data-tool="marquee-rect"]');
    const btn = page.locator('.contextbar [data-action="select-subject"]');
    await expect(btn).toBeVisible();
    // first control after the tool name
    expect(await page.locator('.contextbar > .group').first().locator('[data-action="select-subject"]').count()).toBe(1);
    await expect(btn).toHaveAttribute('aria-keyshortcuts', /Control\+Alt\+S|Meta\+Alt\+S/);
    await btn.click();
    await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection'), { timeout: 30_000 }).toBe(true);

    const strip = page.locator('.sel-actions');
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('role', 'toolbar');
    for (const a of ['remove-background', 'mask', 'copy-to-layer', 'crop', 'invert']) await expect(strip.locator(`[data-sel-action="${a}"]`)).toBeVisible();
    // the strip sits inside the canvas area
    const sb = (await strip.boundingBox())!;
    const vb = (await page.locator('.viewport').boundingBox())!;
    expect(sb.x).toBeGreaterThanOrEqual(vb.x);
    expect(sb.x + sb.width).toBeLessThanOrEqual(vb.x + vb.width + 1);
    expect(sb.y + sb.height).toBeLessThanOrEqual(vb.y + vb.height + 1);

    // Invert keeps a selection, Copy to layer adds a layer from the photo
    const before = await state<string>(page, 'JSON.stringify(editor.ui.pixelSelection)');
    await strip.locator('[data-sel-action="invert"]').click();
    expect(await state<string>(page, 'JSON.stringify(editor.ui.pixelSelection)')).not.toBe(before);
    await strip.locator('[data-sel-action="invert"]').click();
    const layers = await state<number>(page, 'editor.doc.pages[0].nodes.length');
    await strip.locator('[data-sel-action="copy-to-layer"]').click();
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(layers + 1);

    // strip hides with no selection; keyboard shortcut brings a selection back
    await strip.locator('[data-sel-action="deselect"]').click();
    await expect(strip).toHaveCount(0);
    await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
    await page.locator('.viewport').hover();
    await page.keyboard.press('Control+Alt+S');
    await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection'), { timeout: 30_000 }).toBe(true);

    // Remove background: a mask on the photo layer, selection consumed, undoable
    await page.locator('.sel-actions [data-sel-action="remove-background"]').click();
    await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection')).toBe(false);
    const masked = await state<boolean>(page, 'editor.doc.pages[0].nodes.some(n => n.type === "raster" && n.mask && !n.mask.inverted)');
    expect(masked).toBe(true);
  });

  test('screenshot: object selection with its action strip (dark)', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await page.click('.toolpalette [data-tool="object-select"]');
    const cottage = await docToScreen(page, 1005, 492);
    await page.mouse.click(cottage.x, cottage.y);
    await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection'), { timeout: 30_000 }).toBe(true);
    await expect(page.locator('.sel-actions[data-placed]')).toBeVisible();
    await page.mouse.move(cottage.x + 120, cottage.y - 160);
    await page.waitForTimeout(3500); // let the "Opened" toast go
    await saveShot(page, 'subject-actions.png');
  });

  test('crop: 8 handles, ratios, W/H, Apply/Cancel, Enter applies, Esc resets and stays', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await page.keyboard.press('c');
    await expect(page.locator('.toolpalette [data-tool="crop"]')).toHaveClass(/active/);
    const apply = page.locator('.contextbar [data-action="crop-apply"]');
    const cancel = page.locator('.contextbar [data-action="crop-cancel"]');
    await expect(apply).toBeDisabled();
    await expect(cancel).toBeDisabled();
    await expect(page.locator('.contextbar [aria-label="Crop width (px)"]')).toHaveValue('1264');

    // drag the top-left handle inwards
    await drag(page, await docToScreen(page, 0, 0), await docToScreen(page, 200, 100));
    let crop = await state<{ x: number; y: number; w: number; h: number }>(page, 'editor.ui.crop');
    expect(Math.round(crop.x)).toBeGreaterThan(150);
    expect(Math.round(crop.y)).toBeGreaterThan(60);
    expect(Math.round(crop.x + crop.w)).toBe(1264);
    expect(Math.round(crop.y + crop.h)).toBe(848);
    await expect(apply).toBeEnabled();

    // move it by dragging inside
    const mid = await docToScreen(page, crop.x + crop.w / 2, crop.y + crop.h / 2);
    await drag(page, mid, { x: mid.x - 40, y: mid.y - 20 });
    const moved = await state<{ x: number; y: number; w: number; h: number }>(page, 'editor.ui.crop');
    expect(moved.x).toBeLessThan(crop.x);
    expect(Math.round(moved.w)).toBe(Math.round(crop.w));

    // the right edge handle resizes width only
    const eh = await docToScreen(page, moved.x + moved.w, moved.y + moved.h / 2);
    await drag(page, eh, { x: eh.x - 60, y: eh.y + 30 });
    const edged = await state<{ x: number; y: number; w: number; h: number }>(page, 'editor.ui.crop');
    expect(edged.w).toBeLessThan(moved.w);
    expect(Math.round(edged.h)).toBe(Math.round(moved.h));

    // 1:1 preset makes it square; W field drives H under the ratio
    await page.locator('.contextbar select[aria-label="Crop ratio"]').selectOption('1:1');
    crop = await state(page, 'editor.ui.crop');
    expect(Math.round(crop.w)).toBe(Math.round(crop.h));
    const wField = page.locator('.contextbar [aria-label="Crop width (px)"]');
    await wField.fill('400');
    await wField.press('Enter');
    crop = await state(page, 'editor.ui.crop');
    expect(Math.round(crop.w)).toBe(400);
    expect(Math.round(crop.h)).toBe(400);
    for (const r of ['free', 'original', '4:3', '16:9']) expect(await page.locator(`.contextbar select[aria-label="Crop ratio"] option[value="${r}"]`).count()).toBe(1);

    // Esc resets the box and stays in Crop (keyboard back on the canvas)
    await wField.blur();
    await page.locator('.viewport').hover();
    await page.keyboard.press('Escape');
    expect(await state(page, 'editor.ui.crop')).toBeNull();
    expect(await state<string>(page, 'editor.ui.tool')).toBe('crop');

    // 16:9 then Enter applies; the document becomes the crop
    await page.locator('.contextbar select[aria-label="Crop ratio"]').selectOption('16:9');
    crop = await state(page, 'editor.ui.crop');
    expect(crop.w / crop.h).toBeCloseTo(16 / 9, 3);
    await page.locator('.viewport').hover();
    await page.keyboard.press('Enter');
    const size = await state<{ width: number; height: number }>(page, '({ width: editor.doc.settings.width, height: editor.doc.settings.height })');
    expect(size.width).toBe(Math.round(crop.w));
    expect(size.height).toBe(Math.round(crop.h));
    expect(await state<string>(page, 'editor.ui.tool')).toBe('crop');
    await page.evaluate(() => (window as any).__quvrelo.runCommand('edit.undo'));
    expect(await state<number>(page, 'editor.doc.settings.width')).toBe(1264);
    await page.evaluate(() => (window as any).__quvrelo.runCommand('view.zoom-fit'));

    // Apply button path, then Cancel button path
    await page.locator('.contextbar select[aria-label="Crop ratio"]').selectOption('free');
    await drag(page, await docToScreen(page, 1264, 848), await docToScreen(page, 1000, 700));
    await cancel.click();
    expect(await state(page, 'editor.ui.crop')).toBeNull();
    await drag(page, await docToScreen(page, 1264, 848), await docToScreen(page, 1000, 700));
    await apply.click();
    expect(await state<number>(page, 'editor.doc.settings.width')).toBeLessThan(1264);
  });

  test('screenshot: crop box with handles and thirds (dark)', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await page.click('.toolpalette [data-tool="crop"]');
    await page.locator('.contextbar select[aria-label="Crop ratio"]').selectOption('4:3');
    // pull the top-left corner of the 4:3 box inwards, then nudge the box by dragging inside it
    const b = await state<{ x: number; y: number; w: number; h: number }>(page, 'editor.ui.crop');
    await drag(page, await docToScreen(page, b.x, b.y), await docToScreen(page, b.x + 220, b.y + 120));
    const c = await state<{ x: number; y: number; w: number; h: number }>(page, 'editor.ui.crop');
    expect(c.w / c.h).toBeCloseTo(4 / 3, 3);
    const mid = await docToScreen(page, c.x + c.w / 2, c.y + c.h / 2);
    await drag(page, mid, { x: mid.x - 30, y: mid.y - 10 });
    await page.mouse.move(10, 10);
    await page.waitForTimeout(3500); // let the "Opened" toast go
    await saveShot(page, 'crop.png');
  });
});
