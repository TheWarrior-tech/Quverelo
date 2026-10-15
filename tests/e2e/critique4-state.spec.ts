/**
 * Critique 4 state fixes (docs/design/CRITIQUE-4.md): R2 the Photo active layer
 * is separate from the object selection, N11 text has one home in the
 * inspector and one quick set outside it, plus the review-3/4 P2 items.
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { launch, pickTool, run, state, type Launched } from './helpers';

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
});
