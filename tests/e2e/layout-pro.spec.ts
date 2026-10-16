import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { docToScreen, drag, launch, pickTool, run, state, type Launched } from './helpers';

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

const shots = path.join(process.cwd(), 'test-results', 'layout-pro');
fs.mkdirSync(shots, { recursive: true });

async function blankLayout(page: Page) {
  await page.click('[data-template="blank-a4"]');
  await expect(page.locator('.workspace')).toBeVisible();
  await run(page, 'studio.layout');
  await page.waitForTimeout(300);
}

/** Evaluate with the core modules the app exposes for tests. */
async function ev<T>(page: Page, body: string): Promise<T> {
  return page.evaluate(`(async () => { const { editor, runCommand, getViewport } = window.__quvrelo; ${body} })()`) as Promise<T>;
}

test.describe('layout: pro typography', () => {
  test('rich text frame: per-character styling through the inspector with a text selection', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await pickTool(page, 'textframe');
    await drag(page, await docToScreen(page, 80, 80), await docToScreen(page, 700, 400));
    await expect(page.locator('.text-edit-overlay')).toBeVisible();
    await page.keyboard.type('Quvrelo sets office figures 1234567890 fine.');
    // select "office" with the keyboard (Home, then shift+arrows)
    await page.keyboard.press('Home');
    for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
    const sel = await state<{ start: number; end: number }>(page, 'editor.ui.textSel');
    expect([sel.start, sel.end]).toEqual([13, 19]);
    await page.screenshot({ path: path.join(shots, 'rich-select.png') });
  });
});
