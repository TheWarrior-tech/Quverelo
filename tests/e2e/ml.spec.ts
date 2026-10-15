import { expect, test } from '@playwright/test';
import * as path from 'node:path';
import { launch, run, shot, state, type Launched } from './helpers';

const fixture = path.resolve(__dirname, '../fixtures/sample-photo.jpg');
let L: Launched | null = null;

test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

test('photo studio: Select Subject runs the on-device model and makes a pixel selection', async () => {
  L = await launch({ QUVRELO_E2E_OPEN: fixture });
  const { page } = L;
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') errors.push(m.text());
  });
  await run(page, 'file.open');
  await expect(page.locator('.workspace')).toBeVisible();
  expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
  await run(page, 'select.subject');
  await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection'), { timeout: 30_000 }).toBe(true);
  const status = await state<string>(page, 'editor.ui.status');
  expect(status, errors.join('\n')).toContain('on-device model');
  console.log(status);
  await page.waitForTimeout(400);
  await shot(page, 'photo-select-subject');
});
