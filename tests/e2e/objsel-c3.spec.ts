/**
 * Critique 3: N0 (Object Select on the cottage must select the cottage, not the hillside) and
 * N10 (crop handles and the Object Select click marker follow the theme's canvas-handle tokens).
 * Uses the same click as the review frame (review-captures.spec.ts): document point (1005, 492).
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { docToScreen, drag, launch, run, state, type Launched } from './helpers';

const photo = path.resolve('tests/fixtures/sample-photo.jpg'); // 1264 x 848
/** hand-traced cottage bbox in photo (= document) pixels, see tests/unit/mlObjectSelect.test.ts */
const COTTAGE = { x0: 964, y0: 456.7, x1: 1050.8, y1: 521.7 };

async function overlayNear(page: Page, rgb: [number, number, number]) {
  return page.evaluate((c) => {
    const el = document.querySelector('.viewport-overlay') as HTMLCanvasElement;
    const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      if (Math.abs(d[i] - c[0]) < 24 && Math.abs(d[i + 1] - c[1]) < 24 && Math.abs(d[i + 2] - c[2]) < 24) n++;
    }
    return n;
  }, rgb);
}

async function openPhoto(page: Page) {
  await run(page, 'file.open');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
}

/** bbox of the pixel selection path, in document coordinates */
async function selectionBox(page: Page) {
  return page.evaluate(() => {
    const sel = (window as any).__quvrelo.editor.ui.pixelSelection as (string | number)[][];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of sel) {
      const nums = c.slice(1) as number[];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]);
        y0 = Math.min(y0, nums[i + 1]); y1 = Math.max(y1, nums[i + 1]);
      }
    }
    return { x0, y0, x1, y1 };
  });
}

test.describe('critique 3: Object Select and canvas handle tokens', () => {
  let L: Launched | null = null;
  test.afterEach(async () => {
    await L?.app.close();
    L = null;
  });

  test('N0: a click on the cottage selects the cottage tightly (on-device model)', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await page.click('.toolpalette [data-tool="object-select"]');
    const cottage = await docToScreen(page, 1005, 492);
    await page.mouse.click(cottage.x, cottage.y);
    await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection'), { timeout: 30_000 }).toBe(true);
    const status = await state<string>(page, 'editor.ui.status');
    console.log(`[objsel] ${status}`);
    expect(status).toContain('on-device model');
    const b = await selectionBox(page);
    // within 10 doc px of the traced cottage on every side (the old blob was ~275 x 240 px)
    expect(b.x0).toBeGreaterThan(COTTAGE.x0 - 10);
    expect(b.y0).toBeGreaterThan(COTTAGE.y0 - 10);
    expect(b.x1).toBeLessThan(COTTAGE.x1 + 10);
    expect(b.y1).toBeLessThan(COTTAGE.y1 + 10);
    expect(b.x1 - b.x0).toBeGreaterThan(0.8 * (COTTAGE.x1 - COTTAGE.x0));
    expect(b.y1 - b.y0).toBeGreaterThan(0.8 * (COTTAGE.y1 - COTTAGE.y0));
  });

  test('N10: in high contrast the click marker and the crop handles are yellow, not teal', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await run(page, 'view.theme-contrast');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
    await openPhoto(page);
    await page.click('.toolpalette [data-tool="object-select"]');
    const cottage = await docToScreen(page, 1005, 492);
    await page.mouse.click(cottage.x, cottage.y);
    await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection'), { timeout: 30_000 }).toBe(true);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    // the marker is a 9 px yellow dot on a black ring; no teal anywhere in the overlay
    expect(await overlayNear(page, [255, 212, 0])).toBeGreaterThan(20);
    expect(await overlayNear(page, [47, 184, 166])).toBe(0);

    await page.evaluate(() => (window as any).__quvrelo.editor.setUi({ pixelSelection: null }));
    await page.click('.toolpalette [data-tool="crop"]');
    // drag the top-left handle inwards, as the crop e2e does
    await drag(page, await docToScreen(page, 0, 0), await docToScreen(page, 200, 120));
    await expect.poll(() => state<boolean>(page, '!!editor.ui.crop')).toBe(true);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    expect(await overlayNear(page, [255, 212, 0])).toBeGreaterThan(150);
    expect(await overlayNear(page, [47, 184, 166])).toBe(0);
  });

  test('N10: in dark the crop handles and the marker use the accent handle token', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await run(page, 'view.theme-dark');
    await openPhoto(page);
    await page.click('.toolpalette [data-tool="crop"]');
    // drag the top-left handle inwards, as the crop e2e does
    await drag(page, await docToScreen(page, 0, 0), await docToScreen(page, 200, 120));
    await expect.poll(() => state<boolean>(page, '!!editor.ui.crop')).toBe(true);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    expect(await overlayNear(page, [47, 184, 166])).toBeGreaterThan(150);
  });
});
