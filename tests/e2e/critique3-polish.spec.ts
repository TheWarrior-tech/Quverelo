/**
 * Critique 3 polish (docs/design/CRITIQUE-3.md): N5 one Export scale control,
 * N6 colour popovers never cover the inspector or the selection, N9 the HC
 * flyout tells checked from focused, P1-8 sentence-case tool names in Shortcuts,
 * P2-4 Shortcuts search counts follow the filter.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { docToScreen, drag, launch, run, shot, type Launched } from './helpers';

type R = { left: number; top: number; right: number; bottom: number };
const rect = async (l: Locator): Promise<R> => {
  const b = (await l.boundingBox())!;
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
};
const overlaps = (a: R, b: R) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;

/** The selection's window rect, as the viewport reports it. */
async function selectionRect(page: Page): Promise<R> {
  const r = await page.evaluate(() => {
    const vp = (window as any).__quvrelo.getViewport();
    const s = vp.selectionRect();
    const h = vp.host.getBoundingClientRect();
    return s && { left: h.left + s.x, top: h.top + s.y, right: h.left + s.x + s.w, bottom: h.top + s.y + s.h };
  });
  expect(r).not.toBeNull();
  return r as R;
}

async function vectorWithRect(page: Page, from: [number, number], to: [number, number]) {
  await page.click('[data-template="poster-a4"]');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.click('.studio-switch [data-studio="vector"]');
  await page.click('[data-tool="rect"]');
  await drag(page, await docToScreen(page, ...from), await docToScreen(page, ...to));
}

