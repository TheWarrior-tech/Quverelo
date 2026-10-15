/**
 * Welcome v3, first-run checklist, New Document path, canvas empty state, drop
 * overlay and the Export ▾ split button (UX audit P0-3, P0-5, P1-4, P1-7, P1-13).
 * Drives visible UI only, except where noted, so "doable without help" is tested.
 * Set WELCOME_SHOTS_DIR to also write welcome-v3.png and empty-canvas.png (dark).
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launch, state, type Launched } from './helpers';
import { displayLocation } from '../../src/core/paths';

const photo = path.resolve('tests/fixtures/sample-photo.jpg');
const png = path.resolve('tests/fixtures/gradient.png');
const shots = process.env.WELCOME_SHOTS_DIR ?? '';

async function onboardingDone(page: Page): Promise<string[]> {
  return (await state<{ done: string[] } | undefined>(page, 'editor.settings.onboarding'))?.done ?? [];
}

/** Dispatches a synthetic file drag (dragenter → optional drop) at the window, as a real OS drag does. */
async function dragFile(page: Page, file: string, type: string, opts: { drop?: boolean; leave?: boolean } = {}) {
  const b64 = fs.readFileSync(file).toString('base64');
  await page.evaluate(
    ({ b64, name, type, drop, leave }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      const fire = (t: string) => window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire('dragenter');
      fire('dragover');
      if (leave) fire('dragleave');
      if (drop) fire('drop');
    },
    { b64, name: path.basename(file), type, drop: !!opts.drop, leave: !!opts.leave },
  );
}

test.describe('Welcome and first run', () => {
  let L: Launched | undefined;
  test.afterEach(async () => {
    await L?.app.close();
    L = undefined;
  });

  test('checklist: five steps, deep links, dismiss persists', async () => {
    L = await launch();
    const { page, userData } = L;
    const list = page.getByTestId('checklist');
    await expect(list).toBeVisible();
    await expect(list.locator('[data-step]')).toHaveCount(5);
    await expect(list.locator('.cl-count')).toHaveText('0/5');
    await list.locator('[data-step="create"]').click();
    await expect(page.locator('.dialog')).toBeVisible();
    await page.getByTestId('create-document').click();
    await expect(page.locator('.workspace')).toBeVisible();
    expect(await onboardingDone(page)).toEqual(['create']);
    await page.keyboard.press('Control+W');
    await L.app.close();

    L = await launch({ QUVRELO_USER_DATA: userData });
    await expect(L.page.locator('[data-step="create"]')).toHaveAttribute('aria-label', 'Create a document, done');
    await expect(L.page.locator('.cl-count')).toHaveText('1/5');
    await L.page.getByTestId('checklist-dismiss').click();
    await expect(L.page.getByTestId('checklist')).toHaveCount(0);
    await L.app.close();

    L = await launch({ QUVRELO_USER_DATA: userData });
    await expect(L.page.locator('.welcome h1')).toHaveText('Quvrelo');
    await expect(L.page.getByTestId('checklist')).toHaveCount(0);
  });

  test('policy disableOnboarding hides the checklist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-pol-'));
    const pol = path.join(dir, 'policy.json');
    fs.writeFileSync(pol, JSON.stringify({ disableOnboarding: true }));
    L = await launch({ QUVRELO_POLICY_PATH: pol });
    await expect(L.page.locator('[data-start="photo"]')).toBeVisible();
    await expect(L.page.getByTestId('checklist')).toHaveCount(0);
    expect(await state<boolean>(L.page, 'editor.policy.disableOnboarding')).toBe(true);
  });

  test('"Edit a photo…" opens a picture as a Photo document and ticks "Place an image"', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await expect(page.locator('[data-studio-card]')).toHaveCount(3);
    await page.locator('[data-start="photo"]').click();
    await expect(page.locator('.workspace')).toBeVisible();
    expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
    expect(await state<string>(page, 'editor.doc.pages[0].nodes[0].type')).toBe('raster');
    await expect(page.getByTestId('canvas-empty')).toHaveCount(0);
    expect(await onboardingDone(page)).toContain('place');
  });

  test('search filters templates and recent files; "/" focuses it; Esc clears', async () => {
    L = await launch();
    const { page } = L;
    await page.locator('.welcome h1').click();
    await page.keyboard.press('/');
    await expect(page.getByTestId('welcome-search')).toBeFocused();
    await page.keyboard.type('timetable');
    await expect(page.locator('[data-template]')).toHaveCount(1);
    await expect(page.locator('[data-template="timetable"]')).toBeVisible();
    await expect(page.locator('[data-studio-card]')).toHaveCount(0);
    await page.getByTestId('welcome-search').fill('zzzz-nothing');
    await expect(page.getByRole('status').filter({ hasText: 'No templates or recent files match' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('welcome-search')).toHaveValue('');
    expect(await page.locator('[data-template]').count()).toBeGreaterThanOrEqual(15);
  });

  test('recent files show their folder in full with the whole path as a tooltip', async () => {
    L = await launch();
    for (const f of [png, photo]) await L.page.evaluate((x) => (window as any).quvrelo.addRecent(x), f);
    const userData = L.userData;
    await L.app.close();
    L = await launch({ QUVRELO_USER_DATA: userData });
    const { page } = L;
    const row = page.locator('[data-recent="sample-photo.jpg"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-tip', photo);
    const where = row.getByTestId('recent-where');
    // the folder in full when it fits 48 characters (CI checkouts do); deep checkouts get "/…/" in the middle
    await expect(where).toHaveText(displayLocation(photo, os.homedir()));
    expect(await where.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByTestId('welcome-search').fill('gradient');
    await expect(page.locator('[data-recent]')).toHaveCount(1);
    if (shots) {
      await page.getByTestId('welcome-search').fill('');
      await page.getByTestId('welcome-search').blur();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(shots, 'welcome-v3.png') });
    }
  });
});

