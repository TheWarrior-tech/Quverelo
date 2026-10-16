/**
 * Keyboard-first and screen-reader audit (axe-core, WCAG 2.1 A/AA rules) of
 * every surface: Welcome, the workspace in each studio and theme, every
 * dialog, the command palette, menus and the Scripts panel. Also proves every
 * tool and every menu command is reachable from the keyboard alone (tool keys
 * and the command palette), and that dialogs trap focus in reading order.
 *
 * axe-core (MPL-2.0) is a test-only dev dependency; it is never bundled.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { launch, run, type Launched } from './helpers';
import { STUDIO_RAIL, toolName } from '../../src/renderer/state/toolGroups';

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface Violation { id: string; impact: string; help: string; nodes: string[] }
const report: Record<string, Violation[]> = {};

async function axeScan(page: Page, label: string, include?: string): Promise<Violation[]> {
  await page.evaluate(AXE); // evaluate is not subject to the app's CSP
  // Measure the settled UI, not a frame of a dialog's fade-in: mid-animation, axe blends colours with the translucent
  // dialog and reports contrast that no user sees once it has opened (light theme, 4.49:1 on a 5.2:1 button).
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  const res = await page.evaluate(async ({ include }) => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const ctx = include ? { include: [[include]], exclude: [['.viewport canvas']] } : { exclude: [['.viewport canvas']] };
    const r = await axe.run(ctx, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
  }, { include });
  report[label] = res;
  return res.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});
test.afterAll(() => {
  const out = path.join('test-results', 'axe-report.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
});

const DIALOGS: [string, string][] = [
  ['file.new', 'New document'], ['file.export', 'Export'], ['file.document-setup', 'Document setup'], ['app.preferences', 'Preferences'],
  ['help.shortcuts', 'Keyboard shortcuts'], ['help.guide', 'Quick start guide'], ['help.about', 'About Quvrelo'], ['file.assignment', 'Assignment details'],
  ['file.hand-in', 'Hand in'], ['doc.resize', 'Resize document'],
];

test.describe('axe audit', () => {
  test('Welcome screen has no serious violations', async () => {
    L = await launch();
    expect(await axeScan(L.page, 'welcome')).toEqual([]);
    // template tiles are named by their visible words and described by the template's blurb
    const tile = L.page.locator('button[data-template="worksheet"]');
    await expect(tile).toHaveAccessibleName(/^Worksheet\s/);
    await expect(tile).toHaveAccessibleDescription(/^New document: /);
  });

  for (const theme of ['dark', 'light', 'high-contrast'] as const) {
    test(`workspace in every studio (${theme})`, async () => {
      L = await launch();
      const { page } = L;
      await page.click('[data-template="social"]');
      await expect(page.locator('.workspace')).toBeVisible();
      await run(page, theme === 'dark' ? 'view.theme-dark' : theme === 'light' ? 'view.theme-light' : 'view.theme-contrast');
      const bad: string[] = [];
      for (const studio of ['vector', 'layout', 'photo']) {
        await page.click(`.studio-switch [data-studio="${studio}"]`);
        await page.waitForTimeout(150);
        bad.push(...(await axeScan(page, `workspace-${studio}-${theme}`)).map((v) => `${studio}: ${v.id} ${v.nodes.join(', ')}`));
      }
      // the inspector's other tabs
      for (const tab of ['History', 'Scripts']) {
        await page.getByRole('tab', { name: tab }).click();
        bad.push(...(await axeScan(page, `inspector-${tab}-${theme}`, '.inspector')).map((v) => `${tab}: ${v.id} ${v.nodes.join(', ')}`));
      }
      expect(bad).toEqual([]);
    });
  }

  for (const theme of ['dark', 'light', 'high-contrast'] as const) test(`every dialog, the command palette and the export menu (${theme})`, async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await run(page, theme === 'dark' ? 'view.theme-dark' : theme === 'light' ? 'view.theme-light' : 'view.theme-contrast');
    const bad: string[] = [];
    const scan = async (label: string, include?: string) => bad.push(...(await axeScan(page, label, include)).map((v) => `${label}: ${v.id} ${v.nodes.join(', ')}`));
    for (const [cmd] of DIALOGS) {
      await run(page, cmd);
      const dlg = page.locator('.dialog');
      await expect(dlg, cmd).toBeVisible();
      await scan(`dialog-${cmd}-${theme}`, '.dialog');
      await page.keyboard.press('Escape');
      await expect(dlg).toHaveCount(0);
    }
    await run(page, 'view.scripts');
    await page.getByRole('button', { name: 'New script' }).click();
    await scan(`dialog-script-editor-${theme}`, '.dialog');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk, [role="dialog"]').first()).toBeVisible();
    await scan(`command-palette-${theme}`);
    await page.keyboard.press('Escape');

    await page.getByTestId('export-split').locator('.split-more').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await scan(`export-menu-${theme}`, '[role="menu"]');
    await page.keyboard.press('Escape');
    expect(bad).toEqual([]);
  });
});

test.describe('keyboard-first', () => {
  test('every tool in every studio is reachable from the keyboard (command palette)', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    const missing: string[] = [];
    let checked = 0;
    for (const studio of ['photo', 'vector', 'layout'] as const) {
      await page.click(`.studio-switch [data-studio="${studio}"]`);
      const tools = STUDIO_RAIL[studio].flatMap((e) => (e === '|' ? [] : typeof e === 'string' ? [e] : e.tools));
      for (const tool of tools) {
        await page.keyboard.press('Control+k');
        await page.keyboard.type(`${toolName(tool)} tool`);
        await expect(page.locator('[role="option"][aria-selected="true"]').first()).toContainText(`${toolName(tool)} tool`);
        await page.keyboard.press('Enter');
        const read = () => page.evaluate(() => {
          const e = (window as unknown as { __quvrelo: { editor: { ui: { tool: string; studio: string } } } }).__quvrelo.editor.ui;
          return `${e.studio}:${e.tool}`;
        });
        await expect.poll(read, { timeout: 2000 }).toBe(`${studio}:${tool}`).catch(() => {});
        const now = await read();
        checked++;
        if (now !== `${studio}:${tool}`) missing.push(`${studio}:${tool} → ${now}`);
        await page.keyboard.press('Escape');
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(missing).toEqual([]);
  });

  test('dialogs keep focus inside and move in reading order', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    const problems: string[] = [];
    for (const [cmd] of DIALOGS) {
      await run(page, cmd);
      await expect(page.locator('.dialog')).toBeVisible();
      const seen: { inside: boolean; name: string }[] = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        seen.push(await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const dlg = document.querySelector('.dialog');
          const name = el?.getAttribute('aria-label') || el?.textContent?.trim().slice(0, 30) || el?.id || el?.tagName || '';
          return { inside: !!(dlg && el && dlg.contains(el)), name };
        }));
      }
      if (seen.some((s) => !s.inside)) problems.push(`${cmd}: focus left the dialog`);
      if (new Set(seen.map((s) => s.name)).size < 2) problems.push(`${cmd}: fewer than two focus stops`);
      // every focusable control has an accessible name
      const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.dialog button, .dialog input, .dialog select, .dialog textarea, .dialog [role="tab"], .dialog [role="radio"]'))
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => {
          const label = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || (el.textContent ?? '').trim();
          return !label;
        })
        .map((el) => el.outerHTML.slice(0, 120)));
      if (unnamed.length) problems.push(`${cmd}: unnamed controls ${unnamed.join(' | ')}`);
      await page.keyboard.press('Escape');
    }
    expect(problems).toEqual([]);
  });
});
