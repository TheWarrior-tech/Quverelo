/**
 * Photo parity: layers, all 24 blend modes, opacity, isolated groups, lock,
 * reorder, adjustment layers (editable after apply), pixel masks and clipping
 * masks. Pixels are read from the export renderer and the live viewport and
 * compared with the reference formulas in core/blend.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { docToScreen, drag, launch, run, state, type Launched } from './helpers';

type RGBA = [number, number, number, number];

const P = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => {
    const h = (window as any).__quvreloPhoto;
    return h[f as string](...(a as unknown[]));
  }, [fn, args] as const);

async function newPhoto(page: Page, w = 64, h = 64, bg: string | null = '#ffffff') {
  await page.evaluate(([w, h, bg]) => (window as any).__quvreloPhoto.newPhoto(w, h, bg), [w, h, bg] as const);
  await expect(page.locator('.workspace')).toBeVisible();
  await expect.poll(() => state<string>(page, 'editor.ui.studio')).toBe('photo');
}

/** Patch a node on the active page through one undoable commit. */
async function patch(page: Page, id: string, p: Record<string, unknown>) {
  await page.evaluate(([id, p]) => {
    const { editor } = (window as any).__quvrelo;
    const map = (nodes: any[]): any[] => nodes.map((n) => (n.id === id ? { ...n, ...p } : n.type === 'group' ? { ...n, children: map(n.children) } : n));
    editor.commit('Test patch', (d: any) => ({ ...d, pages: d.pages.map((pg: any) => ({ ...pg, nodes: map(pg.nodes) })) }));
  }, [id, p] as const);
}

const close = (a: number[], b: number[], tol = 3) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);

const MODES = [
  'normal', 'darken', 'multiply', 'color-burn', 'linear-burn', 'lighten', 'screen', 'color-dodge', 'linear-dodge',
  'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix',
  'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity',
];