test.describe('New Document: one path, inferred studio', () => {
  let L: Launched | undefined;
  test.afterEach(async () => {
    await L?.app.close();
    L = undefined;
  });

  test('Start cards open New Document preselected; studio is inferred; Open in sits under More options', async () => {
    L = await launch();
    const { page } = L;
    await page.locator('[data-start="layout"]').click();
    await expect(page.locator('[data-preset="a4"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('opens-in')).toHaveText('Opens in Layout');
    await expect(page.getByRole('radiogroup', { name: 'Open in studio' })).toHaveCount(0);
    await page.getByTestId('more-options').click();
    await expect(page.getByRole('radiogroup', { name: 'Open in studio' })).toBeVisible();
    await page.getByTestId('more-options').click();
    await page.click('[data-category="screen"]');
    await expect(page.getByTestId('opens-in')).toHaveText('Opens in Vector');
    await page.click('[data-category="photo"]');
    await expect(page.getByTestId('opens-in')).toHaveText('Opens in Photo');
    await page.keyboard.press('Escape');

    await page.locator('[data-start="vector"]').click();
    await expect(page.locator('[data-preset="square"]')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('create-document').click();
    await expect(page.locator('.workspace')).toBeVisible();
    expect(await state<string>(page, 'editor.ui.studio')).toBe('vector');
    expect(await state<number>(page, 'editor.doc.settings.width')).toBe(1080);
  });

  test('"Blank canvas" on the photo card opens the Photo category', async () => {
    L = await launch();
    await L.page.locator('[data-start-alt="photo"]').click();
    await expect(L.page.locator('[data-category="photo"]')).toHaveAttribute('aria-current', 'true');
    await expect(L.page.getByTestId('opens-in')).toHaveText('Opens in Photo');
  });
});

test.describe('Canvas empty state and drop overlay', () => {
  let L: Launched | undefined;
  test.afterEach(async () => {
    await L?.app.close();
    L = undefined;
  });

  test('empty page offers Place image / Draw a shape / Add text, and goes away on the first layer', async () => {
    L = await launch();
    const { page } = L;
    await page.locator('[data-start="layout"]').click();
    await page.getByTestId('create-document').click();
    const empty = page.getByTestId('canvas-empty');
    await expect(empty).toBeVisible();
    await expect(empty.locator('[data-empty-action]')).toHaveCount(3);
    if (shots) {
      await page.mouse.move(2, 2);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(shots, 'empty-canvas.png') });
    }
    await empty.locator('[data-empty-action="shape"]').click();
    expect(await state<string>(page, 'editor.ui.tool')).toBe('rect');
    await empty.locator('[data-empty-action="text"]').click();
    expect(await state<string>(page, 'editor.ui.tool')).toBe('text');
    const box = (await page.locator('.viewport').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.25);
    await expect(page.locator('.text-edit-overlay')).toBeVisible();
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(1);
    await expect(empty).toHaveCount(0);
    await expect.poll(() => onboardingDone(page)).toContain('text');
  });

  test('"Draw a shape" in Photo stays in Photo with the Rectangle tool (Photo has shapes now)', async () => {
    L = await launch();
    const { page } = L;
    await page.locator('[data-start-alt="photo"]').click();
    await page.getByTestId('create-document').click();
    expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
    await expect(page.getByTestId('canvas-empty').locator('[data-empty-action="shape"] .ce-keys')).toHaveText('U');
    await page.getByTestId('canvas-empty').locator('[data-empty-action="shape"]').click();
    expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
    expect(await state<string>(page, 'editor.ui.tool')).toBe('rect');
  });

  test('dragging a file shows "Drop to open" on Welcome and "Drop to place" over the canvas', async () => {
    L = await launch();
    const { page } = L;
    await dragFile(page, png, 'image/png');
    await expect(page.locator('.drop-overlay')).toHaveAttribute('data-drop-mode', 'open');
    await expect(page.locator('.drop-overlay')).toContainText('Drop to open');
    await page.evaluate(() => window.dispatchEvent(new DragEvent('dragleave', { dataTransfer: new DataTransfer(), bubbles: true })));
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(1)], 'x.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true }));
    });
    await expect(page.locator('.drop-overlay')).toHaveCount(0);

    await page.locator('[data-start="vector"]').click();
    await page.getByTestId('create-document').click();
    await dragFile(page, png, 'image/png');
    const overlay = page.locator('.drop-overlay');
    await expect(overlay).toHaveAttribute('data-drop-mode', 'place');
    const o = (await overlay.boundingBox())!;
    const v = (await page.locator('.viewport').boundingBox())!;
    expect(Math.abs(o.x - v.x) + Math.abs(o.width - v.width)).toBeLessThan(2);
    await dragFile(page, png, 'image/png', { drop: true });
    await expect(overlay).toHaveCount(0);
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(1);
    expect(await onboardingDone(page)).toContain('place');
  });
});

