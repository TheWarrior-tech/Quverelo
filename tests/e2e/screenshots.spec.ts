/**
 * Generates the README screenshots. Runs only when QUVRELO_SHOTS_DIR is set:
 *   QUVRELO_SHOTS_DIR=docs/screenshots xvfb-run -a npx playwright test screenshots
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { docToScreen, drag, launch, run, shot, shotsDir } from './helpers';

const photo = path.resolve('tests/fixtures/sample-photo.jpg');

test.describe('README screenshots', () => {
  test.skip(!shotsDir, 'set QUVRELO_SHOTS_DIR to generate screenshots');

  test('welcome', async () => {
    const { app, page } = await launch();
    await page.waitForTimeout(800);
    await shot(page, '01-welcome');
    await app.close();
  });

  test('photo studio', async () => {
    const { app, page } = await launch({ QUVRELO_E2E_OPEN: photo });
    await run(page, 'file.open');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.select([editor.doc.pages[0].nodes[0].id]);
    });
    for (const a of ['vibrance', 'curves', 'vignette']) await page.locator('select[aria-label="Add adjustment"]').selectOption(a);
    await page.click('[data-tool="marquee-ellipse"]');
    await drag(page, await docToScreen(page, 700, 330), await docToScreen(page, 1000, 560));
    await page.waitForTimeout(600);
    await shot(page, '02-photo');
    await app.close();
  });

  test('vector studio', async () => {
    const { app, page } = await launch();
    await page.click('[data-template="poster-a4"]');
    await page.click('[data-tool="star"]');
    await drag(page, await docToScreen(page, 560, 820), await docToScreen(page, 720, 980));
    await page.click('[data-tool="move"]');
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const n = editor.doc.pages[0].nodes;
      editor.select([n[n.length - 1].id]);
    });
    await page.click('[data-panel="colour"]');
    await page.waitForTimeout(500);
    await shot(page, '03-vector');
    await app.close();
  });

  test('layout studio', async () => {
    const { app, page } = await launch({ QUVRELO_E2E_OPEN: photo });
    await page.click('[data-template="newsletter"]');
    // place the sample photo in the hero frame
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const frame = editor.doc.pages[0].nodes.find((n: any) => n.type === 'imageframe');
      editor.select([frame.id]);
    });
    await run(page, 'file.place');
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const frame = editor.doc.pages[0].nodes.find((n: any) => n.type === 'textframe' && n.w < 400);
      editor.select([frame.id]);
    });
    await page.click('[data-panel="pages"]');
    await page.waitForTimeout(900);
    await shot(page, '04-layout');
    await app.close();
  });

  test('accessibility', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-pol-'));
    const pol = path.join(dir, 'policy.json');
    fs.writeFileSync(pol, JSON.stringify({ forceTheme: 'high-contrast', organizationName: 'Example Academy' }));
    const { app, page } = await launch({ QUVRELO_POLICY_PATH: pol });
    await page.click('[data-template="worksheet"]');
    await run(page, 'help.shortcuts');
    await page.waitForTimeout(400);
    await shot(page, '05-high-contrast-shortcuts');
    await app.close();
  });
});
