/**
 * Review captures for the Photo parity UI in dark, light and high contrast:
 * Adjust panel with an adjustment layer, a filter dialog with live preview,
 * Refine edge, Select colour range, the Histogram panel, the retouch context
 * bar, Canvas size, the Layers "+" menu and the group blend (Pass through).
 *   QUVRELO_REVIEW_DIR=/tmp/photo-review xvfb-run -a npx playwright test photo-review
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { docToScreen, drag, launch, run, type Launched } from './helpers';

const out = process.env.QUVRELO_REVIEW_DIR;
const photo = path.resolve('tests/fixtures/sample-photo.jpg');
const themes = ['dark', 'light', 'high-contrast'] as const;
type Theme = (typeof themes)[number];
const themeCmd = (t: Theme) => (t === 'dark' ? 'view.theme-dark' : t === 'light' ? 'view.theme-light' : 'view.theme-contrast');

async function snap(page: Page, theme: Theme, name: string, settle = 300) {
  await page.waitForTimeout(settle);
  fs.mkdirSync(out!, { recursive: true });
  await page.screenshot({ path: path.join(out!, `${theme}-${name}.png`) });
}

async function openPhoto(page: Page, theme: Theme) {
  await run(page, themeCmd(theme));
  await run(page, 'file.open');
  await expect(page.locator('.workspace')).toBeVisible();
  const id = await page.evaluate(() => (window as any).__quvrelo.editor.doc.pages[0].nodes[0].id);
  await page.evaluate((i) => (window as any).__quvrelo.editor.select([i]), id);
  await page.waitForTimeout(3500); // let the Opened toast go
  return id as string;
}

const esc = async (page: Page) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
};

test.describe('photo review captures', () => {
  test.skip(!out, 'set QUVRELO_REVIEW_DIR');
  let L: Launched | null = null;
  test.afterEach(async () => {
    await L?.app.close();
    L = null;
  });

  for (const theme of themes) {
    test(`photo parity UI in ${theme}`, async () => {
      L = await launch({ QUVRELO_E2E_OPEN: photo });
      const { page } = L;
      const base = await openPhoto(page, theme);

      // Layers "+" menu with adjustment layers
      await page.getByRole('tab', { name: 'Layers' }).click().catch(() => {});
      await page.locator('.layer-actions .layer-add').click();
      await expect(page.getByRole('menu', { name: 'Add layer' })).toBeVisible();
      await snap(page, theme, 'layers-add-menu');
      await esc(page);

      // Adjust panel with a Curves adjustment layer selected
      await run(page, 'layer.adjust-curves');
      await page.getByRole('tab', { name: 'Adjust' }).click();
      await snap(page, theme, 'adjust-panel');
      await run(page, 'edit.undo');
      await page.evaluate((i) => (window as any).__quvrelo.editor.select([i]), base);

      // Histogram panel
      await page.getByRole('tab', { name: 'Histogram' }).click();
      await expect(page.locator('.histo-stats')).toBeVisible();
      await snap(page, theme, 'histogram');

      // filter dialog with live preview
      await run(page, 'filter.gaussian-blur');
      await expect(page.getByRole('dialog')).toBeVisible();
      await snap(page, theme, 'filter-dialog', 600);
      await esc(page);

      // selection, Refine edge, Select colour range
      await page.evaluate(() => (window as any).__quvrelo.editor.setTool('marquee-ellipse'));
      const c = await page.evaluate(() => (window as any).__quvrelo.editor.doc.settings);
      await drag(page, await docToScreen(page, c.width * 0.3, c.height * 0.3), await docToScreen(page, c.width * 0.7, c.height * 0.7));
      await run(page, 'select.refine');
      await expect(page.getByRole('dialog', { name: 'Refine edge' })).toBeVisible();
      await page.getByLabel('Feather', { exact: true }).fill('20');
      await snap(page, theme, 'refine-edge', 600);
      await esc(page);
      await run(page, 'select.color-range');
      await expect(page.getByRole('dialog', { name: 'Select colour range' })).toBeVisible();
      await snap(page, theme, 'color-range', 800);
      await esc(page);
      await run(page, 'select.none');

      // retouch context bar (clone, then dodge)
      await page.evaluate(() => (window as any).__quvrelo.editor.setTool('clone'));
      await page.mouse.move(10, 10);
      await snap(page, theme, 'retouch-clone');
      await page.evaluate(() => (window as any).__quvrelo.editor.setTool('dodge'));
      await snap(page, theme, 'retouch-dodge');
      await page.evaluate(() => (window as any).__quvrelo.editor.setTool('move'));

      // canvas size
      await run(page, 'doc.canvas-size');
      await expect(page.getByRole('dialog')).toBeVisible();
      await snap(page, theme, 'canvas-size');
      await esc(page);

      // group blend: Pass through
      await run(page, 'layer.new-pixel');
      const ids = await page.evaluate(() => (window as any).__quvrelo.editor.doc.pages[0].nodes.map((n: any) => n.id));
      await page.evaluate((x) => (window as any).__quvrelo.editor.select(x), ids);
      await run(page, 'arrange.group');
      await page.getByRole('tab', { name: 'Design' }).click();
      await expect(page.locator('#prop-blend')).toHaveValue('pass-through');
      await snap(page, theme, 'group-blend');
    });
  }
});
