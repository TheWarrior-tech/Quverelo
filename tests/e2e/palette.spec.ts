/**
 * Command palette (UX audit P0-1) and custom tooltips (P1-1), driven through
 * the keyboard and pointer only: no runCommand for the behaviour under test.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { launch, run, state, type Launched } from './helpers';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
/** Where the review screenshots go (dark theme). Unset = skipped. */
const SHOT_DIR = process.env.QUVRELO_PALETTE_SHOTS ?? '';

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.waitForTimeout(250); // let the 120ms entrance finish
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
}

const palette = (page: Page) => page.locator('.cmdk');
const input = (page: Page) => page.getByRole('combobox', { name: /search commands/i });
const activeRow = (page: Page) => page.locator('.cmdk-row[aria-selected="true"]');

async function openPalette(page: Page) {
  await page.keyboard.press(`${MOD}+k`);
  await expect(palette(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

async function newDoc(page: Page, template = 'social') {
  await page.click(`[data-template="${template}"]`);
  await expect(page.locator('.workspace')).toBeVisible();
}

test.describe('command palette', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('opens with Ctrl/Cmd+K on Welcome and creates a document from a template', async () => {
    L = await launch();
    const { page } = L;
    await openPalette(page);
    // ARIA combobox wiring
    const listId = await input(page).getAttribute('aria-controls');
    await expect(page.locator(`#${listId}`)).toHaveAttribute('role', 'listbox');
    await expect(input(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    // document commands explain why they can't run yet
    await input(page).fill('save as');
    await expect(activeRow(page)).toContainText('Save As');
    await expect(activeRow(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(activeRow(page).locator('.cmdk-meta')).toHaveText(/document first/);
    // templates are searchable by description, too
    await input(page).fill('answer lines');
    await expect(activeRow(page)).toContainText('New Worksheet');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page.locator('.workspace')).toBeVisible();
    await expect.poll(() => state<string>(page, 'editor.doc.title')).toMatch(/Worksheet/i);
  });

  test('finds tools and commands by name and synonym, shows keycaps, and runs them', async () => {
    L = await launch();
    const { page } = L;
    await newDoc(page);
    await run(page, 'view.theme-dark');

    // tool in the current studio, with its key as a keycap
    await openPalette(page);
    await input(page).fill('circle');
    await expect(activeRow(page)).toContainText('Ellipse tool');
    await expect(activeRow(page).locator('kbd')).toHaveText(['E']);
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect.poll(() => state<string>(page, 'editor.ui.tool')).toBe('ellipse');

    // synonym → Select Subject; shortcut keycaps on Save
    await openPalette(page);
    await input(page).fill('cutout');
    await expect(activeRow(page)).toContainText('Select Subject');
    await input(page).fill('save');
    const save = page.locator('.cmdk-row[data-key="cmd:file.save"]');
    await expect(save.locator('kbd')).toHaveCount(2);
    await expect(save.locator('kbd').last()).toHaveText('S');
    // matched letters are emphasised
    await expect(save.locator('mark')).toHaveText('Save');

    // multi-word query runs a command
    await input(page).fill('theme light');
    await expect(activeRow(page)).toContainText('Light Theme');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // a tool from another studio switches studio first
    await openPalette(page);
    await input(page).fill('marquee rect');
    await expect(activeRow(page)).toContainText('Rectangle marquee tool');
    await expect(activeRow(page).locator('.cmdk-meta')).toHaveText('Photo tool');
    await page.keyboard.press('Enter');
    await expect.poll(() => state<string>(page, 'editor.ui.studio')).toBe('photo');
    await expect.poll(() => state<string>(page, 'editor.ui.tool')).toBe('marquee-rect');
  });

  test('is fully keyboard operable: arrows wrap, Esc clears then closes, focus returns', async () => {
    L = await launch();
    const { page } = L;
    await newDoc(page);
    const undo = page.locator('.topbar button[aria-label="Open…"]');
    await undo.focus();
    await openPalette(page);

    const first = await input(page).getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();
    await expect(page.locator(`#${first}`)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    const second = await input(page).getAttribute('aria-activedescendant');
    expect(second).not.toBe(first);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp'); // wraps to the last option
    const last = await input(page).getAttribute('aria-activedescendant');
    const ids = await page.locator('.cmdk-row').evaluateAll((els) => els.map((e) => e.id));
    expect(last).toBe(ids[ids.length - 1]);
    // Tab keeps focus in the search field
    await page.keyboard.press('Tab');
    await expect(input(page)).toBeFocused();

    // disabled command: Enter does nothing but say why
    await input(page).fill('crop to selection');
    await expect(activeRow(page)).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeVisible();
    await expect(page.locator('.cmdk [role="status"]')).toContainText('Needs a pixel selection');

    // no results
    await input(page).fill('qwertyuiop');
    await expect(page.locator('.cmdk-empty')).toBeVisible();
    await expect(input(page)).not.toHaveAttribute('aria-activedescendant', /.+/);

    await page.keyboard.press('Escape');
    await expect(input(page)).toHaveValue('');
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(undo).toBeFocused();
    // Ctrl/Cmd+/ is an alias
    await page.keyboard.press(`${MOD}+/`);
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('remembers recently run items and lists them first', async () => {
    L = await launch();
    const { page } = L;
    await newDoc(page);
    await openPalette(page);
    await input(page).fill('zoom to fit');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await openPalette(page);
    const firstGroup = page.locator('.cmdk-group').first();
    await expect(firstGroup.locator('.cmdk-head')).toHaveText('Recent');
    await expect(firstGroup.locator('.cmdk-row').first()).toContainText('Zoom to Fit');
    await expect(activeRow(page)).toContainText('Zoom to Fit');
    // mouse: hover moves the active row, click runs
    const row = page.locator('.cmdk-row[data-key="cmd:view.theme-contrast"]');
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await row.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  });

  test('dark screenshots: palette open', async () => {
    L = await launch();
    const { page } = L;
    await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
    await newDoc(page, 'poster-a4');
    await run(page, 'view.theme-dark');
    // seed two recents the way a user would
    for (const q of ['export pdf', 'zoom to fit']) {
      await openPalette(page);
      await input(page).fill(q);
      if (q === 'export pdf') {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        continue;
      }
      await page.keyboard.press('Enter');
    }
    await openPalette(page);
    await input(page).fill('exp');
    await expect(activeRow(page)).toContainText('Export');
    await shot(page, 'palette-open.png');
    await input(page).fill('');
    await shot(page, 'palette-browse.png');
    // the same view in the other two themes, for review
    for (const t of ['light', 'contrast'] as const) {
      await page.keyboard.press('Escape');
      await expect(palette(page)).toBeHidden();
      await run(page, `view.theme-${t}`);
      await openPalette(page);
      await input(page).fill('exp');
      await shot(page, `palette-open-${t}.png`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(palette(page)).toBeHidden();
      await page.locator('button[data-tool="rect"]').hover();
      await expect(page.getByRole('tooltip')).toBeVisible();
      await shot(page, `tooltip-${t}.png`);
      await page.mouse.move(700, 450);
    }
  });
});

test.describe('tooltips', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('hover: delayed, name + keycaps + hint, hoverable, Esc dismisses, no native title', async () => {
    L = await launch();
    const { page } = L;
    await newDoc(page);
    await run(page, 'view.theme-dark');
    const tipEl = page.getByRole('tooltip');
    const rect = page.locator('button[data-tool="rect"]');
    await rect.hover();
    await page.waitForTimeout(150);
    await expect(tipEl).toBeHidden(); // not before the ~400ms delay
    await expect(tipEl).toBeVisible();
    await expect(tipEl.locator('.q-tip-text')).toHaveText('Rectangle');
    await expect(tipEl.locator('kbd')).toHaveText(['M']);
    await expect(tipEl.locator('.q-tip-hint')).toContainText('Shift');
    // opens to the right of the tool rail
    const rb = (await rect.boundingBox())!;
    const tb = (await tipEl.boundingBox())!;
    expect(tb.x).toBeGreaterThan(rb.x + rb.width);
    // no native tooltip anywhere it was hovered
    expect(await rect.getAttribute('title')).toBeNull();
    // the hint adds to the accessible name, so the trigger is described by it
    await expect(rect).toHaveAttribute('aria-describedby', 'q-tooltip');
    await shot(page, 'tooltip.png');

    // hoverable: move onto the tooltip, it stays (WCAG 1.4.13)
    await page.mouse.move(tb.x + 4, tb.y + tb.height / 2, { steps: 4 });
    await page.waitForTimeout(250);
    await expect(tipEl).toBeVisible();

    // neighbours show at once while warm (Ellipse sits in the shapes flyout; Line is the next rail button)
    const line = page.locator('.toolpalette button[data-tool="line"]');
    await line.hover();
    await expect(tipEl.locator('.q-tip-text')).toHaveText('Line', { timeout: 300 });

    // Esc dismisses without moving the pointer, and doesn't reach the app
    await page.keyboard.press('Escape');
    await expect(tipEl).toBeHidden();
    await page.waitForTimeout(600);
    await expect(tipEl).toBeHidden(); // stays dismissed while still hovered

    // leaving hides it
    await page.locator('button[data-tool="move"]').hover();
    await expect(tipEl.locator('.q-tip-text')).toHaveText('Move');
    await page.mouse.move(700, 450);
    await expect(tipEl).toBeHidden();

    // a top-bar button shows its menu shortcut as separate keycaps
    await page.locator('.topbar button[aria-label="Save"]').hover();
    await expect(tipEl.locator('kbd')).toHaveCount(2);
    await expect(tipEl.locator('kbd').last()).toHaveText('S');
  });

  test('keyboard focus shows the tooltip; Esc dismisses it without moving focus', async () => {
    L = await launch();
    const { page } = L;
    await newDoc(page);
    const open = page.locator('.topbar button[aria-label="Open…"]');
    // tab order: … Place image · studio switch · Search commands · Open (critique 2: search sits left of Open)
    await page.locator('.topbar .topbar-search').focus();
    await page.keyboard.press('Tab');
    await expect(open).toBeFocused();
    const tipEl = page.getByRole('tooltip');
    await expect(tipEl).toBeVisible();
    await expect(tipEl.locator('.q-tip-text')).toHaveText('Open…');
    await page.keyboard.press('Escape');
    await expect(tipEl).toBeHidden();
    await expect(open).toBeFocused();
    // moving focus on hides it and shows the next one
    await page.keyboard.press('Tab');
    await expect(tipEl.locator('.q-tip-text')).toHaveText('Save');
    // clicking a button does not leave a tooltip behind
    await page.locator('.topbar button[aria-label="Keyboard shortcuts"]').click();
    await expect(tipEl).toBeHidden();
  });

  test('reduced motion removes the tooltip entrance animation', async () => {
    L = await launch();
    const { page } = L;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await newDoc(page);
    await page.locator('button[data-tool="move"]').hover();
    const tipEl = page.getByRole('tooltip');
    await expect(tipEl).toBeVisible();
    expect(await tipEl.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  });
});
