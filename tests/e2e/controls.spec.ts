/**
 * Panel controls: scrub labels, arrow-key steps, colour fields, layer rows, rail tabs.
 * Set QUVRELO_REVIEW_DIR to also capture close-ups for design review.
 */
import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { docToScreen, drag, launch, state } from './helpers';

const out = process.env.QUVRELO_REVIEW_DIR;

test('numeric fields, colour picker, layers and rail tabs', async () => {
  const { app, page } = await launch();
  await page.click('[data-template="social"]');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.click('[data-tool="rect"]');
  await drag(page, await docToScreen(page, 100, 120), await docToScreen(page, 420, 340));
  await page.click('[data-tool="move"]');
  await page.click('[data-panel="properties"]');

  // arrow keys step by 1, Shift by 10
  const x = page.getByRole('spinbutton', { name: /^X/ });
  const x0 = Number(await x.getAttribute('aria-valuenow'));
  await x.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => Math.round(Number(await x.getAttribute('aria-valuenow')) - x0)).toBe(11);

  // typing units and arithmetic
  const w = page.getByRole('spinbutton', { name: /^Width/ });
  await w.fill('100+20');
  await w.press('Enter');
  await expect.poll(async () => Math.round(Number(await w.getAttribute('aria-valuenow')))).toBe(120);
  await w.fill('1in');
  await w.press('Enter');
  await expect.poll(async () => Math.round(Number(await w.getAttribute('aria-valuenow')))).toBe(96);

  // scrubbing the label: drag right increases, one history step
  const undoBefore = await state<number>(page, 'editor.history.list.length');
  const label = page.locator('.nf', { has: page.getByRole('spinbutton', { name: /^Y/ }) }).locator('.nf-label');
  const y = page.getByRole('spinbutton', { name: /^Y/ });
  const y0 = Number(await y.getAttribute('aria-valuenow'));
  const box = (await label.boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 40, y: box.y + box.height / 2 }, 10);
  await expect.poll(async () => Number(await y.getAttribute('aria-valuenow'))).toBeGreaterThan(y0 + 5);
  expect(await state<number>(page, 'editor.history.list.length')).toBe(undoBefore + 1);

  // colour: the inspector's fill row takes a hex directly...
  const fillHex = page.getByRole('textbox', { name: 'Fill hex' });
  await fillHex.fill('ff0000');
  await fillHex.press('Enter');
  await expect.poll(() => state<string>(page, 'editor.selectedNodes()[0].fill.color')).toBe('#ff0000');
  // ...and its chip opens the shared picker: hex entry recolours, model switch shows RGB channels
  await page.locator('[data-paint="fill"] .chip-select').click();
  const hex = page.getByRole('textbox', { name: 'Hex colour' });
  await hex.fill('3366CC');
  await hex.press('Enter');
  await expect.poll(() => state<string>(page, 'editor.selectedNodes()[0].fill.color')).toBe('#3366cc');
  await page.getByRole('radio', { name: 'RGB' }).click();
  await expect(page.getByRole('spinbutton', { name: 'RGB R' })).toHaveAttribute('aria-valuenow', '51');
  await page.getByRole('spinbutton', { name: 'RGB G' }).fill('255');
  await page.getByRole('spinbutton', { name: 'RGB G' }).press('Enter');
  await expect.poll(() => state<string>(page, 'editor.selectedNodes()[0].fill.color')).toBe('#33ffcc');
  // hue strip is keyboard operable
  const hue = page.getByRole('slider', { name: 'Hue' });
  const h0 = Number(await hue.getAttribute('aria-valuenow'));
  await hue.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(hue).toHaveAttribute('aria-valuenow', String((h0 + 10) % 360));
  if (out) {
    await page.getByRole('radio', { name: 'Linear' }).click();
    await page.screenshot({ path: path.join(out, 'controls-gradient.png') });
    await page.getByRole('radio', { name: 'Solid' }).click();
    await page.getByRole('radio', { name: 'Wheel' }).click();
    await page.getByRole('radio', { name: 'HSL' }).click();
    await page.screenshot({ path: path.join(out, 'controls-wheel.png') });
    await page.getByRole('radio', { name: 'Box' }).click();
    await page.getByRole('radio', { name: 'Hex' }).click();
  }

  // layers: keyboard focus, Alt+H hides, toggles reachable
  const row = page.locator('.layer-row').first();
  await row.focus();
  await page.keyboard.press('Alt+h');
  await expect.poll(() => state<boolean>(page, 'editor.selectedNodes()[0]?.visible ?? editor.activeContainer.nodes.at(-1).visible')).toBe(false);
  await expect(row).toHaveClass(/hidden-layer/);
  await row.locator('button[aria-label="Show layer"]').click();
  await expect(row).not.toHaveClass(/hidden-layer/);

  await page.keyboard.press('Escape');

  // left rail: Layers · Pages · Assets tabs, arrow keys move between them
  const layersTab = page.getByRole('tab', { name: 'Layers' });
  await layersTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Assets' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('listbox', { name: 'Swatches' })).toBeVisible();
  if (out) await page.screenshot({ path: path.join(out, 'controls-assets.png') });
  await page.keyboard.press('Home');
  await expect(layersTab).toHaveAttribute('aria-selected', 'true');
  // inspector tabs: Design and History
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('list', { name: 'History' })).toBeVisible();
  await page.getByRole('tab', { name: 'Design' }).click();
  await app.close();
});
