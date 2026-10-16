/**
 * Vector studio parity (Affinity Designer): pen + node editing, shapes,
 * live compounds, gradient tool, strokes, spacing, artboards, symbols, text on
 * a path, export slices and SVG import / export.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { docToScreen, drag, launch, pickTool, run, shot, state, type Launched } from './helpers';

/** A blank vector document (the Social template, emptied). */
async function blankVector(page: Page) {
  await page.click('[data-template="social"]');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.evaluate(() => {
    const { editor } = (window as any).__quvrelo;
    editor.commit('Clear', (d: any) => ({ ...d, pages: d.pages.map((p: any) => ({ ...p, nodes: [] })) }));
    editor.select([]);
  });
  // screenshot runs can render every scene in another theme (QUVRELO_SHOT_THEME=light | contrast)
  if (process.env.QUVRELO_SHOT_THEME) await run(page, `view.theme-${process.env.QUVRELO_SHOT_THEME}`);
  await run(page, 'view.zoom-fit');
  await page.waitForTimeout(100);
}

/** Close-up of one panel for design review (only when QUVRELO_SHOTS_DIR is set). */
async function panelShot(page: Page, selector: string, name: string) {
  if (!process.env.QUVRELO_SHOTS_DIR) return;
  fs.mkdirSync(process.env.QUVRELO_SHOTS_DIR, { recursive: true });
  await page.locator(selector).first().screenshot({ path: path.join(process.env.QUVRELO_SHOTS_DIR, `${name}.png`) });
}

const nodes = (page: Page) => state<any[]>(page, 'editor.doc.pages[0].nodes');
const sel = (page: Page) => state<any[]>(page, 'editor.selectedNodes()');
const at = async (page: Page, x: number, y: number) => docToScreen(page, x, y);
async function click(page: Page, x: number, y: number, opts: { shift?: boolean; alt?: boolean } = {}) {
  const p = await at(page, x, y);
  if (opts.shift) await page.keyboard.down('Shift');
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.click(p.x, p.y);
  if (opts.shift) await page.keyboard.up('Shift');
  if (opts.alt) await page.keyboard.up('Alt');
}
async function addShapes(page: Page, list: string) {
  await page.evaluate((src) => {
    const { editor } = (window as any).__quvrelo;
    const made = new Function('return ' + src)();
    editor.commit('Add', (d: any) => ({ ...d, pages: d.pages.map((p: any, i: number) => (i ? p : { ...p, nodes: [...p.nodes, ...made] })) }));
  }, list);
}
const BASE = `visible: true, locked: false, opacity: 1, blend: 'normal', rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false`;
const STROKE = `stroke: { paint: { type: 'none' }, width: 0, dash: [], cap: 'butt', join: 'miter' }`;
const rect = (id: string, x: number, y: number, w = 200, h = 200, color = '#3d6fb6') =>
  `{ id: '${id}', name: '${id}', type: 'rect', x: ${x}, y: ${y}, w: ${w}, h: ${h}, radius: 0, fill: { type: 'solid', color: '${color}' }, ${STROKE}, ${BASE} }`;
const ellipse = (id: string, x: number, y: number, w = 200, h = 200) =>
  `{ id: '${id}', name: '${id}', type: 'ellipse', x: ${x}, y: ${y}, w: ${w}, h: ${h}, fill: { type: 'solid', color: '#e07a5f' }, ${STROKE}, ${BASE} }`;

