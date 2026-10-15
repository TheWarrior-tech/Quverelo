/**
 * Over-the-air updates against a local generic feed (policy updateFeedUrl).
 * The app runs unpackaged, so QUVRELO_UPDATER_FORCE=1 turns on check-only mode.
 * Screenshots go to QUVRELO_OTA_SHOTS (if set).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { launch, run } from './helpers';

const shots = process.env.QUVRELO_OTA_SHOTS ?? '';
const NEXT = '9.9.0';

const yml = `version: ${NEXT}
files:
  - url: Quvrelo-${NEXT}-x86_64.AppImage
    sha512: ${'A'.repeat(86)}==
    size: 123456789
  - url: Quvrelo-${NEXT}-amd64.deb
    sha512: ${'B'.repeat(86)}==
    size: 98765432
path: Quvrelo-${NEXT}-x86_64.AppImage
sha512: ${'A'.repeat(86)}==
releaseDate: '2026-10-20T09:00:00.000Z'
releaseNotes: |
  <h3>Layout studio</h3>
  <ul><li>Text frames flow across pages</li><li>Baseline grid with snapping</li></ul>
  <h3>Fixes</h3>
  <ul><li>Brush strokes no longer stutter on large photos</li><li>PDF export keeps spot colours</li></ul>
`;

let server: http.Server;
let feed = '';
const requests: string[] = [];

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    if (/^\/(latest|beta)[^/]*\.yml/.test(req.url ?? '')) {
      res.writeHead(200, { 'Content-Type': 'text/yaml' });
      res.end(yml);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  feed = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

function policyFile(extra: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-pol-'));
  const p = path.join(dir, 'policy.json');
  fs.writeFileSync(p, JSON.stringify({ updateFeedUrl: feed, ...extra }));
  return p;
}

async function snap(page: import('@playwright/test').Page, name: string, locator?: import('@playwright/test').Locator) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(250); // let the 120 ms rise finish
  if (locator) await locator.screenshot({ path: path.join(shots, `${name}.png`) });
  else await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

test('Check for Updates finds a newer version on the internal feed', async () => {
  const { app, page } = await launch({ QUVRELO_POLICY_PATH: policyFile(), QUVRELO_UPDATER_FORCE: '1' });
  await page.click('[data-template="poster-a4"]');
  await expect(page.locator('.workspace')).toBeVisible();
  await run(page, 'help.check-updates');
  const dlg = page.locator('.updates-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-status="available"]')).toContainText(`Quvrelo ${NEXT} is available`);
  await expect(dlg).toContainText('Text frames flow across pages');
  await expect(dlg).toContainText('127.0.0.1');
  await expect(dlg.getByRole('button', { name: 'Download Update' })).toBeVisible();
  expect(requests.some((r) => /^\/latest[^/]*\.yml/.test(r))).toBe(true);
  await snap(page, 'updates-dialog-available-dark');
  await snap(page, 'updates-dialog-available-dark-crop', dlg);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await app.close();
});

test('ready toast and status-bar indicator; Restart goes to the main process', async () => {
  const { app, page } = await launch({ QUVRELO_POLICY_PATH: policyFile(), QUVRELO_UPDATER_FORCE: '1' });
  await page.click('[data-template="poster-a4"]');
  await expect(page.locator('.workspace')).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.quvrelo.getUpdateState())).mode).toBe('notify');
  const base = await page.evaluate(() => window.quvrelo.getUpdateState());
  // Simulate the main process finishing a background download (dev builds never install).
  await app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()[0].webContents.send('update:state', s);
  }, { ...base, status: 'downloading', latest: NEXT, progress: { percent: 42.4, transferred: 52_000_000, total: 123_000_000, bytesPerSecond: 3_100_000 } });
  await expect(page.locator('.update-ind')).toContainText('Downloading update 42%');
  await run(page, 'help.check-updates');
  const dlg = page.locator('.updates-dialog');
  await expect(dlg.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '42');
  await snap(page, 'updates-dialog-downloading-dark', dlg);
  await page.keyboard.press('Escape');

  await app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()[0].webContents.send('update:state', s);
  }, { ...base, status: 'ready', mode: 'auto', action: 'restart', latest: NEXT, progress: null });
  const t = page.locator('.toast', { hasText: `Quvrelo ${NEXT} is ready` });
  await expect(t).toBeVisible();
  await expect(t.getByRole('button', { name: 'Restart' })).toBeVisible();
  await expect(page.locator('.update-ind')).toContainText('Restart to update');
  await t.hover(); // keep it up while capturing
  await snap(page, 'updates-toast-ready-dark');
  await app.close();
});

test('Preferences shows update settings locked by policy', async () => {
  const { app, page } = await launch({ QUVRELO_POLICY_PATH: policyFile({ updateChannel: 'stable', autoDownload: false }), QUVRELO_UPDATER_FORCE: '1' });
  await run(page, 'app.preferences');
  await page.click('[data-pane="general"]');
  const ch = page.getByRole('radiogroup', { name: 'Update channel' });
  await expect(ch).toBeVisible();
  await expect(ch.getByRole('radio', { name: 'Beta' })).toBeDisabled();
  await expect(page.locator('#pref-autodl')).toBeDisabled();
  await expect(page.locator('.dialog')).toContainText('Set by your organisation');
  await snap(page, 'updates-preferences-locked-dark', page.locator('.dialog'));
  await app.close();
});

test('disableUpdateCheck removes updates entirely', async () => {
  const { app, page } = await launch({ QUVRELO_POLICY_PATH: policyFile({ disableUpdateCheck: true }), QUVRELO_UPDATER_FORCE: '1' });
  await expect.poll(async () => (await page.evaluate(() => window.quvrelo.getUpdateState())).status).toBe('disabled');
  requests.length = 0;
  await run(page, 'help.check-updates');
  await expect(page.locator('.updates-dialog [data-status="disabled"]')).toBeVisible();
  expect(requests).toHaveLength(0);
  await app.close();
});