test.describe('critique 3: polish', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('N5: Export scale is one field; the × follows the digits; presets and custom width share it', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await run(page, 'file.export-png');
    const dlg = page.locator('.dialog');
    const box = dlg.locator('.ex-scale');
    await expect(box.locator('.nf')).toHaveCount(1);
    await expect(box.locator('select')).toHaveCount(0);
    const scale = dlg.getByRole('spinbutton', { name: 'Scale' });
    await expect(scale).toHaveValue('1');
    // the unit sits right after the digits, nowhere near the field's right edge (where a clear-× lives)
    const input = await rect(scale);
    const unit = await rect(box.locator('.nf-unit'));
    const field = await rect(box.locator('.nf'));
    expect(unit.left - input.right).toBeLessThanOrEqual(3);
    expect(field.right - unit.right).toBeGreaterThan(40);
    await expect(page.getByTestId('export-scale-hint')).toHaveText('1080 × 1080 px');
    // presets live in the chevron inside the field
    await page.getByTestId('export-scale-presets').click();
    const menu = page.getByRole('menu', { name: 'Scale presets' });
    await expect(menu).toBeVisible();
    await page.waitForTimeout(250); // let the menu's fade finish for the capture
    await shot(page, 'c3-export-scale-presets');
    await menu.getByRole('menuitem', { name: /^2×/ }).click();
    await expect(scale).toHaveValue('2');
    await expect(page.getByTestId('export-scale-hint')).toHaveText('2160 × 2160 px');
    await expect(page.getByTestId('export-dims')).toHaveText('2160 × 2160 px');
    // custom width turns the same field into W px; the factor becomes the hint
    await page.getByTestId('export-scale-presets').click();
    await page.getByRole('menuitem', { name: /Custom width/ }).click();
    const w = dlg.getByRole('spinbutton', { name: 'Width in pixels' });
    await expect(w).toHaveValue('2160');
    await expect(w).toBeFocused();
    await w.fill('540');
    await w.press('Enter');
    await expect(page.getByTestId('export-scale-hint')).toHaveText('0.5× · 540 × 540 px');
    await expect(box.locator('.nf')).toHaveCount(1);
    await shot(page, 'c3-export-scale-width');
  });

  test('N6: an inspector colour popover opens left of the inspector and off the selection', async () => {
    L = await launch();
    const { page } = L;
    await vectorWithRect(page, [380, 560], [620, 760]);
    await page.click('[data-tool="move"]');
    const sel = await selectionRect(page);
    await page.locator('.inspector [data-paint="fill"] .chip-select').click();
    const pop = page.getByTestId('color-popover');
    await expect(pop).toBeVisible();
    const p = await rect(pop.locator('xpath=..'));
    const insp = await rect(page.locator('.inspector'));
    expect(p.right).toBeLessThanOrEqual(insp.left);
    expect(overlaps(p, sel)).toBe(false);
    await shot(page, 'c3-colour-inspector');
  });

  test('N6: a context-bar colour popover sits beside the selection, not on it', async () => {
    L = await launch();
    const { page } = L;
    // a wide rectangle right under the context bar, where "below the chip" would land on it
    await vectorWithRect(page, [20, 20], [700, 500]);
    const sel = await selectionRect(page);
    const chip = page.locator('.contextbar .chip-select').first();
    await chip.click();
    const pop = page.getByTestId('color-popover');
    await expect(pop).toBeVisible();
    const p = await rect(pop.locator('xpath=..'));
    expect(overlaps(p, sel)).toBe(false);
    expect(overlaps(p, await rect(page.locator('.inspector')))).toBe(false);
    expect(overlaps(p, await rect(chip))).toBe(false);
    await shot(page, 'c3-colour-contextbar');
  });

  test('N6: a selection-toolbar colour popover keeps the selection visible', async () => {
    L = await launch();
    const { page } = L;
    await vectorWithRect(page, [200, 300], [600, 700]);
    await page.click('[data-tool="move"]');
    const tb = page.locator('.selection-toolbar');
    await expect(tb).toBeVisible();
    const sel = await selectionRect(page);
    await tb.locator('.chip-select').first().click();
    const pop = page.getByTestId('color-popover');
    await expect(pop).toBeVisible();
    const p = await rect(pop.locator('xpath=..'));
    expect(overlaps(p, sel)).toBe(false);
    expect(overlaps(p, await rect(page.locator('.inspector')))).toBe(false);
  });

  test('N9: in high contrast a checked flyout row and a focused one never look alike', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.click('.studio-switch [data-studio="vector"]');
    await run(page, 'view.theme-contrast');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
    await page.locator('.toolpalette [data-group="vector-shapes"]').click({ button: 'right' });
    const menu = page.locator('.tool-flyout');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    const checked = menu.locator('.flyout-item.on');
    const focused = menu.locator('.flyout-item:focus-visible');
    await expect(focused).toHaveCount(1);
    await expect(checked).toHaveCount(1);
    expect(await focused.evaluate((e) => e.classList.contains('on'))).toBe(false);
    const look = (l: Locator) => l.evaluate((e) => {
      const s = getComputedStyle(e);
      return { bg: s.backgroundColor, color: s.color, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, offset: s.outlineOffset, shadow: s.boxShadow };
    });
    // let the 120ms background transition on the newly focused row settle
    await expect.poll(async () => (await look(focused)).bg).toBe('rgb(0, 0, 0)');
    const c = await look(checked);
    const f = await look(focused);
    expect(c.bg).toBe('rgb(255, 212, 0)');
    expect(c.color).toBe('rgb(0, 0, 0)');
    expect(f.bg).toBe('rgb(0, 0, 0)');
    expect(f.outline).toBe('solid 3px rgb(255, 212, 0)');
    expect(f.offset).toBe('2px');
    expect(c.bg).not.toBe(f.bg);
    // the keycap on the yellow tile stays legible (black on yellow, no black slab)
    const kbd = await checked.locator('kbd').evaluate((e) => { const s = getComputedStyle(e); return { bg: s.backgroundColor, color: s.color }; });
    expect(kbd.color).toBe('rgb(0, 0, 0)');
    expect(kbd.bg).toBe('rgba(0, 0, 0, 0)');
    await page.waitForTimeout(200);
    await shot(page, 'c3-hc-flyout');
  });

  test('P1-8 / P2-4: Shortcuts names tools in sentence case; search counts follow the filter', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await run(page, 'help.shortcuts');
    const dlg = page.locator('.dialog');
    await expect(dlg.getByText('Rectangle marquee', { exact: true })).toBeVisible();
    await expect(dlg.getByText('Marquee Rect', { exact: true })).toHaveCount(0);
    await dlg.getByRole('searchbox', { name: 'Search shortcuts' }).fill('zoom');
    const all = dlg.locator('.nav-item', { hasText: 'All shortcuts' }).locator('.count');
    const n = parseInt((await all.textContent()) ?? '0', 10);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
    await expect(page.getByTestId('shortcuts-summary')).toContainText(`${n} shortcut`);
    await expect(dlg.locator('.sc-row')).toHaveCount(n);
    await expect(dlg.locator('.sc-hit').first()).toHaveText(/zoom/i);
    // groups with no match leave the nav while searching (CRITIQUE-4 P2-21): every visible count is > 0
    const counts = await dlg.locator('.nav-item .count').allTextContents();
    expect(counts.every((c) => parseInt(c, 10) > 0)).toBe(true);
    await expect(dlg.locator('.nav-item', { hasText: /^Arrange/ })).toHaveCount(0);
    await shot(page, 'c3-shortcuts-search');
  });
});
