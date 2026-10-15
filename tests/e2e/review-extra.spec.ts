/**
 * Review captures, part 3 (critique 4 evidence): the states the critique could not see in
 * the whole-screen captures, plus 150 % and 200 % device-scale screens. All three themes.
 * Writes into the same folder as design-review.spec.ts and review-captures.spec.ts:
 *   QUVRELO_REVIEW_DIR=docs/design/review xvfb-run -a npx playwright test review-extra
 *
 * Frames (<theme>-<name>.png): layers, font-picker, assets, layers-add-menu,
 * photo-appearance, photo-shapes-flyout, welcome-checklist, layout-mm, layout-mm-selected
 * (text selected, inspector Text section), layout-mm-document-setup, layout-mm-export-pdf,
 * preferences-general-window; and <theme>-<photo|vector|layout|welcome>@150.png / @200.png.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { docToScreen, drag, launch, pickTool, run, type Launched } from './helpers';

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

/** "Opened" / "Saved" toasts sit over the canvas for ~3 s */
const clearToasts = (page: Page) => page.waitForTimeout(3500);

async function poster(page: Page, theme: Theme, studio: 'photo' | 'vector' | 'layout' = 'layout') {
  await run(page, themeCmd(theme));
  await page.click('[data-template="poster-a4"]');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.click(`.studio-switch [data-studio="${studio}"]`);
  await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
}

/** id of the first text node on the first page (artistic or frame text) */
async function firstTextId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const { editor } = (window as any).__quvrelo;
    const walk = (nodes: any[]): any => {
      for (const n of nodes) {
        if (n.type === 'text' || n.type === 'textframe') return n;
        if (n.type === 'group') {
          const f = walk(n.children);
          if (f) return f;
        }
      }
      return null;
    };
    return walk(editor.doc.pages[0].nodes)?.id;
  });
}

async function openTab(page: Page, id: string) {
  await page.click(`[data-panel="${id}"]`);
  await expect(page.locator(`[data-panel="${id}"]`)).toHaveAttribute('aria-selected', 'true');
}

