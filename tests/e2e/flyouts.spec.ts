import { test, expect } from '@playwright/test';
import { launch, run, state, type Launched } from './helpers';

/** Tool-rail flyouts (CRITIQUE #21). */
test.describe('tool rail flyouts', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  async function open(studio: 'photo' | 'vector' | 'layout') {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="blank-a4"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await run(page, `studio.${studio}`);
    return page;
  }

  test('group buttons carry a corner mark, a popup role and name + shortcut tooltips', async () => {
    const page = await open('vector');
    const shapes = page.locator('.toolpalette [data-group="vector-shapes"]');
    await expect(shapes).toHaveAttribute('aria-haspopup', 'menu');
    await expect(shapes).toHaveAttribute('aria-expanded', 'false');
    await expect(shapes).toHaveAttribute('data-tool', 'rect');
    await expect(shapes).toHaveAttribute('data-tip', 'Rectangle');
    await expect(shapes).toHaveAttribute('data-keys', 'M');
    await expect(shapes).toHaveAttribute('aria-label', 'Rectangle');
    await expect(shapes).toHaveAttribute('aria-keyshortcuts', 'M');
    await expect(shapes.locator('.flyout-mark')).toHaveCount(1);
    // ungrouped tools have no mark
    await expect(page.locator('.toolpalette [data-tool="move"] .flyout-mark')).toHaveCount(0);
    // the triangle is the 4px DESIGN.md mark, inside the 32px button
    const mark = await shapes.locator('.flyout-mark').boundingBox();
    expect(mark?.width).toBe(4);
    expect(mark?.height).toBe(4);
  });

  test('right-click opens the flyout; picking a tool makes it the visible one', async () => {
    const page = await open('vector');
    const shapes = page.locator('.toolpalette [data-group="vector-shapes"]');
    await shapes.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Shape tools' });
    await expect(menu).toBeVisible();
    await expect(shapes).toHaveAttribute('aria-expanded', 'true');
    const items = menu.getByRole('menuitemradio');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(items.nth(0)).toContainText('Rectangle');
    await expect(items.nth(0).locator('kbd')).toHaveText('M');
    await expect(items.nth(3)).toContainText('Star');
    await expect(items.nth(3).locator('kbd')).toHaveText('S');
    // menu sits to the right of the rail button, 4px away (once its slide-in has finished)
    await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const b = (await shapes.boundingBox())!;
    const m = (await menu.boundingBox())!;
    expect(Math.round(m.x - (b.x + b.width))).toBe(4);

    await menu.getByRole('menuitemradio', { name: /Star/ }).click();
    await expect(menu).toHaveCount(0);
    expect(await state<string>(page, 'editor.ui.tool')).toBe('star');
    await expect(shapes).toHaveAttribute('data-tool', 'star');
    await expect(shapes).toHaveClass(/active/);
    await expect(shapes).toHaveAttribute('aria-pressed', 'true');

    // last used sticks while another tool is active, and a click uses it
    await page.click('.toolpalette [data-tool="move"]');
    await expect(shapes).toHaveAttribute('data-tool', 'star');
    await expect(shapes).not.toHaveClass(/active/);
    await shapes.click();
    expect(await state<string>(page, 'editor.ui.tool')).toBe('star');
  });

  test('long-press opens the flyout, and press-drag-release picks', async () => {
    const page = await open('vector');
    const shapes = page.locator('.toolpalette [data-group="vector-shapes"]');
    const b = (await shapes.boundingBox())!;
    // hold, release on the button: menu stays open, tool unchanged
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(550);
    await page.mouse.up();
    const menu = page.getByRole('menu', { name: 'Shape tools' });
    await expect(menu).toBeVisible();
    expect(await state<string>(page, 'editor.ui.tool')).toBe('move');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // hold, drag onto Polygon, release
    await page.mouse.down();
    await page.waitForTimeout(550);
    const poly = (await menu.getByRole('menuitemradio', { name: /Polygon/ }).boundingBox())!;
    await page.mouse.move(poly.x + poly.width / 2, poly.y + poly.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(menu).toHaveCount(0);
    expect(await state<string>(page, 'editor.ui.tool')).toBe('polygon');

    // a quick click is just a click
    await page.click('.toolpalette [data-tool="move"]');
    await shapes.click();
    await expect(menu).toHaveCount(0);
    expect(await state<string>(page, 'editor.ui.tool')).toBe('polygon');
  });

  test('fully keyboard operable', async () => {
    const page = await open('vector');
    const shapes = page.locator('.toolpalette [data-group="vector-shapes"]');
    await shapes.focus();
    await page.keyboard.press('ArrowRight');
    const menu = page.getByRole('menu', { name: 'Shape tools' });
    await expect(menu).toBeVisible();
    // focus lands on the checked item, roving tabindex
    await expect(menu.getByRole('menuitemradio', { name: /Rectangle/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: /Ellipse/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio', { name: /Star/ })).toBeFocused();
    await page.keyboard.press('ArrowDown'); // wraps
    await expect(menu.getByRole('menuitemradio', { name: /Rectangle/ })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitemradio', { name: /Star/ })).toBeFocused();
    // arrows inside the menu must not nudge or switch tools
    expect(await state<string>(page, 'editor.ui.tool')).toBe('move');
    // Esc closes without choosing and returns focus
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(shapes).toBeFocused();
    expect(await state<string>(page, 'editor.ui.tool')).toBe('move');

    // Alt+Down opens, Enter picks
    await page.keyboard.press('Alt+ArrowDown');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(shapes).toBeFocused();
    expect(await state<string>(page, 'editor.ui.tool')).toBe('ellipse');

    // Shift+F10 opens; a tool's own letter picks it; Space works too
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('y');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('polygon');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Home');
    await page.keyboard.press('Space');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('rect');
    // Tab closes and returns focus
    await page.keyboard.press('ArrowRight');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(shapes).toBeFocused();
  });

  test('Shift + tool key cycles within the group', async () => {
    const page = await open('photo');
    const marquee = page.locator('.toolpalette [data-group="photo-marquee"]');
    await page.keyboard.press('v');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('move');
    await page.keyboard.press('Shift+M'); // enters the group on the shown member
    expect(await state<string>(page, 'editor.ui.tool')).toBe('marquee-rect');
    await page.keyboard.press('Shift+M');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('marquee-ellipse');
    await expect(marquee).toHaveAttribute('data-tool', 'marquee-ellipse');
    // a member without a key of its own advertises the cycle shortcut
    await expect(marquee).toHaveAttribute('data-tip', 'Ellipse marquee');
    await expect(marquee).toHaveAttribute('data-keys', 'Shift+M');
    await expect(marquee).toHaveAttribute('aria-keyshortcuts', 'Shift+M');
    await page.keyboard.press('Shift+M'); // wraps
    expect(await state<string>(page, 'editor.ui.tool')).toBe('marquee-rect');
    // plain key still picks the exact tool
    await page.keyboard.press('Shift+M');
    await page.keyboard.press('m');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('marquee-rect');

    // vector: Shift+E (a member's own key) cycles the shape group too
    await run(page, 'studio.vector');
    await page.keyboard.press('e');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('ellipse');
    await page.keyboard.press('Shift+E');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('polygon');
    await page.keyboard.press('Shift+P');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('pen');
    await page.keyboard.press('Shift+P');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('pencil');
  });

  test('flyout honours reduced motion and the design tokens', async () => {
    const page = await open('vector');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.toolpalette [data-group="vector-shapes"]').click({ button: 'right' });
    const menu = page.locator('.tool-flyout');
    await expect(menu).toBeVisible();
    const css = await menu.evaluate((el) => {
      const s = getComputedStyle(el);
      const item = getComputedStyle(el.querySelector('.flyout-item')!);
      return { anim: s.animationName, radius: s.borderTopLeftRadius, itemH: item.height, itemR: item.borderTopLeftRadius };
    });
    expect(css.anim).toBe('none');
    expect(css.radius).toBe('8px');
    expect(css.itemH).toBe('28px');
    expect(css.itemR).toBe('4px');
  });

  test('dark screenshot of an open flyout', async () => {
    const page = await open('vector');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('.toolpalette [data-group="vector-shapes"]').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Shape tools' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown'); // show a hover/focus row next to the checked one
    await page.waitForTimeout(200);
    await page.screenshot({ path: process.env.FLYOUT_SHOT ?? 'test-results/flyout-open.png' });
  });
});
