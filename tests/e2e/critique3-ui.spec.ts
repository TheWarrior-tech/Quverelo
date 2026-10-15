/**
 * Critique 3 UI fixes (docs/design/CRITIQUE-3.md): N1 document units, N4 Photo
 * always has an active layer, N2 context bar never clips (priority+ "More"),
 * N7 themed scrollbars + scroll edges in dialogs, N3 one Curves reset per scope.
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { launch, pickTool, run, state, type Launched } from './helpers';

const photo = path.resolve('tests/fixtures/sample-photo.jpg'); // 1264 x 848

/** New A4 document from the Print preset (Welcome ▸ A4 page). */
async function newA4(page: Page) {
  await page.locator('[data-start="layout"]').click();
  await expect(page.locator('[data-preset="a4"]')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('create-document').click();
  await expect(page.locator('.workspace')).toBeVisible();
}

async function openPhoto(page: Page) {
  await run(page, 'file.open');
  await expect(page.locator('.workspace')).toBeVisible();
}

/** Every tool on the rail of the current studio, flyout members included. */
async function railTools(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ids = new Set<string>();
    document.querySelectorAll<HTMLElement>('.toolpalette [data-tool]').forEach((b) => ids.add(b.dataset.tool!));
    document.querySelectorAll<HTMLElement>('.toolpalette [data-group-tools]').forEach((b) => b.dataset.groupTools!.split(/\s+/).forEach((t) => t && ids.add(t)));
    return [...ids];
  });
}

async function contextbarFits(page: Page): Promise<{ fits: boolean; sw: number; cw: number }> {
  return page.locator('.contextbar').evaluate((el) => ({ fits: el.scrollWidth <= el.clientWidth + 1, sw: el.scrollWidth, cw: el.clientWidth }));
}

