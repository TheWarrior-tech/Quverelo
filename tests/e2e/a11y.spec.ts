/**
 * Accessibility guarantees from docs/DESIGN.md §9 that must not regress:
 * icon-only buttons are named and have a tooltip, keyboard focus is always
 * visible (2px, 3px in high contrast), and reduced motion removes motion.
 */
import { test, expect, type Page } from '@playwright/test';
import { launch, run, type Launched } from './helpers';

/** Icon-only buttons (no visible text) that lack an aria-label or a tooltip. */
async function unnamedIconButtons(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>(`${sel} button`))) {
      if (b.offsetParent === null) continue;
      const text = (b.textContent ?? '').trim();
      const iconOnly = text.length === 0 || (b.querySelector('svg') !== null && text.length <= 1);
      if (!iconOnly) continue;
      const label = b.getAttribute('aria-label') ?? '';
      const title = b.getAttribute('title') ?? '';
      if (!label || !title || !title.startsWith(label)) out.push(b.outerHTML.slice(0, 140));
    }
    return out;
  }, scope);
}

/** Tab through the UI and return elements whose focus indicator is missing or thinner than `min` px. */
async function invisibleFocus(page: Page, steps: number, min: number): Promise<{ bad: string[]; visited: number }> {
  const bad: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate((minPx) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      if (!el.dataset.a11yId) el.dataset.a11yId = String(Math.random());
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= minPx;
      // range inputs draw the ring on the thumb via box-shadow
      const thumbRing = el instanceof HTMLInputElement && el.type === 'range';
      const shadow = cs.boxShadow !== 'none' && cs.boxShadow.includes('px');
      return outline || thumbRing || shadow ? null : `${el.tagName.toLowerCase()}.${el.className} [${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)}] outline=${cs.outlineStyle} ${cs.outlineWidth}`;
    }, min);
    if (r) bad.push(r);
    const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.a11yId ?? '');
    if (id) seen.add(id);
  }
  return { bad, visited: seen.size };
}

test.describe('accessibility', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('every icon-only button has an aria-label and a tooltip, in every studio', async () => {
    L = await launch();
    const { page } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    for (const studio of ['vector', 'layout', 'photo']) {
      await page.click(`.studio-switch [data-studio="${studio}"]`);
      expect(await unnamedIconButtons(page, '.topbar'), `${studio} top bar`).toEqual([]);
      expect(await unnamedIconButtons(page, '.toolpalette'), `${studio} tool rail`).toEqual([]);
      expect(await unnamedIconButtons(page, '.contextbar'), `${studio} context bar`).toEqual([]);
      expect(await unnamedIconButtons(page, '.statusbar'), `${studio} status bar`).toEqual([]);
      expect(await unnamedIconButtons(page, '.canvas-area'), `${studio} canvas`).toEqual([]);
    }
    // tooltips carry the real shortcut
    await expect(page.locator('button[data-tool="move"]')).toHaveAttribute('title', 'Move (V)');
    await expect(page.locator('button[data-tool="move"]')).toHaveAttribute('aria-label', 'Move');
    await expect(page.locator('.topbar button[aria-label="Undo"]')).toHaveAttribute('title', /^Undo \((Ctrl\+Z|⌘Z)\)$/);
  });

  for (const theme of ['dark', 'light', 'high-contrast'] as const) {
    test(`keyboard focus is visible on every stop (${theme})`, async () => {
      L = await launch();
      const { page } = L;
      await page.click('[data-template="social"]');
      await expect(page.locator('.workspace')).toBeVisible();
      await run(page, theme === 'dark' ? 'view.theme-dark' : theme === 'light' ? 'view.theme-light' : 'view.theme-contrast');
      await page.locator('.topbar button').first().focus();
      const { bad, visited } = await invisibleFocus(page, 60, theme === 'high-contrast' ? 3 : 2);
      expect(visited, 'tab order reached enough controls').toBeGreaterThan(25);
      expect(bad).toEqual([]);
    });
  }

  test('prefers-reduced-motion removes transitions and animations', async () => {
    L = await launch();
    const { page } = L;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    const t = await page.evaluate(() => {
      const b = document.querySelector('.topbar .icon-btn')!;
      const cs = getComputedStyle(b);
      const after = getComputedStyle(b, '::after');
      return { transition: cs.transitionDuration, animation: cs.animationName, afterTransition: after.transitionDuration };
    });
    expect(t.transition.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
    expect(t.afterTransition.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
    expect(t.animation).toBe('none');
  });
});
