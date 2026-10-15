/**
 * Critique 4 R1: in high contrast, selected and focused never look alike, in every list.
 *   selected / current / checked = solid #ffd400 fill, black ink, no outline
 *   focused                      = black row, 3px yellow outline 2px outside it
 *   selected + focused           = the fill plus the ring
 * Checked by computed style across Layers, Preferences nav, theme tiles, Shortcuts nav,
 * the Export format list, New-document categories, preset and template tiles, the
 * command palette and menus; no olive wash anywhere; and the Curves grid is dim (P2-14).
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import * as path from 'node:path';
import { launch, run, shot, type Launched } from './helpers';

const YELLOW = 'rgb(255, 212, 0)';
const BLACK = 'rgb(0, 0, 0)';
const RING = `solid 3px ${YELLOW}`;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const photo = path.resolve('tests/fixtures/sample-photo.jpg');

interface Look { bg: string; color: string; outline: string; offset: string; shadow: string }
const look = (l: Locator): Promise<Look> =>
  l.evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      bg: s.backgroundColor,
      color: s.color,
      outline: s.outlineStyle === 'none' || s.outlineWidth === '0px' ? 'none' : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
      offset: s.outlineOffset,
      shadow: s.boxShadow,
    };
  });

/** rows fade their background over 120ms: wait for it to settle, then compare */
async function settled(l: Locator, bg: string): Promise<Look> {
  await expect.poll(async () => (await look(l)).bg, { timeout: 3000 }).toBe(bg);
  return look(l);
}

async function expectSelected(l: Locator, what: string) {
  const s = await settled(l, YELLOW);
  expect(s.color, `${what}: black ink on the fill`).toBe(BLACK);
  expect(s.outline, `${what}: selected draws no ring`).toBe('none');
  expect(s.shadow, `${what}: no inset ring either`).toBe('none');
}

async function expectFocused(l: Locator, what: string) {
  const f = await settled(l, BLACK);
  expect(f.outline, `${what}: §9 ring`).toBe(RING);
  expect(f.offset, `${what}: ring sits 2px outside`).toBe('2px');
  expect(f.color, `${what}: white ink`).toBe('rgb(255, 255, 255)');
}

async function expectSelectedFocused(l: Locator, what: string) {
  const b = await settled(l, YELLOW);
  expect(b.color, `${what}: black ink`).toBe(BLACK);
  expect(b.outline, `${what}: fill plus ring`).toBe(RING);
  expect(b.offset).toBe('2px');
}

/** focus as a keyboard user would (so :focus-visible applies) */
async function keyFocus(page: Page, l: Locator) {
  await page.keyboard.press('Shift');
  await l.focus();
  await expect(l).toBeFocused();
}

/** the third "selected" dialect is gone: nothing paints the olive 25 % yellow wash */
async function expectNoOlive(page: Page, scope: string) {
  await page.waitForTimeout(300); // let 120ms background fades finish (mid-fade mixes are not a state)
  const hits = await page.evaluate((sel) => {
    const out: string[] = [];
    for (const e of Array.from(document.querySelectorAll(`${sel}, ${sel} *`))) {
      const bg = getComputedStyle(e).backgroundColor;
      if (bg === 'rgb(64, 53, 0)' || /^rgba\(255, 212, 0, 0?\.\d+\)$/.test(bg)) out.push(`${(e as HTMLElement).className || e.tagName}: ${bg}`);
    }
    return out;
  }, scope);
  expect(hits).toEqual([]);
}

async function hcDoc(page: Page, template = 'social') {
  await page.click(`[data-template="${template}"]`);
  await expect(page.locator('.workspace')).toBeVisible();
  await run(page, 'view.theme-contrast');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
}

