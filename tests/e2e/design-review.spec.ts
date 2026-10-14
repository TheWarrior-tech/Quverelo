/**
 * Design-review captures: every key screen in dark, light and high-contrast.
 *   QUVRELO_REVIEW_DIR=docs/design/review xvfb-run -a npx playwright test design-review
 */
import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { docToScreen, drag, launch, run } from './helpers';

const out = process.env.QUVRELO_REVIEW_DIR;
const photo = path.resolve('tests/fixtures/sample-photo.jpg');
const themes = ['dark', 'light', 'high-contrast'] as const;

test.describe('design review', () => {
  test.skip(!out, 'set QUVRELO_REVIEW_DIR');
  for (const theme of themes) {
    test(`screens in ${theme}`, async () => {
      const { app, page } = await launch({ QUVRELO_E2E_OPEN: photo });
      const setTheme = () => run(page, theme === 'dark' ? 'view.theme-dark' : theme === 'light' ? 'view.theme-light' : 'view.theme-contrast');
      const snap = async (name: string) => {
        await setTheme();
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(out!, `${theme}-${name}.png`) });
      };
      await setTheme();
      await snap('welcome');
      await run(page, 'file.open');
      await expect(page.locator('.workspace')).toBeVisible();
      await page.evaluate(() => {
        const { editor } = (window as any).__quvrelo;
        editor.select([editor.doc.pages[0].nodes[0].id]);
      });
      for (const a of ['vibrance', 'curves']) await page.locator('select[aria-label="Add adjustment"]').selectOption(a);
      await page.click('[data-tool="marquee-ellipse"]');
      await drag(page, await docToScreen(page, 700, 330), await docToScreen(page, 1000, 560));
      await snap('photo');
      await page.click('.studio-switch [data-studio="vector"]');
      await page.click('[data-tool="star"]');
      await drag(page, { x: 400, y: 300 }, { x: 560, y: 440 });
      await page.click('[data-tool="rect"]');
      await drag(page, { x: 640, y: 320 }, { x: 800, y: 420 });
      await snap('vector');
      await page.click('[data-panel="colour"]');
      await page.locator('.layer-row').first().hover();
      await snap('colour');
      await page.click('[data-panel="properties"]');
      await page.click('.contextbar .chip-select >> nth=0');
      await snap('colour-popover');
      await page.keyboard.press('Escape');
      await page.click('.studio-switch [data-studio="layout"]');
      await page.waitForTimeout(300);
      await snap('layout');
      for (const [cmd, name] of [['app.preferences', 'preferences'], ['file.export-png', 'export'], ['help.shortcuts', 'shortcuts'], ['file.new', 'new']] as const) {
        await run(page, cmd);
        await page.waitForTimeout(300);
        await snap(name);
        await page.keyboard.press('Escape');
      }
      await app.close();
    });
  }
});
