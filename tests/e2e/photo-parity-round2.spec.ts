/**
 * Photo parity round 2: true per-pixel (soft) selections, grey-level mask
 * painting, Pass through vs Normal for groups, resampling pixel layers inside
 * groups, and live adjustments shown while a stroke is in progress. Drives the
 * real dialogs, menus and canvas; reads pixels through window.__quvreloPhoto.
 */
import { test, expect, type Page } from '@playwright/test';
import { docToScreen, drag, launch, run, state, type Launched } from './helpers';

type RGBA = [number, number, number, number];

const P = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__quvreloPhoto[f as string](...(a as unknown[])), [fn, args] as const);

async function newPhoto(page: Page, w = 64, h = 64, bg: string | null = '#ffffff') {
  await page.evaluate(([w, h, bg]) => (window as any).__quvreloPhoto.newPhoto(w, h, bg), [w, h, bg] as const);
  await expect(page.locator('.workspace')).toBeVisible();
  await expect.poll(() => state<string>(page, 'editor.ui.studio')).toBe('photo');
}

const tool = (page: Page, t: string) => page.evaluate((x) => (window as any).__quvrelo.editor.setTool(x), t);
const opts = (page: Page, o: Record<string, unknown>) => page.evaluate((x) => (window as any).__quvrelo.editor.setToolOptions(x), o);
const ui = (page: Page, o: Record<string, unknown>) => page.evaluate((x) => (window as any).__quvrelo.editor.setUi(x), o);
const select = (page: Page, ids: string[]) => page.evaluate((x) => (window as any).__quvrelo.editor.select(x), ids);

/** Patch a node (any depth) through one undoable commit. */
async function patch(page: Page, id: string, p: Record<string, unknown>) {
  await page.evaluate(([id, p]) => {
    const { editor } = (window as any).__quvrelo;
    const map = (nodes: any[]): any[] => nodes.map((n) => (n.id === id ? { ...n, ...p } : n.type === 'group' ? { ...n, children: map(n.children) } : n));
    editor.commit('Test patch', (d: any) => ({ ...d, pages: d.pages.map((pg: any) => ({ ...pg, nodes: map(pg.nodes) })) }));
  }, [id, p] as const);
}

const close = (a: number[], b: number[], tol = 4) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);