test.describe('photo parity: layers', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('all 24 blend modes match the reference formulas at 60 % opacity (export and live canvas); Blend menu lists them', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    const below = '#3366cc';
    await P(page, 'addSolidLayer', below);
    const top = (await P(page, 'addSolidLayer', '#cc8844')) as string;
    const b: RGBA = [0x33, 0x66, 0xcc, 255];
    const s: RGBA = [0xcc, 0x88, 0x44, 255];
    const failures: string[] = [];
    for (const mode of MODES) {
      await patch(page, top, { blend: mode, opacity: 0.6 });
      const ref = (await P(page, 'referenceBlend', mode, b, s, 0.6)) as RGBA;
      const out = (await P(page, 'renderPixel', 32, 32)) as RGBA;
      const live = (await P(page, 'viewportPixel', 32, 32)) as RGBA;
      if (!close(out, ref)) failures.push(`${mode} export ${out} vs ${ref}`);
      if (!close(live, ref)) failures.push(`${mode} viewport ${live} vs ${ref}`);
    }
    expect(failures).toEqual([]);
    // the Design panel's Blend menu offers every mode in Photo
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), top);
    await page.getByRole('tab', { name: 'Design' }).click();
    const opts = await page.locator('#prop-blend option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(new Set(opts)).toEqual(new Set(MODES));
    await page.locator('#prop-blend').selectOption('vivid-light');
    expect(await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${top}').blend`)).toBe('vivid-light');
  });

  test('groups isolate opacity; lock blocks painting; reorder changes the stack', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    const a = (await P(page, 'addSolidLayer', '#ff0000', { x: 0, y: 0, w: 40, h: 64 })) as string;
    const b = (await P(page, 'addSolidLayer', '#0000ff', { x: 24, y: 0, w: 40, h: 64 })) as string;
    await page.evaluate(([a, b]) => (window as any).__quvrelo.editor.select([a, b]), [a, b]);
    await run(page, 'arrange.group');
    const g = await state<string>(page, 'editor.doc.pages[0].nodes[0].id');
    expect(await state<string>(page, 'editor.doc.pages[0].nodes[0].type')).toBe('group');
    await patch(page, g, { opacity: 0.5 });
    // overlap (x = 32): the group composites first, so blue at 50 % over white, not red+blue each at 50 %
    for (const px of [await P(page, 'renderPixel', 32, 32), await P(page, 'viewportPixel', 32, 32)] as RGBA[]) {
      expect(close(px, [128, 128, 255], 3), `isolated group ${px}`).toBe(true);
    }
    // ungroup, then lock blocks the brush
    await run(page, 'arrange.ungroup');
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), b);
    await run(page, 'layer.lock');
    const before = await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${b}').assetId`);
    await page.evaluate(() => (window as any).__quvrelo.editor.setTool('brush'));
    const p0 = await docToScreen(page, 50, 20);
    await drag(page, p0, { x: p0.x + 20, y: p0.y + 20 });
    expect(await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${b}').assetId`)).toBe(before);
    expect(await state<string>(page, 'editor.ui.status')).toMatch(/locked/);
    // reorder: send the blue layer backward, the overlap turns red
    await run(page, 'layer.lock');
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), b);
    await run(page, 'arrange.backward');
    const px = (await P(page, 'renderPixel', 32, 32)) as RGBA;
    expect(close(px, [255, 0, 0])).toBe(true);
  });

  test('adjustment layers: every type applies to the layers below, stays editable, can be hidden and merged', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    const base = (await P(page, 'addSolidLayer', '#996633')) as string;
    const orig = (await P(page, 'renderPixel', 10, 10)) as RGBA;
    const types: [string, Record<string, number> | null][] = [
      ['levels', { inBlack: 40, inWhite: 200 }],
      ['curves', null],
      ['hue-saturation', { hue: 120 }],
      ['brightness-contrast', { brightness: 40 }],
      ['exposure', { exposure: 1 }],
      ['vibrance', { amount: 80 }],
      ['color-balance', { midtonesCR: -80 }],
      ['black-white', null],
      ['invert', null],
      ['threshold', { level: 100 }],
      ['gradient-map', null],
    ];
    for (const [t, params] of types) {
      await run(page, `layer.adjust-${t}`);
      const id = await state<string>(page, 'editor.ui.selection[0]');
      expect(await state<string>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${id}').type`)).toBe('adjustment');
      if (params) {
        const adj = await state<Record<string, unknown>>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${id}').adjustment`);
        await patch(page, id, { adjustment: { ...adj, params: { ...(adj.params as object), ...params } } });
      }
      if (t === 'curves') {
        const adj = await state<Record<string, unknown>>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${id}').adjustment`);
        await patch(page, id, { adjustment: { ...adj, curves: { rgb: [{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 255 }], r: [{ x: 0, y: 0 }, { x: 255, y: 255 }], g: [{ x: 0, y: 0 }, { x: 255, y: 255 }], b: [{ x: 0, y: 0 }, { x: 255, y: 255 }] } } });
      }
      const out = (await P(page, 'renderPixel', 10, 10)) as RGBA;
      const live = (await P(page, 'viewportPixel', 10, 10)) as RGBA;
      expect(close(out, orig, 2), `${t} changes the pixels below`).toBe(false);
      expect(close(out, live, 3), `${t} viewport matches export (${out} / ${live})`).toBe(true);
      // hide it: back to the original
      await patch(page, id, { visible: false });
      expect(close((await P(page, 'renderPixel', 10, 10)) as RGBA, orig, 1)).toBe(true);
      await patch(page, id, { visible: true });
      await run(page, 'edit.delete');
    }
    // invert: exact, editable after apply, and only below it
    await run(page, 'layer.adjust-invert');
    const inv = await state<string>(page, 'editor.ui.selection[0]');
    expect(close((await P(page, 'renderPixel', 10, 10)) as RGBA, [255 - 0x99, 255 - 0x66, 255 - 0x33], 1)).toBe(true);
    await P(page, 'addSolidLayer', '#00ff00', { x: 0, y: 0, w: 20, h: 20 }); // above the adjustment
    expect(close((await P(page, 'renderPixel', 10, 10)) as RGBA, [0, 255, 0], 1)).toBe(true);
    expect(close((await P(page, 'renderPixel', 40, 40)) as RGBA, [255 - 0x99, 255 - 0x66, 255 - 0x33], 1)).toBe(true);
    // the Adjust panel edits the selected adjustment layer
    await page.evaluate(() => (window as any).__quvrelo.runCommand('edit.undo'));
    await run(page, 'layer.adjust-threshold');
    await page.getByRole('tab', { name: 'Adjust' }).click();
    await expect(page.locator('[data-adjustment-layer]')).toBeVisible();
    const slider = page.getByLabel('Threshold Level', { exact: true });
    await slider.fill('250');
    await expect.poll(async () => ((await P(page, 'renderPixel', 10, 10)) as RGBA)[0]).toBe(0);
    await slider.fill('10');
    await expect.poll(async () => ((await P(page, 'renderPixel', 10, 10)) as RGBA)[0]).toBe(255);
    // opacity on the adjustment layer mixes with the original
    const th = await state<string>(page, 'editor.ui.selection[0]');
    await patch(page, th, { visible: false });
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), inv);
    await patch(page, inv, { opacity: 0.5 });
    const half = (await P(page, 'renderPixel', 40, 40)) as RGBA;
    expect(close(half, [128, 128, 127], 2), `half inverted ${half}`).toBe(true);
    // merge down bakes it into the pixel layer below
    await patch(page, inv, { opacity: 1 });
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), inv);
    await run(page, 'layer.merge-down');
    expect(await state<number>(page, `editor.doc.pages[0].nodes.filter((n) => n.type === 'adjustment' && n.visible).length`)).toBe(0);
    const px = (await P(page, 'layerPixel', base, 40, 40)) as RGBA;
    expect(close(px, [255 - 0x99, 255 - 0x66, 255 - 0x33], 1)).toBe(true);
  });

  test('pixel masks: from selection, paint, invert, disable, load as selection, apply; clipping masks', async () => {
    L = await launch();
    const { page } = L;
    await newPhoto(page);
    const lay = (await P(page, 'addSolidLayer', '#ff0000')) as string;
    await page.evaluate(() => (window as any).__quvrelo.editor.setTool('marquee-rect'));
    await drag(page, await docToScreen(page, 8, 8), await docToScreen(page, 32, 56));
    await expect.poll(() => state<boolean>(page, '!!editor.ui.pixelSelection')).toBe(true);
    await run(page, 'select.save-to-mask');
    expect(await state<boolean>(page, `!!editor.doc.pages[0].nodes.find((n) => n.id === '${lay}').pixelMask`)).toBe(true);
    expect(close((await P(page, 'renderPixel', 20, 30)) as RGBA, [255, 0, 0])).toBe(true);
    expect(close((await P(page, 'renderPixel', 50, 30)) as RGBA, [255, 255, 255])).toBe(true);
    expect(close((await P(page, 'viewportPixel', 50, 30)) as RGBA, [255, 255, 255])).toBe(true);
    await expect(page.locator(`[data-mask-thumb="${lay}"]`)).toBeVisible();
    // painting the mask with black hides (mask edit is on after adding)
    expect(await state<string>(page, 'editor.ui.maskEditId')).toBe(lay);
    await page.evaluate(() => (window as any).__quvrelo.editor.setUi({ fillColor: '#000000' }));
    await page.evaluate(() => (window as any).__quvrelo.editor.setToolOptions({ brushSize: 12, brushHardness: 1 }));
    await page.evaluate(() => (window as any).__quvrelo.editor.setTool('brush'));
    const c = await docToScreen(page, 20, 30);
    await drag(page, c, { x: c.x + 1, y: c.y + 1 }, 2);
    expect(await P(page, 'maskPixel', lay, 20, 30)).toBe(0);
    expect(close((await P(page, 'renderPixel', 20, 30)) as RGBA, [255, 255, 255])).toBe(true);
    expect(close((await P(page, 'renderPixel', 12, 12)) as RGBA, [255, 0, 0])).toBe(true);
    // invert, disable
    await run(page, 'layer.mask-invert');
    expect(close((await P(page, 'renderPixel', 50, 30)) as RGBA, [255, 0, 0])).toBe(true);
    await run(page, 'layer.mask-invert');
    await run(page, 'layer.mask-enable');
    expect(close((await P(page, 'renderPixel', 50, 30)) as RGBA, [255, 0, 0])).toBe(true);
    await run(page, 'layer.mask-enable');
    // load as selection
    await run(page, 'select.none');
    await run(page, 'layer.mask-to-selection');
    expect(await state<boolean>(page, '!!editor.ui.pixelSelection')).toBe(true);
    // apply bakes the mask into alpha
    await run(page, 'layer.mask-apply');
    expect(await state<boolean>(page, `!!editor.doc.pages[0].nodes.find((n) => n.id === '${lay}').pixelMask`)).toBe(false);
    expect(((await P(page, 'layerPixel', lay, 50, 30)) as RGBA)[3]).toBe(0);
    expect(((await P(page, 'layerPixel', lay, 12, 12)) as RGBA)[3]).toBe(255);

    // clipping: a full green layer clipped to the red cut-out shows only inside it
    const g = (await P(page, 'addSolidLayer', '#00ff00')) as string;
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), g);
    await run(page, 'layer.clip');
    expect(await state<boolean>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${g}').clipped`)).toBe(true);
    for (const f of ['renderPixel', 'viewportPixel']) {
      expect(close((await P(page, f, 12, 12)) as RGBA, [0, 255, 0]), f).toBe(true);
      expect(close((await P(page, f, 50, 30)) as RGBA, [255, 255, 255]), f).toBe(true);
    }
    await expect(page.locator(`.layer-row[data-layer-id="${g}"]`)).toHaveClass(/clipped/);
    // a clipped adjustment only adjusts its clip group
    await run(page, 'layer.adjust-invert');
    const inv = await state<string>(page, 'editor.ui.selection[0]');
    expect(await state<boolean>(page, `editor.doc.pages[0].nodes.find((n) => n.id === '${inv}').clipped`)).toBe(true);
    expect(close((await P(page, 'renderPixel', 12, 12)) as RGBA, [255, 0, 255])).toBe(true);
    expect(close((await P(page, 'renderPixel', 50, 30)) as RGBA, [255, 255, 255])).toBe(true);
    // vector exports flatten these to pixels so they look the same
    expect(await P(page, 'flattenCount')).toBeGreaterThan(0);
    // release clipping
    await page.evaluate(([a, b]) => (window as any).__quvrelo.editor.select([a, b]), [g, inv]);
    await run(page, 'layer.clip');
    expect(close((await P(page, 'renderPixel', 50, 30)) as RGBA, [255, 0, 255])).toBe(true);
  });
});
