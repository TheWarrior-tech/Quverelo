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

/** `extraArgs` go to Electron before the app path (e.g. --force-device-scale-factor=1.5). */
export async function launch(env: Record<string, string> = {}, extraArgs: string[] = []): Promise<Launched> {
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-save-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-ud-'));
  const args = [...extraArgs, '.'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const app = await electron.launch({
    args,
    env: {
      ...process.env,
      QUVRELO_E2E: '1',
      QUVRELO_E2E_SAVE_DIR: saveDir,
      QUVRELO_USER_DATA: userData,
      QUVRELO_POLICY_PATH: env.QUVRELO_POLICY_PATH ?? path.join(saveDir, 'no-policy.json'),
      ...env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.welcome, .workspace', { timeout: 30_000 });
  return { app, page, saveDir, userData };
}

/** Evaluate against the in-app test hook (window.__quvrelo). */
export async function state<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const { editor } = window.__quvrelo; return (${fn}); })()`) as Promise<T>;
}

export async function run(page: Page, id: string): Promise<void> {
  await page.evaluate((cmd) => (window as unknown as { __quvrelo: { runCommand: (id: string) => Promise<void> } }).__quvrelo.runCommand(cmd), id);
}

export async function canvasBox(page: Page) {
  const box = await page.locator('.viewport').boundingBox();
  if (!box) throw new Error('no viewport');
  return box;
}

/** Convert document coordinates to screen coordinates using the viewport transform. */
export async function docToScreen(page: Page, x: number, y: number) {
  const box = await canvasBox(page);
  const v = await page.evaluate(() => (window as unknown as { __quvreloVpt?: number[] }).__quvreloVpt ?? null);
  if (!v) throw new Error('viewport transform unavailable');
  return { x: box.x + x * v[0] + v[4], y: box.y + y * v[3] + v[5] };
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export const shotsDir = process.env.QUVRELO_SHOTS_DIR ?? '';
export async function shot(page: Page, name: string) {
  if (!shotsDir) return;
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
}

/**
 * Activate a tool from the rail. Tools hidden inside a flyout group (CRITIQUE #21)
 * are reached by right-clicking the group button and choosing the menu item.
 */
export async function pickTool(page: Page, tool: string): Promise<void> {
  const direct = page.locator(`.toolpalette [data-tool="${tool}"]`);
  if (await direct.count()) {
    await direct.click();
    return;
  }
  const group = page.locator(`.toolpalette [data-group-tools~="${tool}"]`);
  await group.click({ button: 'right' });
  await page.locator(`.tool-flyout [data-flyout-tool="${tool}"]`).click();
  await page.locator('.tool-flyout').waitFor({ state: 'detached' });
}

/** Every tool on the rail, flyout members included, in rail order. */
export async function railTools(page: Page): Promise<string[]> {
  return page.locator('.toolpalette [data-tool]').evaluateAll((els) =>
    els.flatMap((e) => (e.getAttribute('data-group-tools') ?? e.getAttribute('data-tool')!).split(' ')),
  );
}
