/**
 * Editor shell v3 (docs/DESIGN.md §8): top-bar zones, left rail, inspector
 * order, teaching empty state, floating selection toolbar, font picker, and
 * one colour control. Set QUVRELO_SHELL_SHOTS=<dir> to also save
 * shell-v3-dark.png / shell-v3-light.png (Vector studio with a selection).
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { docToScreen, drag, launch, run, state, type Launched } from './helpers';

const shots = process.env.QUVRELO_SHELL_SHOTS;

async function vectorWithRect(page: Page) {
  await page.click('[data-template="poster-a4"]');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.click('.studio-switch [data-studio="vector"]');
  await page.click('[data-tool="rect"]');
  await drag(page, await docToScreen(page, 380, 560), await docToScreen(page, 620, 760));
  await page.click('[data-tool="move"]');
}

test.describe('shell v3', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('top bar zones: identity, studio + tools, Export as the one primary button', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    const zones = page.locator('.topbar > .topbar-zone');
    await expect(zones).toHaveCount(3);
    await expect(zones.nth(0).locator('.doc-title')).toBeVisible();
    await expect(zones.nth(0).locator('.doc-state')).toHaveText(/Saved|Edited|Not saved/);
    await expect(zones.nth(1).locator('.studio-switch')).toBeVisible();
    await expect(page.locator('.topbar .btn.primary')).toHaveCount(1);
    await expect(zones.nth(2).locator('.btn.primary')).toHaveText(/Export/);
    // the studio switch is centred in the bar
    const bar = (await page.locator('.topbar').boundingBox())!;
    const sw = (await page.locator('.studio-switch').boundingBox())!;
    expect(Math.abs(sw.x + sw.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(80);
    // rename in place
    await page.locator('.doc-title').click();
    const input = page.getByRole('textbox', { name: 'Document name' });
    await input.fill('Science fair poster');
    await input.press('Enter');
    await expect.poll(() => state<string>(page, 'editor.doc.title')).toBe('Science fair poster');
    await expect(page.locator('.doc-state')).toHaveText('Edited');
    // Export opens the export dialog
    await page.locator('.topbar .export-btn').click();
    await expect(page.locator('.dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('inspector: fill, stroke and opacity first, 4-up transform, object section last', async () => {
    L = await launch();
    const { page } = L;
    await vectorWithRect(page);
    const sections = await page.locator('.inspector .section').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section));
    expect(sections.slice(0, 3)).toEqual(['appearance', 'transform', 'shape-rect']);
    const rows = await page.locator('[data-section="appearance"] .insp-row > label, [data-section="appearance"] .slider-row > label').allTextContents();
    expect(rows.slice(0, 4)).toEqual(['Fill', 'Stroke', 'Opacity', 'Blend']);
    // X Y W H share one row
    const ys = await Promise.all(['X', 'Y', 'Width', 'Height'].map(async (n) => Math.round((await page.getByRole('spinbutton', { name: new RegExp(`^${n} `) }).boundingBox())!.y)));
    expect(new Set(ys).size).toBe(1);
    // fill is above the fold of the inspector
    const fill = (await page.locator('[data-paint="fill"]').boundingBox())!;
    const body = (await page.locator('#inspector-body').boundingBox())!;
    expect(fill.y + fill.height).toBeLessThan(body.y + body.height / 2);
    // stroke can be added from the row and gets a width
    await page.getByRole('button', { name: 'Add stroke' }).click();
    await expect.poll(() => state<number>(page, 'editor.selectedNodes()[0].stroke.width')).toBeGreaterThan(0);
    await expect(page.getByRole('spinbutton', { name: 'Stroke width' })).toBeVisible();
  });

  test('empty Layers panel teaches and starts work', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.click('.studio-switch [data-studio="vector"]');
    await run(page, 'edit.select-all');
    await run(page, 'edit.delete');
    const empty = page.locator('.layers-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No layers yet');
    // the canvas card owns the three actions; the Layers empty state shrinks to one line (critique 3 P2-3)
    await expect(page.getByTestId('canvas-empty')).toBeVisible();
    await expect(empty.getByRole('button')).toHaveCount(0);
    await page.getByTestId('canvas-empty').locator('[data-empty-action="shape"]').click();
    await expect.poll(() => state<string>(page, 'editor.ui.tool')).toBe('rect');
    await drag(page, await docToScreen(page, 100, 100), await docToScreen(page, 300, 260));
    await expect(empty).toHaveCount(0);
    await expect(page.locator('.layer-row')).toHaveCount(1);
  });

  test('floating selection toolbar follows the selection and hides while dragging', async () => {
    L = await launch();
    const { page } = L;
    await vectorWithRect(page);
    const tb = page.locator('.selection-toolbar.placed');
    await expect(tb).toBeVisible();
    const box = (await tb.boundingBox())!;
    const bottom = await docToScreen(page, 500, 760);
    expect(box.y).toBeGreaterThan(bottom.y);
    expect(box.y - bottom.y).toBeLessThan(24);
    // hidden while the pointer drags the selection, back after pointer-up
    const c = await docToScreen(page, 500, 660);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 30, c.y + 10, { steps: 4 });
    await expect(page.locator('.selection-toolbar')).toHaveCount(0);
    await page.mouse.up();
    await expect(tb).toBeVisible();
    // F6 moves focus into it; Arrange menu runs a command
    await page.keyboard.press('F6');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.selection-toolbar'))).toBe(true);
    const id = await state<string>(page, 'editor.ui.selection[0]');
    await tb.getByRole('button', { name: 'Arrange' }).click();
    await page.getByRole('menuitem', { name: 'Send to back' }).click();
    await expect.poll(() => state<string>(page, 'editor.activeContainer.nodes[0].id')).toBe(id);
    // fill chip recolours the selection through the shared picker
    await tb.getByRole('button', { name: 'Fill colour' }).click();
    const hex = page.getByRole('textbox', { name: 'Hex colour' });
    await hex.fill('22AA66');
    await hex.press('Enter');
    await expect.poll(() => state<string>(page, 'editor.selectedNodes()[0].fill.color')).toBe('#22aa66');
    await page.keyboard.press('Escape');
    // Preferences can turn it off
    await page.evaluate(() => (window as any).__quvrelo.editor.settings.showSelectionToolbar = false);
    await run(page, 'view.zoom-in');
    await expect(page.locator('.selection-toolbar')).toHaveCount(0);
  });

  test('font picker: search, live preview, Enter commits, Esc reverts', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="poster-a4"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const t = editor.doc.pages[0].nodes.find((n: any) => n.type === 'text' || n.type === 'textframe');
      editor.select([t.id]);
    });
    const family = () => state<string>(page, "(() => { const n = editor.selectedNodes()[0]; return n.type === 'text' ? n.style.fontFamily : editor.doc.stories[n.storyId].style.fontFamily; })()");
    const before = await family();
    const trigger = page.locator('.contextbar .font-trigger');
    await trigger.click();
    const search = page.getByRole('combobox', { name: 'Search fonts' });
    await expect(search).toBeFocused();
    // rows are set in their own face
    const face = await page.locator('.font-row', { hasText: 'Caveat' }).first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(face).toContain('Caveat');
    await search.fill('merri');
    await expect(page.locator('.font-row')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect.poll(family).toBe('Merriweather');
    // Esc reverts a live preview
    await trigger.click();
    await page.keyboard.press('ArrowDown');
    await expect.poll(family).not.toBe('Merriweather');
    await page.keyboard.press('Escape');
    await expect.poll(family).toBe('Merriweather');
    expect(before).not.toBe('');
  });

  test('one colour control: no native colour inputs, segmented modes in the context bar', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.click('.studio-switch [data-studio="photo"]');
    for (const tool of ['brush', 'fill', 'marquee-rect']) {
      await page.click(`[data-tool="${tool}"]`);
      expect(await page.locator('input[type="color"]').count(), tool).toBe(0);
    }
    await expect(page.getByRole('radiogroup', { name: 'Selection mode' })).toBeVisible();
    await page.getByRole('radio', { name: 'Add' }).click();
    await expect.poll(() => state<string>(page, 'editor.ui.toolOptions.selectionMode')).toBe('add');
    await page.click('[data-tool="brush"]');
    await page.getByRole('button', { name: 'Brush colour' }).click();
    await expect(page.getByRole('textbox', { name: 'Hex colour' })).toBeVisible();
    await page.keyboard.press('Escape');
    // nothing selected: document background is a colour chip too
    await page.click('.studio-switch [data-studio="vector"]');
    await run(page, 'edit.deselect');
    await page.getByRole('tab', { name: 'Design' }).click();
    await expect(page.getByRole('button', { name: 'Background colour' })).toBeVisible();
    expect(await page.locator('input[type="color"]').count()).toBe(0);
  });

  test('screenshots: vector studio with a selection, dark and light', async () => {
    test.skip(!shots, 'set QUVRELO_SHELL_SHOTS');
    L = await launch();
    const { page } = L;
    await page.click('[data-template="poster-a4"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.click('.studio-switch [data-studio="vector"]');
    await page.click('[data-tool="star"]');
    await drag(page, await docToScreen(page, 470, 300), await docToScreen(page, 690, 520));
    await page.click('[data-tool="rect"]');
    await drag(page, await docToScreen(page, 380, 560), await docToScreen(page, 620, 760));
    await page.click('[data-tool="move"]');
    await page.locator('.layer-row').nth(1).hover();
    await page.waitForTimeout(400);
    for (const theme of ['dark', 'light'] as const) {
      await run(page, theme === 'dark' ? 'view.theme-dark' : 'view.theme-light');
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(shots!, `shell-v3-${theme}.png`) });
    }
  });
});