test.describe('high contrast: selected is a fill, focus is a ring (critique 4 R1)', () => {
  let L: Launched | null = null;
  test.afterEach(async () => {
    await L?.app.close();
    L = null;
  });

  test('Layers rows', async () => {
    L = await launch();
    const { page } = L;
    await hcDoc(page);
    await page.click('.studio-switch [data-studio="vector"]');
    const rows = page.locator('.layer-row');
    expect(await rows.count()).toBeGreaterThan(2);
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveClass(/selected/);
    // keyboard: move focus to the next row; the first stays selected, unfocused
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await expectFocused(rows.nth(1), 'focused layer row');
    await expectSelected(rows.nth(0), 'selected layer row');
    expect(await rows.nth(0).locator('.name').evaluate((e) => getComputedStyle(e).color)).toBe(BLACK);
    // Enter selects the focused row: fill + ring
    await page.keyboard.press('Enter');
    await expect(rows.nth(1)).toHaveClass(/selected/);
    await expectSelectedFocused(rows.nth(1), 'selected + focused layer row');
    // hover on a plain row: 1px white inset, never yellow
    await page.mouse.move(0, 0);
    await rows.nth(2).hover();
    const h = await settled(rows.nth(2), BLACK);
    expect(h.shadow).toContain('inset');
    expect(h.outline).toBe('none');
    await expectNoOlive(page, '.left-rail');
    await shot(page, 'r4-hc-layers');
  });

  test('Preferences nav and theme tiles', async () => {
    L = await launch();
    const { page } = L;
    await hcDoc(page);
    await run(page, 'app.preferences');
    const dlg = page.locator('.dialog');
    await expect(dlg).toBeVisible();
    const current = dlg.locator('.dlg-side .nav-item[aria-current="true"]');
    await expect(current).toHaveCount(1);
    const pane = (await current.getAttribute('data-pane'))!;
    const other = dlg.locator('.dlg-side .nav-item[aria-current="false"]').first();
    const otherPane = (await other.getAttribute('data-pane'))!;
    await keyFocus(page, other);
    await expectFocused(other, 'focused Preferences nav item');
    await expectSelected(dlg.locator(`[data-pane="${pane}"]`), 'current Preferences nav item');
    await page.keyboard.press('Enter');
    const now = dlg.locator(`.nav-item[data-pane="${otherPane}"]`);
    await expect(now).toHaveAttribute('aria-current', 'true');
    await expectSelectedFocused(now, 'current + focused Preferences nav item');
    await dlg.locator('.nav-item[data-pane="appearance"]').click();
    // theme tiles: the checked theme is a filled tile, not a second ring
    const checked = dlg.locator('.theme-tile[aria-checked="true"]');
    await expect(checked).toHaveAttribute('data-theme-tile', 'high-contrast');
    await expectSelected(checked, 'checked theme tile');
    await keyFocus(page, checked);
    await expectSelectedFocused(checked, 'checked + focused theme tile');
    await expectNoOlive(page, '.dialog');
    await shot(page, 'r4-hc-preferences');
  });

  test('Shortcuts: the focused search field and the selected nav row differ', async () => {
    L = await launch();
    const { page } = L;
    await hcDoc(page);
    await run(page, 'help.shortcuts');
    const dlg = page.locator('.dialog');
    const search = dlg.getByRole('searchbox', { name: 'Search shortcuts' });
    await expect(search).toBeFocused();
    const all = dlg.locator('.nav-item', { hasText: 'All shortcuts' });
    await expectSelected(all, 'selected "All shortcuts"');
    const field = await look(search);
    expect(field.bg).not.toBe(YELLOW);
    const file = dlg.locator('.nav-item', { hasText: /^File/ });
    await keyFocus(page, file);
    await expectFocused(file, 'focused Shortcuts nav item');
    await expectSelected(all, 'selected "All shortcuts" while another row has focus');
    await expectNoOlive(page, '.dialog');
    await shot(page, 'r4-hc-shortcuts');
  });

  test('Export format list', async () => {
    L = await launch();
    const { page } = L;
    await hcDoc(page);
    await page.keyboard.press('Shift');
    await run(page, 'file.export');
    const side = page.locator('.dialog .dlg-side');
    const sel = side.locator('.nav-item[aria-selected="true"]');
    await expect(sel).toBeFocused();
    await expectSelectedFocused(sel, 'selected + focused format');
    const id = await sel.getAttribute('data-format');
    await page.keyboard.press('ArrowDown');
    const next = side.locator('.nav-item[aria-selected="true"]');
    await expect(next).not.toHaveAttribute('data-format', id!);
    await expectSelectedFocused(next, 'next format, selected + focused');
    // the previous format is plain again: neither filled nor ringed
    const prev = side.locator(`[data-format="${id}"]`);
    await expect.poll(async () => (await look(prev)).bg).not.toBe(YELLOW);
    expect((await look(prev)).outline).toBe('none');
    // move focus off the list: the selected format keeps its fill without a ring
    await keyFocus(page, page.locator('.dialog .dialog-footer .btn').first());
    await expectSelected(next, 'selected format without focus');
    await expectNoOlive(page, '.dialog');
    await shot(page, 'r4-hc-export');
  });

  test('New document: categories, preset tiles and template tiles', async () => {
    L = await launch();
    const { page } = L;
    await hcDoc(page);
    await run(page, 'file.new');
    const dlg = page.locator('.dialog');
    const cat = dlg.locator('.nav-item[aria-current="true"]');
    await expect(cat).toHaveCount(1);
    await expectSelected(cat, 'current category');
    const checked = dlg.locator('.preset[aria-checked="true"]');
    await expect(checked).toHaveCount(1);
    await expectSelected(checked, 'checked preset tile');
    const other = dlg.locator('.preset[aria-checked="false"]').first();
    await keyFocus(page, other);
    await expectFocused(other, 'focused preset tile');
    await expectSelected(checked, 'checked preset while another tile has focus');
    // a category with focus but not current
    const otherCat = dlg.locator('.nav-item[aria-current="false"]').first();
    await keyFocus(page, otherCat);
    await expectFocused(otherCat, 'focused category');
    await expectNoOlive(page, '.dialog');
    await shot(page, 'r4-hc-new');
    // template tiles share the vocabulary
    await dlg.locator('.nav-item[data-category="templates"]').click();
    const tpl = dlg.locator('.preset[data-template-option][aria-checked="true"]');
    await expect(tpl).toHaveCount(1);
    await expectSelected(tpl, 'checked template tile');
    await keyFocus(page, tpl);
    await expectSelectedFocused(tpl, 'checked + focused template tile');
    await expectNoOlive(page, '.dialog');
  });

  test('Command palette rows and menus', async () => {
    L = await launch();
    const { page } = L;
    await hcDoc(page);
    await page.keyboard.press(`${MOD}+k`);
    const pal = page.locator('.cmdk');
    await expect(pal).toBeVisible();
    await page.keyboard.type('exp');
    const active = pal.locator('.cmdk-row[aria-selected="true"]');
    await expect(active).toHaveCount(1);
    // the palette keeps focus in its field, so its cursor row is "selected": a fill, no ring
    await expectSelected(active, 'palette cursor row');
    expect(await active.locator('.cmdk-icon').evaluate((e) => getComputedStyle(e).color)).toBe(BLACK);
    await expectNoOlive(page, '.cmdk');
    await page.keyboard.press('Escape'); // clears the query
    await page.keyboard.press('Escape'); // closes
    await expect(pal).toBeHidden();
    // a menu: the keyboard-focused item is ringed on black, hover is a white hairline
    await page.getByTestId('export-menu').click();
    const menu = page.locator('.menu[role="menu"]');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    const focused = menu.locator('.menu-item:focus-visible');
    await expect(focused).toHaveCount(1);
    await expectFocused(focused, 'focused menu item');
    // rows sit apart so the ring never touches a neighbour
    const gap = await menu.evaluate((m) => getComputedStyle(m).rowGap);
    expect(parseFloat(gap)).toBeGreaterThanOrEqual(5);
    await expectNoOlive(page, '.menu');
    await shot(page, 'r4-hc-menu');
  });

  test('Curves grid is dim over the histogram (P2-14)', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await run(page, 'view.theme-contrast');
    await run(page, 'file.open');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.select([editor.doc.pages[0].nodes[0].id]);
    });
    await page.locator('select[aria-label="Add adjustment"]').selectOption('curves');
    const graph = page.locator('.curves-graph');
    await expect(graph).toBeVisible();
    await page.waitForTimeout(400); // histogram is computed after the first paint
    // median brightness down each inner vertical grid line: white would be 255
    const medians = await graph.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')!;
      const dpr = c.width / c.clientWidth;
      const PAD = 6;
      const size = c.clientWidth - 2 * PAD;
      const out: number[] = [];
      for (let i = 1; i < 4; i++) {
        const x = Math.floor((PAD + Math.round((size * i) / 4) + 0.5) * dpr);
        const col = ctx.getImageData(x, Math.round(PAD * dpr), 1, Math.round(size * dpr)).data;
        const v: number[] = [];
        for (let k = 0; k < col.length; k += 4) v.push(Math.max(col[k], col[k + 1], col[k + 2]));
        v.sort((a, b) => a - b);
        out.push(v[Math.floor(v.length / 2)]);
      }
      return out;
    });
    for (const m of medians) {
      expect(m).toBeGreaterThan(20); // the grid is still there
      expect(m).toBeLessThan(170); // but dim, never solid white
    }
    await shot(page, 'r4-hc-curves');
  });
});
