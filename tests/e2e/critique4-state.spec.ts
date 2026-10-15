/**
 * Critique 4 state fixes (docs/design/CRITIQUE-4.md): R2 the Photo active layer
 * is separate from the object selection, N11 text has one home in the
 * inspector and one quick set outside it, plus the review-3/4 P2 items.
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { launch, pickTool, run, shot, state, type Launched } from './helpers';

const photo = path.resolve('tests/fixtures/sample-photo.jpg'); // 1264 x 848

async function openPhoto(page: Page) {
  await run(page, 'file.open');
  await expect(page.locator('.workspace')).toBeVisible();
}

test.describe('critique 4: state', () => {
  let L: Launched | undefined;
  test.afterEach(async () => {
    await L?.app.close();
    L = undefined;
  });

  test('R2: the active layer survives Crop, Object Select, Esc and a fresh open', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: photo });
    const { page } = L;
    await openPhoto(page);
    const bg = await state<string>(page, 'editor.ui.activeLayerId');
    expect(bg).toBeTruthy();

    // open → Crop → Esc → Adjust shows "Add adjustment or filter…"
    await pickTool(page, 'crop');
    await page.keyboard.press('Escape');
    await page.locator('.inspector').getByRole('tab', { name: 'Adjust' }).click();
    await expect(page.getByLabel('Add adjustment')).toBeVisible();
    await expect(page.getByText('Select a layer to adjust')).toHaveCount(0);
    expect(await state<string>(page, 'editor.ui.activeLayerId')).toBe(bg);

    // Object Select and Esc keep it too; the Layers row stays marked active
    await pickTool(page, 'object-select');
    await page.keyboard.press('Escape');
    expect(await state<string>(page, 'editor.ui.activeLayerId')).toBe(bg);
    await expect(page.locator('.layer-row.selected')).toHaveCount(1);
    await expect(page.getByLabel('Add adjustment')).toBeVisible();
  });

  test('N11: a text frame has a Text section in the inspector and exactly one font trigger outside it', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="poster-a4"]');
    await expect(page.locator('.workspace')).toBeVisible();
    // select a text frame with the Move tool, as a user would
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const t = editor.doc.pages[0].nodes.find((n: any) => n.type === 'textframe');
      editor.select([t.id]);
    });
    await run(page, 'view.zoom-in');
    await page.waitForTimeout(300);
    const insp = page.locator('.inspector');
    await expect(insp.locator('[data-section="text"]')).toBeVisible();
    await expect(insp.getByRole('button', { name: 'Text frame' })).toBeVisible();
    await expect(insp.getByLabel('Font style')).toBeVisible();
    await expect(insp.getByRole('spinbutton', { name: 'Font size (pt)' })).toBeVisible();
    await expect(insp.getByRole('spinbutton', { name: 'Leading (line height multiple)' })).toBeVisible();
    await expect(insp.getByRole('spinbutton', { name: 'Tracking (thousandths of an em)' })).toBeVisible();
    await expect(insp.getByRole('radiogroup', { name: 'Text alignment' })).toBeVisible();
    // one font trigger outside the inspector (the context bar), none in the floating toolbar
    const outside = await page.locator('.font-trigger').evaluateAll((els) => els.filter((e) => !e.closest('.inspector')).length);
    expect(outside).toBe(1);
    await expect(page.locator('.selection-toolbar .font-trigger')).toHaveCount(0);
    // leading/tracking live only in the inspector
    await expect(page.locator('.contextbar').getByRole('spinbutton', { name: 'Leading (line height multiple)' })).toHaveCount(0);

    // edits apply to the story
    const story = "(() => { const n = editor.selectedNodes()[0]; return editor.doc.stories[n.storyId].style; })()";
    await insp.getByLabel('Font style').selectOption({ label: 'Bold italic' });
    expect(await state<number>(page, story + '.fontWeight')).toBe(700);
    expect(await state<boolean>(page, story + '.italic')).toBe(true);
    await insp.getByRole('radio', { name: 'Align right' }).click();
    expect(await state<string>(page, story + '.align')).toBe('right');
    const lead = insp.getByRole('spinbutton', { name: 'Leading (line height multiple)' });
    await lead.fill('1.6');
    await lead.press('Enter');
    expect(await state<number>(page, story + '.lineHeight')).toBeCloseTo(1.6);
    await insp.getByRole('button', { name: 'More type options' }).click();
    await insp.getByLabel('Capitals').selectOption('small-caps');
    expect(await state<string>(page, story + '.caps')).toBe('small-caps');
    await insp.getByLabel('Kerning').uncheck();
    expect(await state<boolean>(page, story + '.kerning')).toBe(false);
    await shot(page, 'n11-text-inspector');
  });

  test('review-3 leftovers: one page navigator, T·B·L·R margins, Gutter label, checker for transparent, no stray Ungroup, stroke width needs a stroke', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="newsletter"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.click('.studio-switch [data-studio="layout"]');
    await run(page, 'edit.deselect');
    // Layout Move with nothing selected: the context bar navigates pages, the canvas pill does not
    await expect(page.locator('.contextbar .page-count')).toBeVisible();
    await expect(page.locator('.page-indicator')).toHaveCount(0);
    // margins read T · B · L · R, as in Document setup
    const order = await page.locator('.contextbar .ctx-margins input[role="spinbutton"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(order.map((l) => l!.split(' ')[0])).toEqual(['Top', 'Bottom', expect.stringMatching(/Left|Inside/), expect.stringMatching(/Right|Outside/)]);
    // selecting an object hands page navigation to the canvas pill
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.select([editor.doc.pages[0].nodes[0].id]);
    });
    await expect(page.locator('.page-indicator')).toBeVisible();
    await expect(page.locator('.contextbar .page-count')).toHaveCount(0);
    // a single non-group layer offers no Ungroup
    await expect(page.locator('.contextbar').getByRole('button', { name: 'Ungroup' })).toHaveCount(0);

    // Document setup: margin order, "Gutter" label, checker when Transparent
    await run(page, 'file.document-setup');
    const dlg = page.locator('.dialog');
    const dsOrder = await dlg.locator('input[aria-label$="margin"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(dsOrder).toEqual(['Top margin', 'Bottom margin', 'Left margin', 'Right margin']);
    await expect(dlg.locator('.num-input', { has: page.locator('input[aria-label="Column gutter"]') }).locator('.pre')).toHaveText('Gutter');
    await dlg.getByText('Transparent').click();
    await expect(dlg.locator('.chip.transparent')).toBeVisible();
    await expect(dlg.locator('input[type="color"]')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // shape tools: W is disabled while the stroke is None
    await page.evaluate(() => (window as any).__quvrelo.editor.setUi({ strokeEnabled: false }));
    await pickTool(page, 'rect');
    const w = page.locator('.contextbar').getByRole('spinbutton', { name: 'Stroke width (px)' });
    await expect(w).toBeDisabled();
    await page.evaluate(() => (window as any).__quvrelo.editor.setUi({ strokeEnabled: true }));
    await expect(w).toBeEnabled();
  });

  test('P2: the context-bar colour popover never rides over the top bar or the context bar', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.select([editor.doc.pages[0].nodes[editor.doc.pages[0].nodes.length - 1].id]);
    });
    await pickTool(page, 'rect');
    await page.locator('.contextbar').getByRole('button', { name: 'Fill colour' }).click();
    const pop = page.getByTestId('color-popover');
    await expect(pop).toBeVisible();
    const top = (await pop.boundingBox())!.y;
    const bar = (await page.locator('.contextbar').boundingBox())!;
    expect(top).toBeGreaterThanOrEqual(bar.y + bar.height);
    await page.keyboard.press('Escape');
  });
});
