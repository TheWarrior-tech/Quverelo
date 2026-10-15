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
});