test.describe('critique 3: UI', () => {
  let L: Launched | undefined;
  test.afterEach(async () => {
    await L?.app.close();
    L = undefined;
  });

  test('N1: a print document reads in its own unit everywhere', async () => {
    L = await launch();
    const { page } = L;
    await newA4(page);
    expect(await state<string>(page, 'editor.doc.settings.unit')).toBe('mm');
    // status bar and inspector › Document: mm, with output pixels as a hint
    await expect(page.getByTestId('status-size')).toHaveText('210 × 297 mm');
    await expect(page.getByLabel('Document units')).toHaveValue('mm');
    await expect(page.getByTestId('doc-size')).toContainText('210 × 297 mm');
    await expect(page.getByTestId('doc-size')).toContainText('2480 × 3508 px at 300 dpi');
    // Layout context bar margins in mm (an ISO preset is 15 mm, never ½ in as 12.7, CRITIQUE-4 P2-24), never px
    await expect(page.getByRole('spinbutton', { name: 'Top margin (mm)' })).toHaveValue('15');
    // typing 20 means 20 mm
    const top = page.getByRole('spinbutton', { name: 'Top margin (mm)' });
    await top.fill('20');
    await top.press('Enter');
    await expect(top).toHaveValue('20');
    expect(await state<number>(page, 'editor.doc.settings.margins.top')).toBeCloseTo((20 * 96) / 25.4, 3);

    // an object the size of the page: the inspector W field reads 210
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const w = (210 * 96) / 25.4, h = (297 * 96) / 25.4;
      const rect = { id: 'page-rect', name: 'Box', type: 'rect', x: w / 2, y: h / 2, w, h, radius: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false, visible: true, locked: false, opacity: 1, blend: 'normal', fill: { type: 'solid', color: '#e63946' }, stroke: { paint: { type: 'none' }, width: 0, dash: [], cap: 'butt', join: 'miter' } };
      editor.commit('Add', (d: any) => ({ ...d, pages: d.pages.map((p: any, i: number) => (i === 0 ? { ...p, nodes: [...p.nodes, rect] } : p)) }));
      editor.select(['page-rect']);
    });
    await expect(page.getByRole('spinbutton', { name: 'Width (mm)' })).toHaveValue('210');
    await expect(page.getByRole('spinbutton', { name: 'Height (mm)' })).toHaveValue('297');
    await expect(page.locator('.section-head', { hasText: 'Transform' })).toContainText('mm');

    // Document setup shows the margin the user typed
    await run(page, 'file.document-setup');
    const dlg = page.locator('.dialog');
    await expect(dlg.getByLabel('Document units')).toHaveValue('mm');
    await expect(dlg.getByRole('spinbutton', { name: 'Top margin' })).toHaveValue('20');
    await page.keyboard.press('Escape');

    // PDF export: page size in mm, pt in the tooltip
    await run(page, 'file.export-pdf');
    await expect(page.getByTestId('export-dims')).toHaveText('210 × 297 mm');
    await expect(page.getByTestId('export-dims')).toHaveAttribute('data-tip', '595 × 842 pt');
    await page.keyboard.press('Escape');

    // the status-bar select changes the document unit (undoable), and every readout follows
    await page.getByLabel('Document units').selectOption('in');
    expect(await state<string>(page, 'editor.doc.settings.unit')).toBe('in');
    await expect(page.getByTestId('status-size')).toHaveText('8.268 × 11.693 in');
    await expect(page.getByRole('spinbutton', { name: 'Width (in)' })).toHaveValue('8.268');
    await run(page, 'edit.undo');
    await expect(page.getByTestId('status-size')).toHaveText('210 × 297 mm');
  });

  test('N1 / P2-17: a photo stays in px; its PDF page size comes from its Output DPI', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await expect(page.getByTestId('status-size')).toHaveText('1264 × 848 px');
    await run(page, 'file.export-pdf');
    // 1264 × 848 px at the document's 300 dpi (CRITIQUE-4 P2-17), not 96 px/in
    await expect(page.getByTestId('export-dims')).toHaveText('107 × 71.8 mm');
    await expect(page.getByTestId('export-dims')).toHaveAttribute('data-tip', '303 × 204 pt');
    await page.keyboard.press('Escape');
  });

  test('N4 / R2: Photo always has an active layer, separate from the selection; Adjust and the status bar tell the truth', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
    // the Background pixel layer is active on open, without an object selection
    expect(await state<string>(page, 'editor.activeLayer().type')).toBe('raster');
    expect(await state<number>(page, 'editor.ui.selection.length')).toBe(0);
    await expect(page.locator('.layer-row.selected')).toHaveCount(1);
    await expect(page.getByTestId('status-selection')).toHaveText('Layer Background');
    await page.locator('.inspector').getByRole('tab', { name: 'Adjust' }).click();
    await expect(page.getByText('Place a photo…')).toHaveCount(0);
    await expect(page.getByLabel('Add adjustment')).toBeVisible();

    // deselecting keeps the active layer: Adjust never asks to pick one
    await run(page, 'edit.select-all');
    await run(page, 'edit.deselect');
    await expect(page.getByLabel('Add adjustment')).toBeVisible();
    await expect(page.getByText('Select a layer to adjust')).toHaveCount(0);

    // a pixel selection is reported in the status bar
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.setUi({ pixelSelection: [['M', 10, 20], ['L', 422, 20], ['L', 422, 406], ['L', 10, 406], ['Z']] });
    });
    await expect(page.getByTestId('status-selection')).toHaveText('Selection 412 × 386 px');
    await page.evaluate(() => (window as any).__quvrelo.editor.setUi({ pixelSelection: null }));

    // deleting the active layer activates the next pixel layer down
    await page.locator('.layer-row').first().click();
    await run(page, 'edit.duplicate');
    expect(await state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(2);
    const dup = await state<string>(page, 'editor.ui.activeLayerId');
    await run(page, 'edit.delete');
    expect(await state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(1);
    expect(await state<string>(page, 'editor.ui.activeLayerId')).not.toBe(dup);
    expect(await state<string>(page, 'editor.activeLayer().type')).toBe('raster');
  });

  test('N2: the context bar never clips at 1280 and 1440; page setup overflows into More', async () => {
    L = await launch();
    const { page } = L;
    await newA4(page);
    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(150);
      for (const studio of ['layout', 'vector', 'photo'] as const) {
        await page.evaluate((s) => (window as any).__quvrelo.editor.setStudio(s), studio);
        await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
        for (const tool of await railTools(page)) {
          await page.evaluate((t) => (window as any).__quvrelo.editor.setTool(t), tool);
          await page.waitForTimeout(30);
          const r = await contextbarFits(page);
          expect(r, `${studio}/${tool} at ${width}: ${r.sw} > ${r.cw}`).toMatchObject({ fits: true });
        }
      }
    }
    // Layout Move at 1280: page navigation stays, the rest is one click away
    await page.evaluate(() => { const { editor } = (window as any).__quvrelo; editor.setStudio('layout'); editor.setTool('move'); editor.select([]); });
    await expect(page.locator('.contextbar [aria-label="Pages"]')).toBeVisible();
    const more = page.getByRole('button', { name: 'More options' });
    await expect(more).toBeVisible();
    await more.click();
    const pop = page.locator('.ctx-more-pop');
    await expect(pop).toBeVisible();
    await expect(pop.getByRole('spinbutton', { name: 'Bleed (mm)' })).toBeVisible();
    await page.keyboard.press('Escape');
    // wide enough: nothing is tucked away
    await page.setViewportSize({ width: 1920, height: 1000 });
    await expect(page.getByRole('button', { name: 'More options' })).toHaveCount(0);
    await expect(page.locator('.contextbar').getByRole('spinbutton', { name: 'Bleed (mm)' })).toBeVisible();
  });

  test('N7: themed scrollbars (no global scrollbar-width) and scroll edges in dialogs', async () => {
    L = await launch();
    const { page } = L;
    await page.setViewportSize({ width: 1440, height: 640 });
    await run(page, 'app.preferences');
    await page.locator('.dialog [data-pane="general"]').click();
    const main = page.locator('.dialog .dlg-main');
    await expect(main).toBeVisible();
    // the standard properties no longer override ::-webkit-scrollbar
    expect(await main.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('auto');
    expect(await main.evaluate((el) => getComputedStyle(el).scrollbarColor)).toBe('auto');
    // a pane taller than the dialog shows the "more below" edge; scrolled to the end its last row is whole
    const scrolls = await main.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    if (scrolls) {
      await expect(main).toHaveAttribute('data-scroll-bottom', '');
      await main.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expect(main).not.toHaveAttribute('data-scroll-bottom', '');
      await expect(main).toHaveAttribute('data-scroll-top', '');
      const clipped = await main.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const rows = Array.from(el.querySelectorAll<HTMLElement>('.pref-row, .row'));
        const last = rows[rows.length - 1];
        return last ? last.getBoundingClientRect().bottom > box.bottom + 0.5 : false;
      });
      expect(clipped).toBe(false);
    }
    await page.keyboard.press('Escape');
  });

  test('N3: one reset per scope in Curves', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    await page.locator('.inspector').getByRole('tab', { name: 'Adjust' }).click();
    await page.getByLabel('Add adjustment').selectOption('curves');
    const card = page.locator('.adjust-item').first();
    // header: eye + ⋯, no reset or trash icon of its own
    await expect(card.locator('header').getByRole('button', { name: /^Reset/ })).toHaveCount(0);
    await expect(card.locator('header').getByRole('button', { name: 'Hide Curves' })).toHaveCount(1);
    // exactly one reset icon on the card: the channel's
    await expect(card.getByRole('button', { name: /^Reset .* curve$/ })).toHaveCount(1);
    await expect(card.getByRole('button', { name: 'Reset RGB curve' })).toBeVisible();
    await card.getByRole('button', { name: 'Curves options' }).click();
    await expect(page.getByRole('menuitem', { name: 'Reset all channels' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete adjustment' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Delete adjustment' }).click();
    await expect(page.locator('.adjust-item')).toHaveCount(0);
  });
});