test.describe('vector studio parity', () => {
  let L: Launched;
  test.afterEach(async () => {
    await L?.app.close();
  });

  test('pen draws a curve; node tool adds, converts, deletes, breaks and joins nodes', async () => {
    L = await launch();
    const { page } = L;
    await blankVector(page);
    await pickTool(page, 'pen');
    // corner, smooth (drag), corner, then Enter
    await click(page, 200, 500);
    await drag(page, await at(page, 450, 300), await at(page, 550, 300), 6);
    // rubber band: the next segment follows the pointer, bent by the smooth node's out handle
    const hover = await at(page, 800, 500);
    await page.mouse.move(hover.x, hover.y, { steps: 3 });
    const pv = await page.evaluate(() => (window as any).__quvrelo.getViewport().activeTool.preview);
    expect(pv.d[1][0]).toBe('C');
    expect(pv.d[1][1]).toBeCloseTo(550, -1);
    expect(pv.target.x).toBeCloseTo(800, -1); // 1 screen px ≈ 1.6 doc px at this zoom
    expect(pv.target.y).toBeCloseTo(500, -1);
    await click(page, 800, 500);
    await page.keyboard.press('Enter');
    let ns = await nodes(page);
    expect(ns).toHaveLength(1);
    expect(ns[0].type).toBe('path');
    const cmds = ns[0].d.map((c: any[]) => c[0]).join('');
    expect(cmds).toMatch(/^M[LC]C/); // the dragged node made curves

    // Node tool: click a segment to add a node
    await pickTool(page, 'node');
    await page.waitForTimeout(100);
    const before = (await nodes(page))[0].d.filter((c: any[]) => c[0] !== 'Z').length;
    // a point on the straight-ish last segment: halfway from the smooth node to the end
    const mid = await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const n = editor.doc.pages[0].nodes[0];
      const last = n.d[n.d.length - 1];
      const prev = n.d[n.d.length - 2];
      // cubic at t = 0.5
      const p0 = [prev[prev.length - 2], prev[prev.length - 1]];
      const [x1, y1, x2, y2, x3, y3] = last.slice(1);
      const t = 0.5, m = 0.5;
      return { x: n.x + m ** 3 * p0[0] + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t ** 3 * x3, y: n.y + m ** 3 * p0[1] + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t ** 3 * y3 };
    });
    await click(page, mid.x, mid.y);
    await expect.poll(async () => (await nodes(page))[0].d.filter((c: any[]) => c[0] !== 'Z').length).toBe(before + 1);
    await expect(page.locator('.contextbar')).toContainText('1 of 4 nodes');

    // convert the new node to sharp from the context bar
    await page.locator('.contextbar').getByRole('button', { name: 'Sharp' }).click();
    expect(await state<string>(page, "editor.history.entries[editor.history.index].label")).toBe('Convert node');
    // delete it again
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await nodes(page))[0].d.filter((c: any[]) => c[0] !== 'Z').length).toBe(before);

    // select the middle node and break the curve there: two subpaths
    const smooth = await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const n = editor.doc.pages[0].nodes[0];
      return { x: n.x + n.d[1][n.d[1].length - 2], y: n.y + n.d[1][n.d[1].length - 1] };
    });
    await click(page, smooth.x, smooth.y);
    await run(page, 'node.break');
    await expect.poll(async () => (await nodes(page))[0].d.filter((c: any[]) => c[0] === 'M').length).toBe(2);
    // join the two curves back into one
    await page.keyboard.press('Escape');
    await run(page, 'node.join');
    await expect.poll(async () => (await nodes(page))[0].d.filter((c: any[]) => c[0] === 'M').length).toBe(1);
    // close it
    await run(page, 'node.close');
    await expect.poll(async () => (await nodes(page))[0].closed).toBe(true);
    // one undo step per action
    await run(page, 'edit.undo');
    expect((await nodes(page))[0].closed).toBe(false);
    await shot(page, 'vector-node-tool');
  });

  test('rounded rectangle and arrow tools; stroke arrowheads, dash and width profile in the inspector', async () => {
    L = await launch();
    const { page } = L;
    await blankVector(page);
    await pickTool(page, 'rrect');
    await drag(page, await at(page, 100, 100), await at(page, 400, 300));
    let n = (await sel(page))[0];
    expect(n).toMatchObject({ type: 'rect', radius: 16, name: 'Rounded rectangle' });

    await pickTool(page, 'arrow');
    await drag(page, await at(page, 100, 600), await at(page, 700, 600));
    n = (await sel(page))[0];
    expect(n.type).toBe('path');
    expect(n.stroke.endArrow).toBe('triangle');

    // inspector: start arrow, dash pattern, taper profile
    await pickTool(page, 'move');
    const insp = page.locator('.inspector');
    await insp.getByLabel('Start arrowhead').selectOption('circle');
    await insp.getByLabel('Dash style').selectOption('dash');
    await insp.getByLabel('Width profile').selectOption('taper-end');
    n = (await sel(page))[0];
    expect(n.stroke.startArrow).toBe('circle');
    expect(n.stroke.dash.length).toBe(2);
    expect(n.stroke.profile).toEqual([{ t: 0, w: 1 }, { t: 1, w: 0 }]);
    await expect(insp.getByLabel('Dash length')).toBeVisible();
    // custom width profile: double-click the graph to add a point, then shape it
    const graph = insp.getByTestId('profile-graph');
    await graph.scrollIntoViewIfNeeded();
    const gb = (await graph.boundingBox())!;
    await page.mouse.dblclick(gb.x + gb.width * 0.25, gb.y + gb.height / 2);
    await expect(insp.getByRole('slider', { name: /^Width point \d of 3$/ })).toHaveCount(3);
    const mid = insp.getByRole('slider', { name: 'Width point 2 of 3' });
    await expect(mid).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Shift+ArrowRight');
    n = (await sel(page))[0];
    expect(n.stroke.profile).toHaveLength(3);
    expect(n.stroke.profile[1].t).toBeCloseTo(0.3, 2);
    expect(n.stroke.profile[1].w).toBeCloseTo(0.89, 1);
    await expect(insp.getByLabel('Width profile')).toHaveValue('custom');
    // drag the point to the spine: zero width there
    const mb = (await mid.boundingBox())!;
    await drag(page, { x: mb.x + mb.width / 2, y: mb.y + mb.height / 2 }, { x: mb.x + mb.width / 2, y: gb.y + gb.height / 2 }, 5);
    expect((await sel(page))[0].stroke.profile[1].w).toBeLessThan(0.1);
    await insp.getByLabel('Width point width').fill('100');
    await insp.getByLabel('Width point width').press('Enter');
    expect((await sel(page))[0].stroke.profile[1].w).toBeCloseTo(1, 2);
    await panelShot(page, '.profile-editor', 'vector-profile-editor');
    await shot(page, 'vector-profile-editor-full');
    // Delete removes it; back to the preset's two points
    await mid.focus();
    await page.keyboard.press('Delete');
    await expect(insp.getByRole('slider', { name: /^Width point/ })).toHaveCount(2);
    await insp.getByLabel('Width profile').selectOption('taper-end');
    // the arrowheads are drawn: ink right at the arrow's tip
    const ink = await page.evaluate(() => {
      const c = document.querySelector('.viewport canvas.lower-canvas') as HTMLCanvasElement;
      const v = (window as any).__quvreloVpt as number[];
      const dpr = window.devicePixelRatio || 1;
      const x = Math.round((700 * v[0] + v[4] - 3) * dpr);
      const y = Math.round((600 * v[3] + v[5]) * dpr);
      const d = c.getContext('2d')!.getImageData(x - 2, y - 2, 5, 5).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 300) dark++;
      return dark;
    });
    expect(ink).toBeGreaterThan(0);
    await shot(page, 'vector-strokes');
  });

  test('live compound: operation, editable children, expand; booleans stay available', async () => {
    L = await launch();
    const { page } = L;
    await blankVector(page);
    await addShapes(page, `[${rect('a', 400, 400)}, ${ellipse('b', 500, 400)}]`);
    await page.evaluate(() => (window as any).__quvrelo.editor.select(['a', 'b']));
    await run(page, 'layer.compound-subtract');
    let ns = await nodes(page);
    expect(ns).toHaveLength(1);
    expect(ns[0].type).toBe('group');
    expect(ns[0].compound.op).toBe('subtract');
    expect(ns[0].children.map((c: any) => c.id)).toEqual(['a', 'b']);
    // the inspector edits the operation
    await expect(page.locator('#section-compound, [data-section="compound"], .section').filter({ hasText: 'Compound' }).first()).toBeVisible();
    await page.locator('.inspector').getByRole('radio', { name: 'Intersect' }).click();
    expect((await nodes(page))[0].compound.op).toBe('intersect');
    await shot(page, 'vector-compound');
    // a child stays editable: move the ellipse and the compound follows (still one object)
    await page.evaluate(() => {
      const { editor, runCommand } = (window as any).__quvrelo;
      void runCommand;
      editor.commit('Move child', (d: any) => ({ ...d, pages: d.pages.map((p: any) => ({ ...p, nodes: p.nodes.map((g: any) => ({ ...g, children: g.children.map((c: any) => (c.id === 'b' ? { ...c, x: c.x + 40 } : c)) })) })) }));
    });
    // canvas shows the intersection: the rect's far-left area is empty
    const empty = await page.evaluate(() => {
      const c = document.querySelector('.viewport canvas.lower-canvas') as HTMLCanvasElement;
      const v = (window as any).__quvreloVpt as number[];
      const dpr = window.devicePixelRatio || 1;
      const g = (window as any).__quvrelo.editor.doc.pages[0].nodes[0];
      const px = (x: number, y: number) => Array.from(c.getContext('2d')!.getImageData(Math.round((x * v[0] + v[4]) * dpr), Math.round((y * v[3] + v[5]) * dpr), 1, 1).data);
      return { left: px(g.x - 380 + 400 - 90, 400), inside: px(g.x - 400 + 430, 400) };
    });
    expect(empty.left.slice(0, 3)).toEqual([255, 255, 255]);
    expect(empty.inside.slice(0, 3)).not.toEqual([255, 255, 255]);
    await run(page, 'layer.expand-compound');
    ns = await nodes(page);
    expect(ns[0].type).toBe('path');
    await run(page, 'edit.undo');
    // live Divide: one object while live, separate pieces once expanded
    await page.locator('.inspector').getByRole('radio', { name: 'Divide' }).click();
    expect((await nodes(page))[0].compound.op).toBe('divide');
    await run(page, 'layer.expand-compound');
    ns = await nodes(page);
    expect(ns).toHaveLength(1);
    expect(ns[0].type).toBe('group');
    expect(ns[0].compound).toBeUndefined();
    expect(ns[0].children.length).toBeGreaterThanOrEqual(3);
    expect(ns[0].children.every((c: any) => c.type === 'path')).toBe(true);
    await run(page, 'edit.undo');
    await run(page, 'layer.release-compound');
    expect((await nodes(page)).map((n: any) => n.id)).toEqual(['a', 'b']);
  });

  test('gradient tool lays and edits linear, radial and conical gradients on canvas', async () => {
    L = await launch();
    const { page } = L;
    await blankVector(page);
    await addShapes(page, `[${rect('r', 540, 540, 600, 400)}]`);
    await page.evaluate(() => (window as any).__quvrelo.editor.select(['r']));
    await pickTool(page, 'gradient');
    await drag(page, await at(page, 300, 540), await at(page, 780, 540));
    let f = (await sel(page))[0].fill;
    expect(f.type).toBe('linear');
    expect(f.from.x).toBeCloseTo(0.1, 1);
    expect(f.to.x).toBeCloseTo(0.9, 1);
    expect(f.stops[0].color).toBe('#3d6fb6');
    // one undo step
    expect(await state<string>(page, 'editor.history.entries[editor.history.index].label')).toBe('Gradient');
    // drag the end handle
    await drag(page, await at(page, 780, 540), await at(page, 780, 700));
    f = (await sel(page))[0].fill;
    expect(f.to.y).toBeGreaterThan(0.8);
    // double-click the ramp: a third stop
    const mid = await page.evaluate(() => {
      const n = (window as any).__quvrelo.editor.selectedNodes()[0];
      const bx = n.x - n.w / 2, by = n.y - n.h / 2;
      return { x: bx + n.w * (n.fill.from.x + n.fill.to.x) / 2, y: by + n.h * (n.fill.from.y + n.fill.to.y) / 2 };
    });
    const m = await at(page, mid.x, mid.y);
    await page.mouse.dblclick(m.x, m.y);
    f = (await sel(page))[0].fill;
    expect(f.stops).toHaveLength(3);
    // context bar converts the type, keeping the stops
    await page.locator('.contextbar').getByRole('radio', { name: 'Radial' }).click();
    f = (await sel(page))[0].fill;
    expect(f.type).toBe('radial');
    expect(f.stops).toHaveLength(3);
    await page.locator('.contextbar').getByRole('radio', { name: 'Conical' }).click();
    expect((await sel(page))[0].fill.type).toBe('conical');
    // conical on the stroke: the gradient tool lays it on the outline, the stroke gets a width
    await page.locator('.contextbar').getByRole('radio', { name: 'Stroke' }).click();
    await drag(page, await at(page, 300, 400), await at(page, 780, 400));
    const st = (await sel(page))[0].stroke;
    expect(st.paint.type).toBe('conical');
    expect(st.width).toBeGreaterThan(0);
    expect((await sel(page))[0].fill.type).toBe('conical');
    await page.locator('.contextbar').getByRole('radio', { name: 'Fill' }).click();
    await page.waitForTimeout(100);
    await shot(page, 'vector-gradient-tool');
  });

  test('artboards hold what is drawn on them, move with it, and export as slices at @1x/@2x and SVG', async () => {
    L = await launch();
    const { page } = L;
    await blankVector(page);
    await pickTool(page, 'artboard');
    await drag(page, await at(page, 100, 100), await at(page, 500, 400));
    let ns = await nodes(page);
    expect(ns).toHaveLength(1);
    expect(ns[0].artboard).toMatchObject({ w: 400, h: 300, background: '#ffffff' });
    const boardId = ns[0].id;
    await page.evaluate((id) => (window as any).__quvrelo.editor.commit('Name', (d: any) => ({ ...d, pages: d.pages.map((p: any) => ({ ...p, nodes: p.nodes.map((n: any) => (n.id === id ? { ...n, name: 'Hero card' } : n)) })) })), boardId);

    // a rectangle drawn on the board belongs to it
    await pickTool(page, 'rect');
    await drag(page, await at(page, 150, 150), await at(page, 300, 250));
    ns = await nodes(page);
    expect(ns).toHaveLength(1);
    expect(ns[0].children).toHaveLength(1);
    const childId = ns[0].children[0].id;
    // clicking it with Move selects the child, not the board
    await pickTool(page, 'move');
    await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
    await click(page, 225, 200);
    expect((await sel(page)).map((n: any) => n.id)).toEqual([childId]);
    // drag the child off the board: back on the page
    await drag(page, await at(page, 225, 200), await at(page, 800, 800), 10);
    ns = await nodes(page);
    expect(ns.map((n: any) => n.id)).toContain(childId);
    // and onto the board again
    await drag(page, await at(page, 800, 800), await at(page, 300, 300), 10);
    ns = await nodes(page);
    expect(ns).toHaveLength(1);
    expect(ns[0].children[0].id).toBe(childId);

    // boards stay upright: rotation is not editable, Rotate 90° turns the content and the orientation
    await page.evaluate((id) => (window as any).__quvrelo.editor.select([id]), boardId);
    await page.locator('.inspector [data-panel="properties"]').click();
    await expect(page.locator('.inspector').getByLabel('Rotation (degrees)')).toBeDisabled();
    await run(page, 'arrange.rotate-cw');
    ns = await nodes(page);
    expect(ns[0].rotation).toBe(0);
    expect(ns[0].artboard).toMatchObject({ w: 300, h: 400 });
    expect(ns[0].children[0].rotation).toBe(90);
    await expect(page.locator('.inspector').getByRole('radio', { name: 'Portrait' })).toBeChecked();
    await page.locator('.inspector').getByRole('radio', { name: 'Landscape' }).click();
    expect((await nodes(page))[0].artboard).toMatchObject({ w: 400, h: 300 });
    await run(page, 'edit.undo');
    await run(page, 'edit.undo');
    ns = await nodes(page);
    expect(ns[0].artboard).toMatchObject({ w: 400, h: 300 });
    expect(ns[0].children[0].rotation).toBe(0);

    // Export tab: a slice for the board with PNG @1x, @2x and SVG
    await page.evaluate(() => (window as any).__quvrelo.editor.select([]));
    await page.locator('.inspector [data-panel="export"]').click();
    await page.locator('[data-testid="slices-panel"]').getByRole('button', { name: 'Add slice' }).click();
    const slices = await state<any[]>(page, 'editor.doc.slices');
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ name: 'Hero card', nodeId: boardId });
    await page.locator('[data-testid="slices-panel"]').getByRole('button', { name: 'Add output' }).click();
    const rows = page.locator('.slice-output');
    await expect(rows).toHaveCount(3);
    await rows.nth(2).getByLabel('Format').selectOption('svg');
    await expect(page.locator('[data-testid="slice-files"]')).toHaveText('Hero card.png · Hero card@2x.png · Hero card.svg');
    await shot(page, 'vector-export-slices');
    await page.locator('[data-testid="slices-panel"]').getByRole('button', { name: 'Export slices' }).click();
    const dir = path.join(L.saveDir, 'slices');
    await expect.poll(() => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [])).toEqual(['Hero card.png', 'Hero card.svg', 'Hero card@2x.png']);
    const dims = (f: string) => {
      const b = fs.readFileSync(path.join(dir, f));
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    expect(dims('Hero card.png')).toEqual([400, 300]);
    expect(dims('Hero card@2x.png')).toEqual([800, 600]);
    const svg = fs.readFileSync(path.join(dir, 'Hero card.svg'), 'utf8');
    expect(svg).toContain('viewBox="0 0 400 300"');
    expect(svg).toContain('data-artboard="true"');
  });

  test('symbols: editing one instance updates every instance; panel lists and inserts them', async () => {
    L = await launch();
    const { page } = L;
    await blankVector(page);
    await addShapes(page, `[${rect('s1', 200, 200, 100, 100, '#ff0000')}]`);
    await page.evaluate(() => (window as any).__quvrelo.editor.select(['s1']));
    await run(page, 'symbol.create');
    const inst = (await sel(page))[0];
    expect(inst.symbolId).toBeTruthy();
    await page.locator('.left-rail [data-panel="symbols"]').click();
    const panel = page.locator('[data-testid="symbols-panel"]');
    await expect(panel.locator('.symbol-item')).toHaveCount(1);
    await panel.getByRole('button', { name: 'Insert Symbol 1' }).click();
    await expect(panel.locator('.symbol-meta')).toHaveText('2 instances');
    // recolour the child inside the new instance
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      const g = editor.selectedNodes()[0];
      editor.select([g.children[0].id]);
      editor.commit('Fill', (d: any) => ({ ...d, pages: d.pages.map((p: any) => ({ ...p, nodes: p.nodes.map((n: any) => (n.id === g.id ? { ...n, children: n.children.map((c: any) => ({ ...c, fill: { type: 'solid', color: '#00aa00' } })) } : n)) })) }));
    });
    const fills = await state<string[]>(page, 'editor.doc.pages[0].nodes.map((g) => g.children[0].fill.color)');
    expect(fills).toEqual(['#00aa00', '#00aa00']);
    // inspector shows the symbol section with the count
    await page.evaluate(() => {
      const { editor } = (window as any).__quvrelo;
      editor.select([editor.doc.pages[0].nodes[0].id]);
    });
    await page.locator('.inspector [data-panel="properties"]').click();
    await expect(page.locator('[data-testid="symbol-count"]')).toHaveText('2 instances');
    await shot(page, 'vector-symbols');
    await run(page, 'symbol.detach');
    expect(await state<any>(page, 'editor.doc.pages[0].nodes[0].symbolId')).toBeUndefined();
  });

  test('text on a path, spacing with a gap, and align to the first selected', async () => {
    L = await launch();
    const { page } = L;
    await blankVector(page);
    await addShapes(page, `[{ id: 'p', name: 'Curve', type: 'path', x: 540, y: 540, d: [['M', -300, 0], ['C', -150, -200, 150, -200, 300, 0]], closed: false, fill: { type: 'none' }, stroke: { paint: { type: 'solid', color: '#000000' }, width: 2, dash: [], cap: 'round', join: 'round' }, ${BASE} }]`);
    await page.evaluate(() => (window as any).__quvrelo.editor.select(['p']));
    await run(page, 'text.on-path');
    const t = (await sel(page))[0];
    expect(t.type).toBe('text');
    expect(t.onPath.d.length).toBe(2);
    expect((await nodes(page)).some((n: any) => n.id === 'p')).toBe(false);
    await expect(page.locator('.inspector')).toContainText('Text on path');
    await page.locator('.inspector').getByLabel('Start along the path value').fill('25');
    await page.locator('.inspector').getByLabel('Start along the path value').press('Enter');
    await expect.poll(async () => (await sel(page))[0].onPath.start).toBeCloseTo(0.25);
    await shot(page, 'vector-text-on-path');

    // spacing: three rects, gap 30
    await addShapes(page, `[${rect('a', 100, 900, 100, 50)}, ${rect('b', 400, 900, 50, 50)}, ${rect('c', 900, 950, 80, 50)}]`);
    await page.evaluate(() => (window as any).__quvrelo.editor.select(['a', 'b', 'c']));
    await pickTool(page, 'move');
    const gap = page.locator('.contextbar').getByLabel('Spacing gap (px)');
    await gap.fill('30');
    await gap.press('Enter');
    await page.locator('.contextbar').getByRole('button', { name: 'Space horizontally' }).click();
    const xs = await state<number[]>(page, "['a','b','c'].map((id) => editor.doc.pages[0].nodes.find((n) => n.id === id).x)");
    expect(xs).toEqual([100, 205, 300]); // a 50..150, b 180..230, c 260..340
    // align tops to the first selected
    await page.locator('.inspector').getByLabel('Align to', { exact: true }).selectOption('first');
    await run(page, 'arrange.align-top');
    const ys = await state<number[]>(page, "['a','b','c'].map((id) => editor.doc.pages[0].nodes.find((n) => n.id === id).y)");
    expect(ys).toEqual([900, 900, 900]);
  });

  test('SVG import keeps groups, gradients and embedded images; SVG export writes them back', async () => {
    const png = fs.readFileSync(path.resolve('tests/fixtures/sample-photo.jpg')).toString('base64');
    const svgPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsvg-')), 'art.svg');
    fs.writeFileSync(svgPath, `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300" viewBox="0 0 400 300">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>
  <g id="badge" opacity="0.5"><rect x="10" y="10" width="100" height="50" fill="url(#g)"/><circle cx="200" cy="40" r="30" fill="#00ff00" stroke="#000" stroke-width="4" stroke-dasharray="6 3"/></g>
  <image x="250" y="150" width="120" height="80" xlink:href="data:image/jpeg;base64,${png}"/>
  <path d="M300 10 L390 10 L390 100 L300 100 Z M320 30 L370 30 L370 80 L320 80 Z" fill="#123456" fill-rule="evenodd"/>
  <path d="M300 10 L390 10 L390 100 L300 100 Z M320 30 L370 30 L370 80 L320 80 Z" fill="#654321" transform="translate(0 100)"/>
  <text x="20" y="250" font-family="Inter" font-size="24" fill="#333">Hello</text>
</svg>`);
    L = await launch({ QUVRELO_E2E_OPEN: svgPath });
    const { page } = L;
    await blankVector(page);
    await run(page, 'file.import-svg');
    await expect.poll(async () => (await nodes(page)).length).toBe(1);
    const g = (await nodes(page))[0];
    const flat: any[] = [];
    const walk = (n: any) => { flat.push(n); (n.children ?? []).forEach(walk); };
    walk(g);
    const badge = flat.find((n) => n.type === 'group' && n.name === 'badge');
    expect(badge.opacity).toBeCloseTo(0.5);
    const lin = flat.find((n) => n.fill?.type === 'linear');
    expect(lin.fill.from.x).toBeCloseTo(0, 1);
    expect(lin.fill.to.x).toBeCloseTo(1, 1);
    const circle = flat.find((n) => n.stroke?.dash?.length === 2);
    expect(circle.stroke.width).toBeCloseTo(4);
    const img = flat.find((n) => n.type === 'raster');
    expect(img).toBeTruthy();
    expect(await state<boolean>(page, `!!editor.assets.get(${JSON.stringify(img.assetId)})`)).toBe(true);
    expect(flat.some((n) => n.type === 'text' && n.text === 'Hello')).toBe(true);
    // fill-rule survives: evenodd as written, nonzero when the file says nothing (SVG's default)
    expect(flat.find((n) => n.fill?.color === '#123456').fillRule).toBe('evenodd');
    expect(flat.find((n) => n.fill?.color === '#654321').fillRule).toBe('nonzero');
    // export SVG: gradients, image data and text come back out
    await run(page, 'file.export-svg');
    await page.locator('[data-testid="export-go"]').click();
    await expect.poll(() => fs.readdirSync(L.saveDir).filter((f) => f.endsWith('.svg')).length).toBe(1);
    const out = fs.readFileSync(path.join(L.saveDir, fs.readdirSync(L.saveDir).find((f) => f.endsWith('.svg'))!), 'utf8');
    expect(out).toMatch(/<linearGradient[^>]*gradientUnits="userSpaceOnUse"/);
    expect(out).toContain('<image href="data:image/');
    expect(out).toContain('>Hello</tspan>');
    expect(out).toContain('stroke-dasharray="6 3"');
    expect(out).toMatch(/fill="#654321"[^>]*fill-rule="nonzero"/);
    expect(out).toMatch(/fill="#123456"[^>]*fill-rule="evenodd"/);

    // again with the photo linked as a file beside the SVG, JPEG because it is opaque
    await run(page, 'file.export-svg');
    const dlg = page.locator('.dialog, [role="dialog"]').filter({ has: page.locator('[data-testid="export-go"]') });
    await dlg.getByRole('radio', { name: 'Link' }).click();
    await dlg.getByRole('radio', { name: 'JPEG if opaque' }).click();
    await expect(dlg.getByTestId('export-svg-note')).toContainText('linked as JPEG where they have no transparency');
    await page.locator('[data-testid="export-go"]').click();
    await expect.poll(() => fs.readdirSync(L.saveDir).filter((f) => / image 1\.jpg$/.test(f)).length).toBe(1);
    const jpg = fs.readdirSync(L.saveDir).find((f) => / image 1\.jpg$/.test(f))!;
    expect(fs.readFileSync(path.join(L.saveDir, jpg)).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const svgFile = fs.readdirSync(L.saveDir).find((f) => f.endsWith('.svg'))!;
    expect(jpg).toBe(svgFile.replace(/\.svg$/, '') + ' image 1.jpg');
    const linked = fs.readFileSync(path.join(L.saveDir, svgFile), 'utf8');
    expect(linked).toContain(`<image href="${encodeURIComponent(jpg)}"`);
    expect(linked).not.toContain('data:image/');
  });
});