test.describe('photo parity: round 2', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('soft selections keep partial pixels: colour range, fill, invert, add, refine edge, mask to selection', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    await P(page, 'addPatternLayer', 'gradient');
    await run(page, 'select.color-range');
    const cr = page.getByRole('dialog', { name: 'Select colour range' });
    await expect(cr).toBeVisible();
    await page.locator('#cr-mode').selectOption('highlights');
    await expect.poll(() => P(page, 'isSoftSelection')).toBe(true);
    await page.locator('[data-action="color-range-apply"]').click();
    await expect(cr).toHaveCount(0);
    expect(await P(page, 'isSoftSelection')).toBe(true);
    // a column through the tonal ramp has several partly selected levels, not just 0 / 255
    const column: number[] = [];
    for (let y = 0; y < 64; y++) column.push((await P(page, 'selectionAt', 32, y + 0.5)) as number);
    const partial = new Set(column.filter((v) => v > 12 && v < 243).map((v) => Math.round(v / 8)));
    expect(partial.size, column.join()).toBeGreaterThanOrEqual(3);
    // marching ants are the 50 % outline: inside it >= 128, outside < 128
    const sel = (await state<number[][]>(page, 'editor.ui.pixelSelection')).length;
    expect(sel).toBeGreaterThan(0);
    const yPartial = column.findIndex((v) => v > 40 && v < 215);
    const level = column[yPartial];

    // fill black on a white layer: the partly selected pixel gets a partial fill
    const white = (await P(page, 'addSolidLayer', '#ffffff')) as string;
    await select(page, [white]);
    await ui(page, { fillColor: '#000000' });
    await run(page, 'select.fill');
    const filled = (await P(page, 'layerPixel', white, 32, yPartial)) as RGBA;
    expect(Math.abs(filled[0] - (255 - level))).toBeLessThan(14);

    // invert is per pixel
    await run(page, 'select.invert');
    expect(await P(page, 'isSoftSelection')).toBe(true);
    const inv = (await P(page, 'selectionAt', 32, yPartial + 0.5)) as number;
    expect(Math.abs(inv - (255 - level))).toBeLessThan(6);
    await run(page, 'select.invert');

    // Shift-drag a marquee adds to the soft selection and keeps the soft part
    await tool(page, 'marquee-rect');
    const a = await docToScreen(page, 2, 2);
    const b = await docToScreen(page, 10, 10);
    await page.keyboard.down('Shift');
    await drag(page, a, b);
    await page.keyboard.up('Shift');
    expect(await P(page, 'isSoftSelection')).toBe(true);
    expect((await P(page, 'selectionAt', 6, 6)) as number).toBeGreaterThan(245);
    expect(Math.abs(((await P(page, 'selectionAt', 32, yPartial + 0.5)) as number) - level)).toBeLessThan(6);

    // refine edge feather on a hard rectangle produces a per-pixel soft edge
    await run(page, 'select.none');
    await drag(page, await docToScreen(page, 16, 16), await docToScreen(page, 48, 48));
    expect(await P(page, 'isSoftSelection')).toBe(false);
    await run(page, 'select.refine');
    const re = page.getByRole('dialog', { name: 'Refine edge' });
    await page.getByLabel('Feather', { exact: true }).fill('6');
    await expect.poll(() => P(page, 'isSoftSelection')).toBe(true);
    await re.locator('[data-action="refine-apply"]').click();
    const edge = (await P(page, 'selectionAt', 16.5, 32)) as number;
    expect(edge).toBeGreaterThan(50);
    expect(edge).toBeLessThan(205);
    expect((await P(page, 'selectionAt', 32, 32)) as number).toBeGreaterThan(245);

    // a grey pixel mask loads as a partly selected selection
    await run(page, 'select.none');
    const red = (await P(page, 'addSolidLayer', '#ff0000')) as string;
    await select(page, [red]);
    await run(page, 'layer.mask-add');
    await tool(page, 'brush');
    await opts(page, { brushSize: 200, brushHardness: 1, brushFlow: 1, brushOpacity: 1 });
    await ui(page, { fillColor: '#808080' });
    await drag(page, await docToScreen(page, 32, 32), await docToScreen(page, 33, 32), 3);
    await expect.poll(() => P(page, 'maskPixel', red, 32, 32)).toBeGreaterThan(110);
    await run(page, 'layer.mask-to-selection');
    expect(await P(page, 'isSoftSelection')).toBe(true);
    const fromMask = (await P(page, 'selectionAt', 32, 32)) as number;
    expect(Math.abs(fromMask - 128)).toBeLessThan(10);
  });

  test('mask painting sets any grey level (not just hide / reveal), and repeated strokes do not build past it', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    const red = (await P(page, 'addSolidLayer', '#ff0000')) as string;
    await select(page, [red]);
    await run(page, 'layer.mask-add');
    expect(await state<string>(page, 'editor.ui.maskEditId')).toBe(red);
    await tool(page, 'brush');
    await opts(page, { brushSize: 30, brushHardness: 1, brushFlow: 1, brushOpacity: 1 });
    // 25 % grey: the mask goes to ~64 (a quarter shown)
    await ui(page, { fillColor: '#404040' });
    await drag(page, await docToScreen(page, 20, 32), await docToScreen(page, 22, 32), 3);
    const m1 = (await P(page, 'maskPixel', red, 20, 32)) as number;
    expect(Math.abs(m1 - 64), `mask ${m1}`).toBeLessThan(8);
    // again with the same grey: stays ~64 (moves towards the level, never past it)
    await drag(page, await docToScreen(page, 20, 32), await docToScreen(page, 22, 32), 3);
    expect(Math.abs(((await P(page, 'maskPixel', red, 20, 32)) as number) - 64)).toBeLessThan(8);
    // 75 % grey over it raises it
    await ui(page, { fillColor: '#c0c0c0' });
    await drag(page, await docToScreen(page, 20, 32), await docToScreen(page, 22, 32), 3);
    expect(Math.abs(((await P(page, 'maskPixel', red, 20, 32)) as number) - 192)).toBeLessThan(8);
    // brush opacity 50 % with white: half way from 192 to 255
    await opts(page, { brushOpacity: 0.5 });
    await ui(page, { fillColor: '#ffffff' });
    await drag(page, await docToScreen(page, 20, 32), await docToScreen(page, 22, 32), 3);
    const half = (await P(page, 'maskPixel', red, 20, 32)) as number;
    expect(half).toBeGreaterThan(215);
    expect(half).toBeLessThan(232);
    // composited: red at that coverage over white
    const px = (await P(page, 'renderPixel', 20, 32)) as RGBA;
    expect(close(px, [255, 255 - half, 255 - half], 6), `${px}`).toBe(true);
    // far away the mask is untouched
    expect(await P(page, 'maskPixel', red, 50, 50)).toBe(255);
  });

  test('groups: Pass through (default) lets an adjustment inside reach below; Normal isolates it', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page, 64, 64, '#ffffff');
    const red = (await P(page, 'addSolidLayer', '#ff0000', { x: 0, y: 0, w: 32, h: 64 })) as string;
    await select(page, [red]);
    await run(page, 'layer.adjust-invert');
    const adj = await state<string>(page, 'editor.doc.pages[0].nodes.find((n) => n.type === "adjustment").id');
    await select(page, [red, adj]);
    await run(page, 'arrange.group');
    const g = await state<string>(page, 'editor.doc.pages[0].nodes.find((n) => n.type === "group").id');
    // pass through: the invert inside the group reaches the white page too
    expect(close((await P(page, 'renderPixel', 16, 32)) as RGBA, [0, 255, 255])).toBe(true);
    expect(close((await P(page, 'renderPixel', 48, 32)) as RGBA, [0, 0, 0])).toBe(true);
    expect(close((await P(page, 'viewportPixel', 48, 32)) as RGBA, [0, 0, 0])).toBe(true);

    // the Design panel lists Pass through for groups, selected by default
    await select(page, [g]);
    await page.getByRole('tab', { name: 'Design' }).click();
    const blend = page.locator('#prop-blend');
    await expect(blend).toBeVisible();
    await expect(blend).toHaveValue('pass-through');
    await blend.selectOption('normal');
    expect(await state<boolean>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${g}').isolated`)).toBe(true);
    // Normal: the invert only sees the group's own pixels; the page stays white
    expect(close((await P(page, 'renderPixel', 16, 32)) as RGBA, [0, 255, 255])).toBe(true);
    for (const px of [await P(page, 'renderPixel', 48, 32), await P(page, 'viewportPixel', 48, 32)] as RGBA[]) {
      expect(close(px, [255, 255, 255]), `${px}`).toBe(true);
    }
    // back to Pass through
    await blend.selectOption('pass-through');
    expect(await state<boolean>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${g}').isolated`)).toBe(false);
    expect(close((await P(page, 'renderPixel', 48, 32)) as RGBA, [0, 0, 0])).toBe(true);
  });

  test('image size resamples pixel layers inside groups (and keeps them in place)', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page, 40, 30);
    const a = (await P(page, 'addPatternLayer', 'checker')) as string;
    const b = (await P(page, 'addSolidLayer', '#00ff00', { x: 20, y: 0, w: 20, h: 30 })) as string;
    await select(page, [a, b]);
    await run(page, 'arrange.group');
    expect(await state<string>(page, 'editor.doc.pages[0].nodes[0].type')).toBe('group');
    const before = (await P(page, 'renderPixel', 30, 15)) as RGBA;
    await run(page, 'doc.resize');
    await page.locator('#resize-resample').selectOption('nearest');
    await page.getByLabel('Width in pixels').fill('80');
    await page.getByRole('dialog').getByRole('button', { name: 'Resize' }).click();
    expect(await state<number>(page, 'editor.doc.settings.height')).toBe(60);
    const asset = (id: string) => state<{ w: number; h: number }>(page, `(() => {
      const find = (ns) => { for (const n of ns) { if (n.id === '${id}') return n; if (n.type === 'group') { const f = find(n.children); if (f) return f; } } return null; };
      const c = editor.assets.get(find(editor.doc.pages[0].nodes).assetId);
      return { w: c.width, h: c.height };
    })()`);
    expect(await asset(a)).toEqual({ w: 80, h: 60 });
    expect(await asset(b)).toEqual({ w: 40, h: 60 });
    // the group did not just stretch: its scale stays 1
    expect(await state<number>(page, 'editor.doc.pages[0].nodes[0].scaleX')).toBe(1);
    // nearest neighbour: hard checker pixels doubled
    const p1 = (await P(page, 'layerPixel', a, 14, 0)) as RGBA;
    const p2 = (await P(page, 'layerPixel', a, 15, 0)) as RGBA;
    expect(p1[0]).toBe(p2[0]);
    // same picture, twice the size
    expect(close((await P(page, 'renderPixel', 60, 30)) as RGBA, before)).toBe(true);
  });

  test('live adjustments stay visible during a brush stroke in progress', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page, 64, 64, null);
    const lay = (await P(page, 'addSolidLayer', '#ffffff')) as string;
    await patch(page, lay, { adjustments: [{ id: 'adj-inv', type: 'invert', enabled: true, params: {} }] });
    await select(page, [lay]);
    expect(close((await P(page, 'viewportPixel', 48, 48)) as RGBA, [0, 0, 0])).toBe(true);
    await tool(page, 'brush');
    await opts(page, { brushSize: 10, brushHardness: 1, brushFlow: 1, brushOpacity: 1 });
    await ui(page, { fillColor: '#ff0000' });
    const s = await docToScreen(page, 10, 10);
    const e = await docToScreen(page, 20, 10);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(e.x, e.y, { steps: 6 });
    // mid-stroke: the untouched area is still inverted (black), and the paint shows inverted (cyan)
    expect(close((await P(page, 'viewportPixel', 48, 48)) as RGBA, [0, 0, 0]), 'unpainted mid-stroke').toBe(true);
    expect(close((await P(page, 'viewportPixel', 15, 10)) as RGBA, [0, 255, 255], 8), 'painted mid-stroke').toBe(true);
    await page.mouse.up();
    expect(close((await P(page, 'viewportPixel', 15, 10)) as RGBA, [0, 255, 255], 8)).toBe(true);
    expect(close((await P(page, 'layerPixel', lay, 15, 10)) as RGBA, [255, 0, 0])).toBe(true);
  });
});
