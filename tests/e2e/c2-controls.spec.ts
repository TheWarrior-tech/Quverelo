/**
 * Critique 2 controls pass: one segmented control (P1-1), one colour popover
 * body (P1-3), themed text selection (P1-5), white New Document thumbnails
 * (P1-6), high-contrast canvas handles (P1-12), Done not in accent (P2-9).
 */
import { test, expect, type Page } from '@playwright/test';
import { docToScreen, drag, launch, pickTool, run, state, type Launched } from './helpers';

const THEMES = ['dark', 'light', 'high-contrast'] as const;
const themeCmd = (t: (typeof THEMES)[number]) => (t === 'dark' ? 'view.theme-dark' : t === 'light' ? 'view.theme-light' : 'view.theme-contrast');

/** Overlay pixels near a colour (handles, selection box). */
async function overlayNear(page: Page, rgb: [number, number, number]) {
  return page.evaluate((c) => {
    const el = document.querySelector('.viewport-overlay') as HTMLCanvasElement;
    const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      if (Math.abs(d[i] - c[0]) < 24 && Math.abs(d[i + 1] - c[1]) < 24 && Math.abs(d[i + 2] - c[2]) < 24) n++;
    }
    return n;
  }, rgb);
}

test.describe('critique 2: controls', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('dialogs use the shared segmented control with a visible active tile in every theme', async () => {
    L = await launch();
    const { page } = L;
    await run(page, 'file.new');
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    expect(await page.locator('.seg').count()).toBe(0);
    const group = dlg.getByRole('radiogroup', { name: 'Background' });
    await expect(group).toHaveClass(/\bsegmented\b/);
    await expect(group).toHaveClass(/\bmd\b/);
    for (const theme of THEMES) {
      await run(page, themeCmd(theme));
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const look = await group.evaluate((g) => {
        const on = g.querySelector('[aria-checked="true"]') as HTMLElement;
        const off = g.querySelector('[aria-checked="false"]') as HTMLElement;
        const a = getComputedStyle(on);
        const b = getComputedStyle(off);
        return { onBg: a.backgroundColor, offBg: b.backgroundColor, onShadow: a.boxShadow, onOpacity: a.opacity };
      });
      // the active tile differs from the inactive one by fill or by a ring
      expect(look.onBg !== look.offBg || look.onShadow !== 'none', theme).toBe(true);
      if (theme === 'high-contrast') expect(look.onBg).toBe('rgb(255, 212, 0)');
    }
  });

  test('high contrast: a disabled active segment is never a translucent accent', async () => {
    L = await launch();
    const { page } = L;
    await run(page, 'view.theme-contrast');
    await run(page, 'app.preferences');
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await dlg.locator('[data-pane="general"]').click();
    const group = dlg.getByRole('radiogroup', { name: 'Update channel' });
    await expect(group).toBeVisible();
    const look = await group.evaluate((g) => {
      const on = g.querySelector('[aria-checked="true"]') as HTMLButtonElement;
      const s = getComputedStyle(on);
      return { disabled: on.disabled, bg: s.backgroundColor, opacity: s.opacity, outline: s.outlineStyle };
    });
    if (look.disabled) {
      expect(look.opacity).toBe('1');
      expect(look.bg).toBe('rgb(0, 0, 0)');
      expect(look.outline).toBe('dashed');
    } else {
      expect(look.bg).toBe('rgb(255, 212, 0)');
    }
    // Done is the default button, not the accent primary
    await expect(dlg.getByRole('button', { name: 'Done' })).not.toHaveClass(/\bprimary\b/);
  });

  test('context bar and inspector colour chips open the same popover body', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.click('.studio-switch [data-studio="vector"]');
    await pickTool(page, 'rect');
    // context bar Fill chip
    await page.locator('.contextbar').getByRole('button', { name: 'Fill colour' }).click();
    const pop = page.getByTestId('color-popover');
    await expect(pop).toBeVisible();
    const tabs = pop.getByRole('radiogroup', { name: 'Paint type' });
    await expect(tabs.getByRole('radio')).toHaveText(['None', 'Solid', 'Linear', 'Radial']);
    expect(await pop.locator('input[type="checkbox"]').count()).toBe(0);
    // a gradient default reaches the next drawn shape
    await tabs.getByRole('radio', { name: 'Linear' }).click();
    await expect.poll(() => state<string>(page, "editor.ui.fillGradient?.type ?? ''")).toBe('linear');
    await page.keyboard.press('Escape');
    await drag(page, await docToScreen(page, 200, 200), await docToScreen(page, 400, 360));
    await expect.poll(() => state<string>(page, "(() => { const id = editor.ui.selection[0]; const n = editor.doc.pages.flatMap((p) => p.nodes).find((x) => x.id === id); return n?.fill?.type ?? ''; })()")).toBe('linear');
    // inspector Fill chip on the new shape: same body
    await page.getByRole('tab', { name: 'Design' }).click();
    await page.locator('.paint-row[data-paint="fill"]').getByRole('button', { name: 'Fill colour' }).click();
    await expect(pop.getByRole('radiogroup', { name: 'Paint type' }).getByRole('radio')).toHaveText(['None', 'Solid', 'Linear', 'Radial']);
    await expect(pop.getByRole('radio', { name: 'Linear' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    // brush: same body, gradients and None disabled rather than hidden
    await page.click('.studio-switch [data-studio="photo"]');
    await page.click('[data-tool="brush"]');
    await page.getByRole('button', { name: 'Brush colour' }).click();
    const bt = pop.getByRole('radiogroup', { name: 'Paint type' });
    await expect(bt.getByRole('radio')).toHaveText(['None', 'Solid', 'Linear', 'Radial']);
    await expect(bt.getByRole('radio', { name: 'Linear' })).toBeDisabled();
    await expect(bt.getByRole('radio', { name: 'None' })).toBeDisabled();
    await expect(pop.getByRole('textbox', { name: 'Hex colour' })).toBeVisible();
  });

  test('text selection uses the accent wash, not the OS highlight', async () => {
    L = await launch();
    const { page } = L;
    for (const [theme, bg] of [['dark', 'rgba(60, 196, 176, 0.32)'], ['light', 'rgba(12, 122, 107, 0.24)'], ['high-contrast', 'rgb(255, 212, 0)']] as const) {
      await run(page, themeCmd(theme));
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const sel = await page.evaluate(() => {
        const s = getComputedStyle(document.body, '::selection');
        return { bg: s.backgroundColor, ink: s.color };
      });
      expect(sel.bg, theme).toBe(bg);
      if (theme === 'high-contrast') expect(sel.ink).toBe('rgb(0, 0, 0)');
    }
  });

  test('New Document: every preset page is white paper in dark and high contrast', async () => {
    L = await launch();
    const { page } = L;
    for (const theme of ['dark', 'high-contrast'] as const) {
      await run(page, themeCmd(theme));
      await run(page, 'file.new');
      const dlg = page.getByRole('dialog');
      await expect(dlg).toBeVisible();
      const sheets = await dlg.locator('.preset .glyph .sheet').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
      expect(sheets.length).toBeGreaterThan(1);
      expect(new Set(sheets), theme).toEqual(new Set(['rgb(255, 255, 255)']));
      // margins are drawn on the selected tile only
      const margins = await dlg.locator('.preset .sheet-margin').count();
      expect(margins).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(dlg).toBeHidden();
    }
  });

  test('high contrast: canvas selection handles are yellow, not teal', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.click('.studio-switch [data-studio="vector"]');
    await pickTool(page, 'rect');
    await drag(page, await docToScreen(page, 300, 300), await docToScreen(page, 500, 420));
    await page.waitForTimeout(150);
    expect(await overlayNear(page, [47, 184, 166])).toBeGreaterThan(100);
    await run(page, 'view.theme-contrast');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
    // nudge a re-render
    await page.evaluate(() => { const { editor } = (window as any).__quvrelo; editor.select([...editor.ui.selection]); });
    await page.waitForTimeout(200);
    expect(await overlayNear(page, [255, 212, 0])).toBeGreaterThan(100);
    expect(await overlayNear(page, [47, 184, 166])).toBe(0);
  });
});
