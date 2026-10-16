/**
 * Scripts panel: run a bundled example (one undo step), write and run a
 * TypeScript script in the editor, errors stay in the editor, and policy can
 * turn scripting off.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launch, run, shot, state, type Launched } from './helpers';

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

test.describe('scripts', () => {
  test('runs an example, then a TypeScript script from the editor', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="newsletter"]');
    await expect(page.locator('.workspace')).toBeVisible();
    const before = await state<number>(page, 'editor.doc.pages[0].nodes.length');
    await run(page, 'view.scripts');
    const panel = page.getByTestId('scripts-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Scripts' })).toHaveAttribute('aria-selected', 'true');

    await panel.getByRole('button', { name: 'Run Colour grid' }).click();
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(before + 24);
    await expect(panel.getByRole('log')).toContainText('Made 24 tiles');
    await shot(page, 'scripts-panel');
    await run(page, 'edit.undo');
    await expect.poll(() => state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(before);

    // new script in the editor
    await panel.getByRole('button', { name: 'New script' }).click();
    const dlg = page.getByRole('dialog', { name: 'New script' });
    await dlg.getByLabel('Name').fill('Title case');
    await dlg.getByRole('radio', { name: 'TypeScript' }).or(dlg.getByRole('button', { name: 'TypeScript' })).first().click();
    const src = dlg.getByLabel('Script source');
    await src.fill("const t: string = 'Scripted';\ndocument.title = t;\nnull.oops();");
    await dlg.getByRole('button', { name: 'Save and run' }).click();
    await expect(dlg.getByRole('alert')).toContainText('TypeError');
    await expect(dlg.getByRole('alert')).toContainText('line 3');
    expect(await state<string>(page, 'editor.doc.title')).not.toBe('Scripted');

    // Tab indents inside the editor
    await src.fill("const t: string = 'Scripted';\ndocument.title = t;");
    await src.press('End');
    await src.press('Tab');
    await expect(src).toHaveValue(/document\.title = t;  $/);
    await shot(page, 'scripts-editor');
    await dlg.getByRole('button', { name: 'Save and run' }).click();
    await expect(dlg).toBeHidden();
    await expect.poll(() => state<string>(page, 'editor.doc.title')).toBe('Scripted');
    await expect(panel.getByRole('list', { name: 'My scripts' })).toContainText('Title case');
  });

  test('policy can disable scripting', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-pol-'));
    const policy = path.join(dir, 'policy.json');
    fs.writeFileSync(policy, JSON.stringify({ disabledFeatures: ['scripting', 'export-psd'] }));
    L = await launch({ QUVRELO_POLICY_PATH: policy });
    const { page } = L;
    await page.click('[data-template="newsletter"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Scripts' })).toHaveCount(0);
    await run(page, 'view.scripts');
    await expect(page.locator('.toast', { hasText: 'turned off by your administrator' }).first()).toBeVisible();
    expect(await state<boolean>(page, "editor.feature('export-psd')")).toBe(false);
  });
});
