/**
 * Review captures for the focused states the design critique looks at, in dark, light and
 * high-contrast: crop, Object Select with its action strip, command palette, tooltip, tool
 * flyout, empty canvas, Export (vector PDF) and Curves. Complements design-review.spec.ts
 * (whole screens and dialogs) and writes into the same folder.
 *   QUVRELO_REVIEW_DIR=docs/design/review xvfb-run -a npx playwright test review-captures
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { docToScreen, drag, launch, run, state, type Launched } from './helpers';

const out = process.env.QUVRELO_REVIEW_DIR;
const photo = path.resolve('tests/fixtures/sample-photo.jpg');
const themes = ['dark', 'light', 'high-contrast'] as const;
type Theme = (typeof themes)[number];
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const themeCmd = (t: Theme) => (t === 'dark' ? 'view.theme-dark' : t === 'light' ? 'view.theme-light' : 'view.theme-contrast');

async function snap(page: Page, theme: Theme, name: string, settle = 250) {
  await page.waitForTimeout(settle);
  fs.mkdirSync(out!, { recursive: true });
  await page.screenshot({ path: path.join(out!, `${theme}-${name}.png`) });
}

/** the Opened / Saved toasts sit over the canvas for ~3s */
const clearToasts = (page: Page) => page.waitForTimeout(3500);

async function openPhoto(page: Page, theme: Theme) {
  await run(page, themeCmd(theme));
  await run(page, 'file.open');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
}

async function newDoc(page: Page, theme: Theme, template: string) {
  await run(page, themeCmd(theme));
  await page.click(`[data-template="${template}"]`);
  await expect(page.locator('.workspace')).toBeVisible();
}

test.describe('review captures', () => {
  test.skip(!out, 'set QUVRELO_REVIEW_DIR');
  let L: Launched | null = null;
  test.afterEach(async () => {
    await L?.app.close();
    L = null;
  });

  for (const theme of themes) {
    test(`crop in ${theme}`, async () => {
      L = await launch({ QUVRELO_E2E_OPEN: photo });
      const { page } = L;
      await openPhoto(page, theme);
      await page.click('.toolpalette [data-tool="crop"]');
      await page.locator('.contextbar select[aria-label="Crop ratio"]').selectOption('4:3');
      const b = await state<{ x: number; y: number; w: number; h: number }>(page, 'editor.ui.crop');
      await drag(page, await docToScreen(page, b.x, b.y), await docToScreen(page, b.x + 220, b.y + 120));
      const c = await state<{ x: number; y: number; w: number; h: number }>(page, 'editor.ui.crop');
      const mid = await docToScreen(page, c.x + c.w / 2, c.y + c.h / 2);
      await drag(page, mid, { x: mid.x - 30, y: mid.y - 10 });
      await page.mouse.move(10, 10);
      await clearToasts(page);
      await snap(page, theme, 'crop');
    });

    test(`object select action strip in ${theme}`, async () => {
      L = await launch({ QUVRELO_E2E_OPEN: photo });
      const { page } = L;
      await openPhoto(page, theme);
      await page.click('.toolpalette [data-tool="object-select"]');
      const cottage = await docToScreen(page, 1005, 492);
      await page.mouse.click(cottage.x, cottage.y);
      await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection'), { timeout: 30_000 }).toBe(true);
      await expect(page.locator('.sel-actions[data-placed]')).toBeVisible();
      await page.mouse.move(cottage.x + 120, cottage.y - 160);
      await clearToasts(page);
      await snap(page, theme, 'object-select');
    });

    test(`palette and tooltip in ${theme}`, async () => {
      L = await launch();
      const { page } = L;
      await newDoc(page, theme, 'poster-a4');
      await page.keyboard.press(`${MOD}+k`);
      const input = page.getByRole('combobox', { name: /search commands/i });
      await expect(input).toBeFocused();
      await input.fill('exp');
      await snap(page, theme, 'palette');
      await page.keyboard.press('Escape');
      await expect(page.locator('.cmdk')).toBeHidden();
      await page.mouse.move(700, 450);
      await page.locator('button[data-tool="rect"]').hover();
      await expect(page.getByRole('tooltip')).toBeVisible();
      await snap(page, theme, 'tooltip');
    });

    test(`tool flyout in ${theme}`, async () => {
      L = await launch();
      const { page } = L;
      await newDoc(page, theme, 'blank-a4');
      await run(page, 'studio.vector');
      await page.locator('.toolpalette [data-group="vector-shapes"]').click({ button: 'right' });
      await expect(page.getByRole('menu', { name: 'Shape tools' })).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await snap(page, theme, 'flyout', 300);
    });

    test(`empty canvas in ${theme}`, async () => {
      L = await launch();
      const { page } = L;
      await run(page, themeCmd(theme));
      await page.locator('[data-start="layout"]').click();
      await page.getByTestId('create-document').click();
      await expect(page.getByTestId('canvas-empty')).toBeVisible();
      await page.mouse.move(2, 2);
      await snap(page, theme, 'empty-canvas', 600);
    });

    test(`export vector pdf in ${theme}`, async () => {
      L = await launch();
      const { page } = L;
      await newDoc(page, theme, 'newsletter');
      await page.waitForTimeout(400);
      await run(page, 'file.export-pdf');
      await expect(page.locator('[data-format="pdf"]')).toHaveAttribute('aria-selected', 'true');
      await page.mouse.move(2, 2);
      await snap(page, theme, 'export-pdf-vector', 500);
    });

    test(`curves in ${theme}`, async () => {
      L = await launch({ QUVRELO_E2E_OPEN: photo });
      const { page } = L;
      await openPhoto(page, theme);
      await page.evaluate(() => {
        const { editor } = (window as any).__quvrelo;
        editor.select([editor.doc.pages[0].nodes[0].id]);
      });
      await page.locator('select[aria-label="Add adjustment"]').selectOption('curves');
      const graph = page.locator('.curves-graph');
      await expect(graph).toBeVisible();
      await graph.scrollIntoViewIfNeeded();
      const box = (await graph.boundingBox())!;
      const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await drag(page, mid, { x: mid.x, y: mid.y - box.height * 0.2 }, 6);
      await page.mouse.move(box.x + box.width + 40, box.y);
      await clearToasts(page);
      await snap(page, theme, 'curves');
    });
  }
});
