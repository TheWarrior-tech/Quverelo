import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface Launched {
  app: ElectronApplication;
  page: Page;
  saveDir: string;
  userData: string;
}

export async function launch(env: Record<string, string> = {}): Promise<Launched> {
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easel-save-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'easel-ud-'));
  const args = ['.'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const app = await electron.launch({
    args,
    env: {
      ...process.env,
      EASEL_E2E: '1',
      EASEL_E2E_SAVE_DIR: saveDir,
      EASEL_USER_DATA: userData,
      EASEL_POLICY_PATH: env.EASEL_POLICY_PATH ?? path.join(saveDir, 'no-policy.json'),
      ...env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.welcome, .workspace', { timeout: 30_000 });
  return { app, page, saveDir, userData };
}

/** Evaluate against the in-app test hook (window.__easel). */
export async function state<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const { editor } = window.__easel; return (${fn}); })()`) as Promise<T>;
}

export async function run(page: Page, id: string): Promise<void> {
  await page.evaluate((cmd) => (window as unknown as { __easel: { runCommand: (id: string) => Promise<void> } }).__easel.runCommand(cmd), id);
}

export async function canvasBox(page: Page) {
  const box = await page.locator('.viewport').boundingBox();
  if (!box) throw new Error('no viewport');
  return box;
}

/** Convert document coordinates to screen coordinates using the viewport transform. */
export async function docToScreen(page: Page, x: number, y: number) {
  const box = await canvasBox(page);
  const v = await page.evaluate(() => (window as unknown as { __easelVpt?: number[] }).__easelVpt ?? null);
  if (!v) throw new Error('viewport transform unavailable');
  return { x: box.x + x * v[0] + v[4], y: box.y + y * v[3] + v[5] };
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export const shotsDir = process.env.EASEL_SHOTS_DIR ?? '';
export async function shot(page: Page, name: string) {
  if (!shotsDir) return;
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
}
