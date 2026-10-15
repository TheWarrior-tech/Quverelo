/**
 * Critique 2 shell fixes (docs/design/CRITIQUE-2.md): P1-7 text-frame guides
 * and auto names, P1-4 one home for opacity/blend, P1-9 visible command search,
 * P2-1 truly centred studio switch, P2-2 Snap toggle, P1-10 Photo shapes,
 * UX P1-8 Layers "+" menu.
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { docToScreen, drag, launch, pickTool, run, state, type Launched } from './helpers';

const photo = path.resolve('tests/fixtures/sample-photo.jpg');

async function openTemplate(page: Page, id: string) {
  await page.click(`[data-template="${id}"]`);
  await expect(page.locator('.workspace')).toBeVisible();
}

async function openPhoto(page: Page) {
  await run(page, 'file.open');
  await expect(page.locator('.workspace')).toBeVisible();
  expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
}

test.describe('critique 2: shell', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('top bar: studio switch on the centre line, undo/redo in the identity zone, visible command search', async () => {
    L = await launch();
    const { page } = L;
    await openTemplate(page, 'social');
    const bar = (await page.locator('.topbar').boundingBox())!;
    const sw = (await page.locator('.studio-switch').boundingBox())!;
    // truly centred (P2-1): within a pixel of the window's centre line
    expect(Math.abs(sw.x + sw.width / 2 - (bar.x + bar.width / 2))).toBeLessThanOrEqual(1);
    await expect(page.locator('.topbar-zone.centre > *')).toHaveCount(1);
    await expect(page.locator('.topbar-zone.identity [aria-label="Undo"]')).toBeVisible();
    await expect(page.locator('.topbar-zone.identity [aria-label="Redo"]')).toBeVisible();

    const search = page.getByRole('button', { name: 'Search commands' });
    await expect(search).toBeVisible();
    await expect(search).toContainText('Search commands');
    // the label fits in full at 200px (no ellipsis)
    expect(await search.locator('.topbar-search-label').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await expect(search.locator('kbd')).toHaveText([/Ctrl|⌘/, 'K']);
    await expect(search).toHaveAttribute('aria-keyshortcuts', /K$/);
    const sb = (await search.boundingBox())!;
    expect(Math.round(sb.height)).toBe(28);
    expect(Math.round(sb.width)).toBe(200);
    // sits left of the outbound cluster
    const open = (await page.locator('.topbar-zone.actions [aria-label="Open…"]').boundingBox())!;
    expect(sb.x + sb.width).toBeLessThanOrEqual(open.x);
    await search.click();
    await expect(page.locator('.cmdk-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).toBeFocused();

    // below 1280px it collapses to an icon button and stays centred
    await page.setViewportSize({ width: 1180, height: 800 });
    await expect(search.locator('.topbar-search-label')).toBeHidden();
    expect(Math.round((await search.boundingBox())!.width)).toBe(28);
    const bar2 = (await page.locator('.topbar').boundingBox())!;
    const sw2 = (await page.locator('.studio-switch').boundingBox())!;
    expect(Math.abs(sw2.x + sw2.width / 2 - (bar2.x + bar2.width / 2))).toBeLessThanOrEqual(1);
  });

  test('status bar: Snap is a toggle button with aria-pressed and a shortcut tooltip', async () => {
    L = await launch();
    const { page } = L;
    await openTemplate(page, 'social');
    const snap = page.locator('.statusbar .snap-toggle');
    await expect(snap).toHaveText('Snap');
    await expect(snap).toHaveAttribute('data-tip', 'Snapping');
    await expect(snap).toHaveAttribute('data-keys', 'CmdOrCtrl+;');
    const before = await state<boolean>(page, 'editor.settings.snapping');
    await expect(snap).toHaveAttribute('aria-pressed', String(before));
    await snap.click();
    await expect.poll(() => state<boolean>(page, 'editor.settings.snapping')).toBe(!before);
    await expect(snap).toHaveAttribute('aria-pressed', String(!before));
    await snap.press('Enter');
    await expect.poll(() => state<boolean>(page, 'editor.settings.snapping')).toBe(before);
  });

  test('text layers are named by their first words; renaming sticks', async () => {
    L = await launch();
    const { page } = L;
    await openTemplate(page, 'blank-a4');
    await run(page, 'studio.layout');
    await pickTool(page, 'textframe');
    await drag(page, await docToScreen(page, 100, 100), await docToScreen(page, 500, 300));
    await expect(page.locator('.text-edit-overlay')).toBeVisible();
    await page.keyboard.type('Open Evening at the school');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Layers' }).click();
    const row = page.locator('.layer-row').first();
    // the full words reach the row; only CSS truncates (critique 3 P2-16: never cut twice)
    await expect(row.locator('.name')).toHaveText('Open Evening at the school');
    await expect(page.locator('.prop-name')).toHaveText('Open Evening at the school');
    // the stored name is untouched until the user renames it
    expect(await state<string>(page, 'editor.doc.pages[0].nodes[0].name')).toBe('Text Frame');
    await row.focus();
    await row.press('F2');
    const input = page.getByRole('textbox', { name: 'Layer name' });
    await input.fill('Headline');
    await input.press('Enter');
    await expect(row.locator('.name')).toHaveText('Headline');
    await expect.poll(() => state<string>(page, 'editor.doc.pages[0].nodes[0].name')).toBe('Headline');
  });

  test('text frames draw no dashed guide at rest, only on hover / selection / editing', async () => {
    L = await launch();
    const { page } = L;
    await openTemplate(page, 'blank-a4');
    await run(page, 'studio.layout');
    await pickTool(page, 'textframe');
    const a = await docToScreen(page, 120, 120);
    const b = await docToScreen(page, 520, 420);
    await drag(page, a, b);
    await page.keyboard.type('Hi');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    // look for the guide's blue-grey along the frame's left edge in a screenshot, away from the text
    const edgePixels = async () => {
      const clip = { x: Math.round(a.x) - 3, y: Math.round(a.y + (b.y - a.y) * 0.5), width: 7, height: Math.round((b.y - a.y) * 0.4) };
      const png = await page.screenshot({ clip });
      return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let blueish = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 30) blueish++;
        return blueish;
      }, png.toString('base64'));
    };
    expect(await edgePixels()).toBe(0);
  });

  test('Photo: no blend/opacity header over Layers; Design › Appearance edits them', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await expect(page.locator('.layers-head')).toHaveCount(0);
    await expect(page.getByLabel('Layer blend mode')).toHaveCount(0);
    const id = await state<string>(page, 'editor.doc.pages[0].nodes[0].id');
    await page.evaluate((i) => (window as any).__quvrelo.editor.select([i]), id);
    await page.getByRole('tab', { name: 'Design' }).click();
    const appearance = page.locator('[data-section="appearance"], .section:has-text("Appearance")').first();
    await expect(appearance).toBeVisible();
    await page.locator('#prop-blend').selectOption('multiply');
    await expect.poll(() => state<string>(page, 'editor.doc.pages[0].nodes[0].blend')).toBe('multiply');
    // rows keep their eye / lock quick actions
    const row = page.locator('.layer-row').first();
    await row.hover();
    await expect(row.getByRole('button', { name: /Hide|Show/ })).toBeVisible();
  });

  test('Photo: Shapes flyout draws a vector shape layer above the active pixel layer', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    const group = page.locator('.toolpalette [data-group="photo-shapes"]');
    await expect(group).toHaveAttribute('data-tool', 'rect');
    await expect(group).toHaveAttribute('data-keys', 'U');
    await group.click({ button: 'right' });
    const items = page.locator('.tool-flyout [data-flyout-tool]');
    await expect(items).toHaveCount(4);
    expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-flyout-tool')))).toEqual(['rect', 'ellipse', 'polygon', 'star']);
    await page.keyboard.press('Escape');

    const pixelId = await state<string>(page, 'editor.doc.pages[0].nodes[0].id');
    // a second pixel layer on top, then make the bottom one active
    await run(page, 'layer.new-pixel');
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(2);
    await page.evaluate((i) => (window as any).__quvrelo.editor.select([i]), pixelId);

    await page.keyboard.press('u');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('rect');
    await page.keyboard.press('Shift+U');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('ellipse');
    await pickTool(page, 'star');
    await drag(page, await docToScreen(page, 200, 200), await docToScreen(page, 500, 500));
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(3);
    const types = await state<string[]>(page, 'editor.doc.pages[0].nodes.map((n) => n.type)');
    expect(types).toEqual(['raster', 'star', 'raster']);
    expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
  });

  test('Layers "+" opens a menu: Pixel layer · Group · Place image… · Adjustment', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    const add = page.locator('.layer-actions .layer-add');
    await expect(add).toHaveAttribute('aria-label', 'Add layer');
    await expect(add).toHaveAttribute('aria-haspopup', 'menu');
    await add.click();
    const menu = page.getByRole('menu', { name: 'Add layer' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-menu-item="pixel"]')).toBeFocused();
    await expect(menu.locator('[data-menu-item="group"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(menu.locator('[data-menu-item="place"]')).toBeVisible();
    await expect(menu.locator('.menu-heading')).toHaveText('Adjustment');
    // nothing selected: adjustments are disabled with a reason
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(add).toBeFocused();

    const id = await state<string>(page, 'editor.doc.pages[0].nodes[0].id');
    await page.evaluate((i) => (window as any).__quvrelo.editor.select([i]), id);
    await add.click();
    await menu.locator('[data-menu-item="adj-levels"]').click();
    await expect.poll(() => state<string>(page, 'editor.doc.pages[0].nodes[0].adjustments.map((a) => a.type).join()')).toBe('levels');

    await add.click();
    await menu.locator('[data-menu-item="pixel"]').click();
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(2);
  });
});