test.describe('Export ▾', () => {
  let L: Launched | undefined;
  test.afterEach(async () => {
    await L?.app.close();
    L = undefined;
  });

  test('Layout documents export to PDF by default; Export again repeats without the dialog', async () => {
    L = await launch();
    const { page, saveDir } = L;
    await page.locator('[data-start="layout"]').click();
    await page.getByTestId('create-document').click();
    await page.getByTestId('export-menu').click();
    const menu = page.getByRole('menu', { name: 'Export' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-menu-item="export"]')).toContainText('Opens on PDF');
    await expect(menu.locator('[data-menu-item="export-again"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(menu.locator('[data-menu-item="hand-in"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await page.getByTestId('export-split').locator('.split-main').click();
    await expect(page.locator('[data-format="pdf"]')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('export-go').click();
    await expect(page.locator('.dialog')).toHaveCount(0);
    const out = path.join(saveDir, 'Untitled.pdf');
    await expect.poll(() => fs.existsSync(out)).toBe(true);
    expect(await onboardingDone(page)).toContain('export');
    const before = fs.statSync(out).mtimeMs;
    await page.waitForTimeout(50);

    await page.getByTestId('export-menu').click();
    const again = page.locator('[data-menu-item="export-again"]');
    await expect(again).not.toHaveAttribute('aria-disabled', 'true');
    await expect(again).toContainText('PDF · Untitled.pdf');
    await again.click();
    await expect(page.locator('.toast').filter({ hasText: 'Exported again: Untitled.pdf' })).toBeVisible();
    await expect(page.locator('.dialog')).toHaveCount(0);
    expect(fs.statSync(out).mtimeMs).toBeGreaterThan(before);
  });

  test('other documents open on PNG; the menu lists every format and Hand in', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await page.getByTestId('export-menu').click();
    const items = await page.locator('[role="menu"] [data-menu-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-menu-item')));
    expect(items).toEqual(['export', 'export-again', 'export-png', 'export-jpg', 'export-svg', 'export-pdf', 'hand-in']);
    await page.locator('[data-menu-item="export"]').click();
    await expect(page.locator('[data-format="png"]')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    // keyboard: Ctrl+Shift+E is the menu accelerator for Export…
    await expect(page.locator('.topbar [data-testid="export-split"] .split-main')).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+E');
  });
});
