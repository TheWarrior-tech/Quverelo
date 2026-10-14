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
      // seed Recent with real saved files so the start screen shows thumbnails
      for (const t of ['newsletter', 'poster-a4', 'certificate', 'worksheet']) {
        await page.click(`[data-template="${t}"]`);
        await expect(page.locator('.workspace')).toBeVisible();
        await run(page, 'file.save');
        await page.waitForTimeout(400);
        await run(page, 'file.close');
        await expect(page.locator('.welcome')).toBeVisible();
      }
      await page.mouse.move(2, 2);
      await page.waitForTimeout(3600); // let the "Saved" toasts clear
      await snap('welcome');
      await page.locator('.welcome').evaluate((el) => el.scrollTo(0, 640));
      await snap('welcome-templates');
      await page.locator('.welcome').evaluate((el) => el.scrollTo(0, 0));
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
      await page.click('.studio-switch [data-studio="layout"]');
      await page.waitForTimeout(300);
      await snap('layout');
      const dialogs: [string, string, ((p: typeof page) => Promise<void>)?][] = [
        ['app.preferences', 'preferences'],
        ['app.preferences', 'preferences-general', (p) => p.click('[data-pane="general"]')],
        ['file.export-png', 'export'],
        ['file.export-pdf', 'export-pdf'],
        ['help.shortcuts', 'shortcuts'],
        ['help.shortcuts', 'shortcuts-search', (p) => p.keyboard.type('export')],
        ['file.new', 'new'],
        ['file.new', 'new-templates', (p) => p.click('[data-category="templates"]')],
        ['help.about', 'about'],
        ['file.document-setup', 'document-setup'],
        ['file.close', 'confirm'],
      ];
      for (const [cmd, name, act] of dialogs) {
        await run(page, cmd);
        await page.waitForTimeout(300);
        if (act) await act(page);
        await page.mouse.move(2, 2);
        await page.waitForTimeout(500);
        // initial focus must never land on the close button
        expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).not.toBe('Close');
        await snap(name);
        await page.keyboard.press('Escape');
        await expect(page.locator('.dialog')).toHaveCount(0);
      }
      await app.close();
    });
  }
});