test.describe('review captures (extra)', () => {
  test.skip(!out, 'set QUVRELO_REVIEW_DIR');
  let L: Launched | null = null;
  test.afterEach(async () => {
    await L?.app.close();
    L = null;
  });

  for (const theme of themes) {
    test(`layout, layers, assets and text in ${theme}`, async () => {
      L = await launch();
      const { page } = L;
      await poster(page, theme);
      await page.mouse.move(1290, 720);
      await clearToasts(page);
      expect(await page.evaluate(() => (window as any).__quvrelo.editor.unit)).toBe('mm');
      await snap(page, theme, 'layout-mm');

      // Layers populated and unobstructed: no tooltip, no hover, no popover over the rows
      await openTab(page, 'layers');
      await page.mouse.move(1290, 720); // blank inspector: no canvas hover outline, no tooltip
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      expect(await page.locator('.layer-row').count()).toBeGreaterThan(3);
      await snap(page, theme, 'layers');

      // Layers + menu
      await page.click('.layer-add');
      await expect(page.getByRole('menu', { name: 'Add layer' })).toBeVisible();
      await snap(page, theme, 'layers-add-menu');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu', { name: 'Add layer' })).toBeHidden();

      // Assets tab
      await openTab(page, 'assets');
      await page.mouse.move(1290, 720); // blank inspector: no canvas hover outline, no tooltip
      await snap(page, theme, 'assets');
      await openTab(page, 'layers');

      // a text layer selected: inspector Text section in view
      const id = await firstTextId(page);
      expect(id).toBeTruthy();
      await page.evaluate((i) => (window as any).__quvrelo.editor.select([i]), id);
      await openTab(page, 'properties');
      const text = page.locator('.section[data-section="text"]');
      await expect(text).toBeVisible();
      await text.scrollIntoViewIfNeeded();
      await page.mouse.move(1290, 720); // blank inspector: no canvas hover outline, no tooltip
      await snap(page, theme, 'layout-mm-selected');

      // font picker open (from the inspector's Text section)
      await text.locator('.font-trigger').first().click();
      await expect(page.locator('.font-trigger.open')).toBeVisible();
      await snap(page, theme, 'font-picker');
      await page.keyboard.press('Escape');

      await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
      await run(page, 'file.document-setup');
      await expect(page.locator('.dialog')).toBeVisible();
      await page.mouse.move(2, 2);
      await snap(page, theme, 'layout-mm-document-setup', 500);
      await page.keyboard.press('Escape');
      await run(page, 'file.export-pdf');
      await expect(page.locator('.dialog')).toBeVisible();
      await page.mouse.move(2, 2);
      await snap(page, theme, 'layout-mm-export-pdf', 500);
      await page.keyboard.press('Escape');
      await run(page, 'app.preferences');
      await page.click('[data-pane="general"]');
      await page.mouse.move(2, 2);
      await snap(page, theme, 'preferences-general-window', 500);
      await page.keyboard.press('Escape');
    });

    test(`photo appearance and shapes flyout in ${theme}`, async () => {
      L = await launch({ QUVRELO_E2E_OPEN: photo });
      const { page } = L;
      await run(page, themeCmd(theme));
      await run(page, 'file.open');
      await expect(page.locator('.workspace')).toBeVisible();
      // the photo's pixel layer selected, Design tab › Appearance
      await page.evaluate(() => {
        const { editor } = (window as any).__quvrelo;
        editor.select([editor.doc.pages[0].nodes[0].id]);
      });
      expect(await page.evaluate(() => (window as any).__quvrelo.editor.doc.pages[0].nodes[0].type)).toBe('raster');
      await openTab(page, 'properties');
      const appearance = page.locator('.section[data-section="appearance"]');
      await expect(appearance).toBeVisible();
      await appearance.scrollIntoViewIfNeeded();
      await page.mouse.move(1290, 720); // blank inspector: no canvas hover outline, no tooltip
      await clearToasts(page);
      await snap(page, theme, 'photo-appearance');

      await page.locator('.toolpalette [data-group="photo-shapes"]').click({ button: 'right' });
      await expect(page.getByRole('menu', { name: 'Shape tools' })).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await snap(page, theme, 'photo-shapes-flyout');
      await page.keyboard.press('Escape');
    });

    test(`welcome with the checklist part done in ${theme}`, async () => {
      L = await launch();
      const { page } = L;
      await run(page, themeCmd(theme));
      // really do two steps: create a document, add text, then close back to Welcome
      await page.click('[data-template="blank-a4"]');
      await expect(page.locator('.workspace')).toBeVisible();
      await page.click('.studio-switch [data-studio="layout"]');
      await pickTool(page, 'text');
      const p = await docToScreen(page, 120, 160);
      await page.mouse.click(p.x, p.y);
      await page.keyboard.type('Class newsletter');
      await page.keyboard.press('Escape');
      await expect.poll(() => page.evaluate(() => (window as any).__quvrelo.editor.settings.onboarding?.done ?? [])).toEqual(expect.arrayContaining(['create', 'text']));
      await run(page, 'file.save');
      await page.waitForTimeout(400);
      await run(page, 'file.close');
      await expect(page.locator('.welcome')).toBeVisible();
      const list = page.getByTestId('checklist');
      await expect(list).toBeVisible();
      await page.mouse.move(2, 2);
      await clearToasts(page);
      await snap(page, theme, 'welcome-checklist');
    });
  }

  /* ---------- 150 % and 200 % device scale (Electron --force-device-scale-factor) ---------- */
  for (const scale of [150, 200] as const) {
    for (const theme of themes) {
      test(`photo, vector, layout and welcome at ${scale}% in ${theme}`, async () => {
        L = await launch({ QUVRELO_E2E_OPEN: photo }, [`--force-device-scale-factor=${scale / 100}`]);
        const { page } = L;
        expect(await page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(scale / 100, 2);
        const shot = (name: string) => snap(page, theme, `${name}@${scale}`);
        await run(page, themeCmd(theme));
        await page.mouse.move(2, 2);
        await shot('welcome');
        await run(page, 'file.open');
        await expect(page.locator('.workspace')).toBeVisible();
        await page.evaluate(() => {
          const { editor } = (window as any).__quvrelo;
          editor.select([editor.doc.pages[0].nodes[0].id]);
        });
        await page.locator('select[aria-label="Add adjustment"]').selectOption('vibrance');
        await page.mouse.move(1290, 720); // blank inspector: no canvas hover outline, no tooltip
        await clearToasts(page);
        await shot('photo');
        await page.click('.studio-switch [data-studio="vector"]');
        await pickTool(page, 'star');
        await drag(page, { x: 400, y: 300 }, { x: 560, y: 440 });
        await pickTool(page, 'rect');
        await drag(page, { x: 640, y: 320 }, { x: 800, y: 420 });
        await page.mouse.move(720, 600);
        await shot('vector');
        await page.click('.studio-switch [data-studio="layout"]');
        await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
        await page.mouse.move(720, 600);
        await shot('layout');
      });
    }
  }
});
