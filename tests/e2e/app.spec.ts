import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { docToScreen, drag, launch, run, state, pickTool, railTools, type Launched } from './helpers';

const fixture = path.resolve('tests/fixtures/gradient.png');

test.describe('Quvrelo', () => {
  let L: Launched;

  test.afterEach(async () => {
    await L?.app.close();
  });

  test('welcome screen lists studios and the classroom pack', async () => {
    L = await launch();
    const { page } = L;
    await expect(page.locator('.welcome h1')).toHaveText('Quvrelo');
    await expect(page.locator('[data-studio-card]')).toHaveCount(3);
    expect(await page.locator('[data-template]').count()).toBeGreaterThanOrEqual(15);
    await page.waitForTimeout(500);
  });

  test('vector studio: draw, style, boolean, undo/redo, export SVG', async () => {
    L = await launch();
    const { page, saveDir } = L;
    await page.click('[data-template="social"]');
    await expect(page.locator('.workspace')).toBeVisible();
    expect(await state<string>(page, 'editor.ui.studio')).toBe('vector');
    const before = await state<number>(page, 'editor.doc.pages[0].nodes.length');
    await pickTool(page, 'rect');
    await drag(page, await docToScreen(page, 100, 120), await docToScreen(page, 420, 340));
    await pickTool(page, 'ellipse');
    await drag(page, await docToScreen(page, 300, 250), await docToScreen(page, 600, 560));
    expect(await state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(before + 2);
    // select both new shapes and add them together
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const nodes = editor.doc.pages[0].nodes;
      editor.select(nodes.slice(-2).map((n: any) => n.id));
    });
    await run(page, 'layer.bool-add');
    const last = await state<{ type: string }>(page, 'editor.doc.pages[0].nodes.at(-1)');
    expect(last.type).toBe('path');
    expect(await state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(before + 1);
    await run(page, 'edit.undo');
    expect(await state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(before + 2);
    await run(page, 'edit.redo');
    expect(await state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(before + 1);
    // pen tool
    await pickTool(page, 'pen');
    for (const [x, y] of [[700, 700], [900, 650], [950, 900]]) {
      const p = await docToScreen(page, x, y);
      await page.mouse.click(p.x, p.y);
    }
    await page.keyboard.press('Enter');
    expect(await state<string>(page, 'editor.doc.pages[0].nodes.at(-1).type')).toBe('path');
    await pickTool(page, 'move');
    await page.waitForTimeout(300);
    // export SVG through the dialog
    await run(page, 'file.export-svg');
    await page.click('[data-testid="export-go"]');
    await expect.poll(() => fs.readdirSync(saveDir).filter((f) => f.endsWith('.svg')).length).toBe(1);
    const svg = fs.readFileSync(path.join(saveDir, fs.readdirSync(saveDir).find((f) => f.endsWith('.svg'))!), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
  });

  test('photo studio: open image, adjust, paint, select, export PNG', async () => {
    L = await launch({ QUVRELO_E2E_OPEN: fixture });
    const { page, saveDir } = L;
    await run(page, 'file.open');
    await expect(page.locator('.workspace')).toBeVisible();
    expect(await state<string>(page, 'editor.ui.studio')).toBe('photo');
    expect(await state<string>(page, 'editor.doc.pages[0].nodes[0].type')).toBe('raster');
    // select the layer and add an adjustment from the panel
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.select([editor.doc.pages[0].nodes[0].id]);
    });
    await page.locator('select[aria-label="Add adjustment"]').selectOption('black-white');
    expect(await state<number>(page, 'editor.doc.pages[0].nodes[0].adjustments.length')).toBe(1);
    // paint a stroke
    const asset0 = await state<string>(page, 'editor.doc.pages[0].nodes[0].assetId');
    await pickTool(page, 'brush');
    await drag(page, await docToScreen(page, 40, 40), await docToScreen(page, 280, 160), 12);
    const asset1 = await state<string>(page, 'editor.doc.pages[0].nodes[0].assetId');
    expect(asset1).not.toBe(asset0);
    // marquee + clear
    await pickTool(page, 'marquee-rect');
    await drag(page, await docToScreen(page, 20, 20), await docToScreen(page, 120, 100));
    expect(await state<boolean>(page, '!!editor.ui.pixelSelection')).toBe(true);
    await run(page, 'select.clear');
    await page.waitForTimeout(300);
    await run(page, 'file.export-png');
    await page.click('[data-testid="export-go"]');
    await expect.poll(() => fs.readdirSync(saveDir).filter((f) => f.endsWith('.png')).length).toBe(1);
    // crop to selection
    await pickTool(page, 'marquee-rect');
    await drag(page, await docToScreen(page, 10, 10), await docToScreen(page, 210, 110));
    await run(page, 'select.crop');
    expect(await state<number>(page, 'Math.round(editor.doc.settings.width)')).toBe(200);
  });

  test('layout studio: newsletter flows text, pages, PDF export and save/open round trip', async () => {
    L = await launch();
    const { page, saveDir } = L;
    await page.click('[data-template="newsletter"]');
    expect(await state<string>(page, 'editor.ui.studio')).toBe('layout');
    expect(await state<number>(page, 'editor.doc.pages.length')).toBe(2);
    expect(await state<number>(page, 'editor.doc.masters.length')).toBe(1);
    const chain = await state<number>(page, 'Object.values(editor.doc.stories).find(s => s.chain.length > 1).chain.length');
    expect(chain).toBe(3);
    await page.waitForTimeout(400);
    // text frame tool creates a frame and starts editing
    await run(page, 'page.next');
    await pickTool(page, 'textframe');
    await drag(page, await docToScreen(page, 80, 900), await docToScreen(page, 500, 1000));
    await expect(page.locator('.text-edit-overlay')).toBeVisible();
    await page.keyboard.type('Hello from Quvrelo');
    await page.keyboard.press('Escape');
    const texts = await state<string[]>(page, 'Object.values(editor.doc.stories).map(s => s.text)');
    expect(texts).toContain('Hello from Quvrelo');
    await run(page, 'page.add');
    expect(await state<number>(page, 'editor.doc.pages.length')).toBe(3);
    await run(page, 'file.export-pdf');
    await page.click('[data-testid="export-go"]');
    await expect.poll(() => fs.readdirSync(saveDir).filter((f) => f.endsWith('.pdf')).length).toBe(1);
    const pdf = fs.readFileSync(path.join(saveDir, fs.readdirSync(saveDir).find((f) => f.endsWith('.pdf'))!));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);
    // save, close, reopen
    await run(page, 'file.save');
    await expect.poll(() => fs.readdirSync(saveDir).filter((f) => f.endsWith('.quvrelo')).length).toBe(1);
    const file = path.join(saveDir, fs.readdirSync(saveDir).find((f) => f.endsWith('.quvrelo'))!);
    await run(page, 'file.close');
    await expect(page.locator('.welcome')).toBeVisible();
    // reopen via the main-process open-path channel
    await L.app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('file:open-path', p), file);
    await expect(page.locator('.workspace')).toBeVisible();
    expect(await state<number>(page, 'editor.doc.pages.length')).toBe(3);
    const reopened = await state<string[]>(page, 'Object.values(editor.doc.stories).map(s => s.text)');
    expect(reopened).toContain('Hello from Quvrelo');
  });

  test('every tool can be activated in every studio without errors', async () => {
    L = await launch();
    const { page } = L;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message + "\n" + (e.stack ?? "").split("\n").slice(0, 8).join("\n")));
    await page.click('[data-template="blank-a4"]');
    for (const studio of ['photo', 'vector', 'layout']) {
      await run(page, `studio.${studio}`);
      const tools = await railTools(page);
      expect(tools.length).toBeGreaterThan(8);
      for (const t of tools) {
        await pickTool(page, t);
        await expect(page.locator(`.toolpalette [data-tool="${t}"]`)).toHaveClass(/active/);
        const p = await docToScreen(page, 300, 300);
        const q = await docToScreen(page, 360, 380);
        if (!['hand', 'zoom', 'crop', 'eyedropper', 'fill'].includes(t)) await drag(page, p, q, 4);
        await page.keyboard.press('Escape');
      }
    }
    expect(errors).toEqual([]);
  });

  test('admin policy disables features and locks the theme', async () => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'quvrelo-pol-'));
    const pol = path.join(dir, 'policy.json');
    fs.writeFileSync(pol, JSON.stringify({ disabledFeatures: ['photo'], forceTheme: 'high-contrast', organizationName: 'Test Academy' }));
    L = await launch({ QUVRELO_POLICY_PATH: pol });
    const { page } = L;
    await expect(page.locator('[data-studio-card]')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('high-contrast');
    await page.click('[data-template="worksheet"]');
    await expect(page.locator('.studio-switch button')).toHaveCount(2);
  });
});
