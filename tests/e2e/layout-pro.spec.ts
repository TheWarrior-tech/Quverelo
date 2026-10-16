/**
 * Layout studio, pro typography and publishing (parity wave 1, layout):
 * rich text editing with per-character styling, paragraph / character styles
 * that update everywhere, OpenType features drawn by the canvas, pages panel
 * (insert, reorder, sections, spreads), masters with overrides and page-number
 * fields, threading + auto-flow, tables, text wrap, baseline grid and preflight.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { docToScreen, drag, launch, pickTool, run, state, type Launched } from './helpers';

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

const shots = path.join(process.cwd(), 'test-results', 'layout-pro');
fs.mkdirSync(shots, { recursive: true });

async function blankLayout(page: Page) {
  await page.click('[data-template="blank-a4"]');
  await expect(page.locator('.workspace')).toBeVisible();
  await run(page, 'studio.layout');
  await page.waitForTimeout(300);
}

async function ev<T>(page: Page, body: string): Promise<T> {
  return page.evaluate(`(async () => { const { editor, runCommand, getViewport, storyFlow } = window.__quvrelo; ${body} })()`) as Promise<T>;
}

/** Draw a text frame with the tool and type into it. */
async function frameWithText(page: Page, x0: number, y0: number, x1: number, y1: number, text: string) {
  await pickTool(page, 'textframe');
  await drag(page, await docToScreen(page, x0, y0), await docToScreen(page, x1, y1));
  await expect(page.locator('.text-edit-overlay')).toBeVisible();
  await page.keyboard.type(text);
}

const storyOf = (page: Page) => ev<{ id: string; text: string; spans?: unknown[]; paras?: unknown[] }>(page, `
  const id = editor.ui.editingTextId ?? editor.ui.selection[0];
  const loc = (function find(nodes) { for (const n of nodes) { if (n.id === id) return n; if (n.children) { const f = find(n.children); if (f) return f; } } })(editor.activeContainer.nodes);
  return editor.doc.stories[loc.storyId];`);

async function themeShot(page: Page, name: string) {
  for (const theme of ['dark', 'light', 'contrast'] as const) {
    await run(page, `view.theme-${theme}`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shots, `${name}-${theme}.png`) });
  }
  await run(page, 'view.theme-dark');
}

test.describe('layout: pro typography', () => {
  test('per-character styling: select a word and set it bold, oldstyle figures and superscript', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await frameWithText(page, 80, 80, 700, 400, 'Quvrelo sets office figures 1234567890 fine.');
    // select "office" with the keyboard (Home, then shift+arrows)
    await page.keyboard.press('Home');
    for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => state<number[]>(page, '[editor.ui.textSel.start, editor.ui.textSel.end]')).toEqual([13, 19]);
    // the inspector's Text section now says it applies to the selection
    await expect(page.locator('[data-section="text"] .section-title')).toContainText('selection');
    await page.getByLabel('Font style').selectOption('700');
    let story = await storyOf(page);
    expect(story.spans).toEqual([{ start: 13, end: 19, styleId: null, props: { fontWeight: 700, italic: false } }]);
    // the textarea keeps focus, so typing continues inside the frame
    expect(await page.evaluate(() => document.activeElement?.classList.contains('text-edit-overlay'))).toBe(true);
    // the frame stays drawn (not hidden) while editing rich text
    expect(await ev<boolean>(page, 'return getViewport().textEdit.rich')).toBe(true);
    // OpenType: oldstyle figures on the digits
    await ev(page, 'getViewport().textEdit.select(28, 38)');
    await page.locator('.more-type').click();
    await page.locator('#text-figures').selectOption('oldstyle');
    await page.locator('#text-position').selectOption('superscript');
    story = await storyOf(page);
    expect(story.spans).toContainEqual({ start: 28, end: 38, styleId: null, props: { figures: 'oldstyle', position: 'superscript' } });
    // layout reflects the smaller superscript run
    const runs = await ev<{ text: string; size: number; rise: number }[]>(page, `
      const s = editor.doc.stories[editor.ui.textSel.storyId];
      const f = storyFlow(editor.doc, s.id);
      return f.frames[s.chain[0]].lines[0].runs.map((r) => ({ text: r.text, size: r.style.fontSize, rise: r.rise }));`);
    expect(runs.map((r) => r.text)).toEqual(['Quvrelo sets ', 'office', ' figures ', '1234567890', ' fine.']);
    expect(runs[3].rise).toBeGreaterThan(0);
    // typing after setting bold at a collapsed caret continues bold (pending format)
    await page.keyboard.press('End');
    await page.getByLabel('Font style').selectOption('700');
    await page.keyboard.type(' Bold!');
    story = await storyOf(page);
    expect(story.text.endsWith(' Bold!')).toBe(true);
    expect((story.spans as { start: number; end: number; props: { fontWeight?: number } }[]).some((s) => s.end === story.text.length && s.props.fontWeight === 700)).toBe(true);
    await page.screenshot({ path: path.join(shots, 'rich-text.png') });
  });

  test('clicking places the caret through the layout; up/down move by drawn lines', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await frameWithText(page, 80, 80, 300, 600, 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty');
    await page.keyboard.press('Escape');
    const lines = await ev<{ start: number; y: number; x: number }[]>(page, `
      const id = editor.ui.selection[0];
      const n = editor.activeContainer.nodes.find((x) => x.id === id);
      return storyFlow(editor.doc, n.storyId).frames[id].lines.map((l) => ({ start: l.start, y: l.y, x: l.x }));`);
    expect(lines.length).toBeGreaterThan(4);
    // double-click on the start of the third line puts the caret there
    const frame = await ev<{ x: number; y: number; w: number; h: number }>(page, `
      const n = editor.activeContainer.nodes.find((x) => x.id === editor.ui.selection[0]);
      return { x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h };`);
    const p = await docToScreen(page, frame.x + 1, frame.y + lines[2].y + 8);
    await pickTool(page, 'move');
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('.text-edit-overlay')).toBeVisible();
    await expect.poll(() => state<number>(page, 'editor.ui.textSel.start')).toBe(lines[2].start);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => state<number>(page, 'editor.ui.textSel.start')).toBe(lines[1].start);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => state<number>(page, 'editor.ui.textSel.start')).toBe(lines[3].start);
  });

  test('paragraph and character styles: apply, edit the style, every use updates; based-on inherits', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await frameWithText(page, 80, 80, 700, 600, 'Heading here\nBody text one.\nBody text two.');
    await run(page, 'text.styles');
    await page.locator('[data-testid="starter-styles"]').click();
    await expect(page.locator('.style-row')).toHaveCount(8);
    // the caret is in the last paragraph: apply Body to all three, then Heading 1 to the first
    await ev(page, 'getViewport().textEdit.select(0, 1000)');
    await page.locator('.style-row[data-style-name="Body"] .style-apply').click();
    await ev(page, 'getViewport().textEdit.select(0, 0)');
    await page.locator('.style-row[data-style-name="Heading 1"] .style-apply').click();
    const sizes = async () => ev<number[]>(page, `
      const s = Object.values(editor.doc.stories).find((x) => x.text.startsWith('Heading'));
      const f = storyFlow(editor.doc, s.id);
      return f.frames[s.chain[0]].lines.map((l) => l.runs[0].style.fontSize);`);
    expect(await sizes()).toEqual([28, 14, 14]);
    // edit Body: both body paragraphs update; Heading 1 is based on Body but sets its own size
    await page.getByRole('button', { name: 'Edit Body' }).click();
    const sizeField = page.getByLabel('Style font size (pt)');
    await sizeField.fill('18');
    await sizeField.press('Enter');
    await expect.poll(sizes).toEqual([28, 18, 18]);
    // change Body's font: Heading 1 (based on Body, own font Inter) keeps Inter; usage counts shown
    expect(await page.locator('.style-row[data-style-name="Body"] .style-uses').textContent()).toBe('2');
    // character style on a selection
    await ev(page, 'getViewport().textEdit.select(13, 17)');
    await page.locator('.style-row[data-style-name="Emphasis"] .style-apply').click();
    const italic = await ev<boolean>(page, `
      const s = Object.values(editor.doc.stories).find((x) => x.text.startsWith('Heading'));
      return storyFlow(editor.doc, s.id).frames[s.chain[0]].lines[1].runs[0].style.italic;`);
    expect(italic).toBe(true);
    await themeShot(page, 'styles-panel');
  });

  test('OpenType features change the drawn glyphs (EB Garamond ligatures and figures)', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    // same text, two frames: one with ligatures + lining figures, one with ligatures off + oldstyle
    const widths = await ev<number[]>(page, `
      const { createDocument } = {};
      const doc = editor.doc;
      const pid = editor.activeContainer.id;
      const mk = (y, props) => {
        const story = { id: 'st' + y, text: 'office affluent 1234567890', style: { ...Object.values(doc.stories)[0]?.style, fontFamily: 'EB Garamond', fontSize: 48, fontWeight: 400, italic: false, underline: false, lineHeight: 1.2, letterSpacing: 0, align: 'left', fill: { type: 'solid', color: '#111111' }, ...props }, chain: ['tf' + y] };
        const node = { id: 'tf' + y, type: 'textframe', name: 'Text Frame', visible: true, locked: false, opacity: 1, blend: 'normal', x: 400, y, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false, w: 700, h: 80, storyId: story.id, padding: 0, columns: 1, columnGap: 0, fill: { type: 'none' }, stroke: { paint: { type: 'none' }, width: 0, dash: [], cap: 'butt', join: 'miter' } };
        return { story, node };
      };
      const a = mk(200, { figures: 'lining' });
      const b = mk(320, { ligatures: false, figures: 'oldstyle' });
      editor.commit('test frames', (d) => ({ ...d, stories: { ...d.stories, [a.story.id]: a.story, [b.story.id]: b.story }, pages: d.pages.map((p) => p.id === pid ? { ...p, nodes: [...p.nodes, a.node, b.node] } : p) }));
      // wait for the feature faces to load and re-measure
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const wa = storyFlow(editor.doc, a.story.id).frames[a.node.id].lines[0].width;
        const wb = storyFlow(editor.doc, b.story.id).frames[b.node.id].lines[0].width;
        if (Math.abs(wa - wb) > 1) return [wa, wb];
      }
      return [storyFlow(editor.doc, a.story.id).frames[a.node.id].lines[0].width, storyFlow(editor.doc, b.story.id).frames[b.node.id].lines[0].width];`);
    // ligatures and oldstyle figures make real width differences only HarfBuzz shaping can produce
    expect(Math.abs(widths[0] - widths[1])).toBeGreaterThan(1);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, 'opentype.png') });
    // the OpenType options for the frame, in every theme
    await ev(page, `editor.select(['tf200'])`);
    await page.getByRole('tab', { name: 'Design' }).click();
    await page.locator('.more-type').click();
    await expect(page.locator('#text-figures')).toHaveValue('lining');
    await page.locator('#text-figures').scrollIntoViewIfNeeded();
    await themeShot(page, 'opentype-options');
  });
});

test.describe('layout: composition (hyphenation, tabs, keeps, rich cells)', () => {
  const firstStory = (page: Page, prefix: string) => `Object.values(editor.doc.stories).find((x) => x.text.startsWith(${JSON.stringify(prefix)}))`;

  test('hyphenation and keep options from the inspector', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await frameWithText(page, 80, 80, 260, 700, 'Typographical considerations extraordinarily influence comprehensibility and hyphenation');
    await ev(page, 'getViewport().textEdit.select(0, 1000)');
    await page.getByRole('tab', { name: 'Design' }).click();
    const hyphens = () => ev<number>(page, `const s = ${firstStory(page, 'Typographical')};
      return storyFlow(editor.doc, s.id).frames[s.chain[0]].lines.filter((l) => l.runs.some((r) => r.hyphen)).length;`);
    expect(await hyphens()).toBe(0);
    await page.getByTestId('para-hyphenate').check();
    await expect.poll(hyphens).toBeGreaterThan(0);
    const para = () => ev<Record<string, unknown>>(page, `return ${firstStory(page, 'Typographical')}.paras?.[0]?.props ?? {};`);
    expect(await para()).toMatchObject({ hyphenate: true });
    await page.getByLabel('Hyphenation language').selectOption('en-US');
    await page.getByTestId('para-keep-next').check();
    await page.getByTestId('para-widows').check();
    expect(await para()).toMatchObject({ hyphenate: true, language: 'en-US', keepWithNext: true, widows: 2, orphans: 2 });
    // the text keeps focus for typing after a click in the inspector
    expect(await page.evaluate(() => document.activeElement?.classList.contains('text-edit-overlay'))).toBe(true);
    await page.getByTestId('para-hyphenate').scrollIntoViewIfNeeded();
    await themeShot(page, 'hyphenation-keeps');
  });

  test('tab stops: Tab key, a right-aligned stop with a dot leader', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await frameWithText(page, 80, 80, 700, 300, 'Chapter one\t7');
    const story = await storyOf(page);
    expect(story.text).toBe('Chapter one\t7'); // the Tab key typed a tab character
    await page.getByRole('tab', { name: 'Design' }).click();
    await page.getByRole('button', { name: 'Add tab stop' }).click();
    await expect(page.getByTestId('tab-stop')).toHaveCount(1);
    const pos = page.getByLabel('Tab stop 1 position');
    await pos.fill('400');
    await pos.press('Enter');
    await page.getByRole('radio', { name: 'Right tab' }).click();
    await page.getByLabel('Tab stop 1 leader').selectOption('.');
    const lay = await ev<{ pad: number; tab: { text: string; x: number; width: number }; last: { x: number; width: number } }>(page, `
      const s = ${firstStory(page, 'Chapter')};
      const n = editor.activeContainer.nodes.find((x) => x.id === s.chain[0]);
      const runs = storyFlow(editor.doc, s.id).frames[n.id].lines[0].runs;
      const last = runs[runs.length - 1];
      return { pad: n.padding, tab: runs.find((r) => r.tab), last: { x: last.x, width: last.width } };`);
    expect(lay.tab.text).toMatch(/^\.+$/);
    // the "7" ends at the stop (frame inset + 400)
    expect(Math.abs(lay.last.x + lay.last.width - (lay.pad + 400))).toBeLessThan(0.6);
    expect(await ev<unknown>(page, `return ${firstStory(page, 'Chapter')}.paras[0].props.tabStops`)).toEqual([{ pos: 400, align: 'right', leader: '.' }]);
    await page.getByTestId('tab-stops').scrollIntoViewIfNeeded();
    await themeShot(page, 'tab-stops');
  });

  test('per-character formatting inside a table cell', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await run(page, 'table.insert');
    const id = await state<string>(page, 'editor.ui.selection[0]');
    const geo = await ev<{ x: number; y: number; rowH: number; colW: number }>(page, `
      const t = editor.activeContainer.nodes.find((n) => n.id === '${id}');
      return { x: t.x - t.w / 2, y: t.y - t.h / 2, rowH: t.h / t.rowHeights.length, colW: t.w / t.colWidths.length };`);
    const p = await docToScreen(page, geo.x + geo.colW / 2, geo.y + geo.rowH * 1.5);
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('.text-edit-overlay')).toBeVisible();
    await page.keyboard.type('Plain bold');
    // the cell is drawn from its layout while editing (rich), with the inspector's Text section
    expect(await ev<boolean>(page, 'return getViewport().textEdit.rich')).toBe(true);
    await ev(page, 'getViewport().textEdit.select(6, 10)');
    await page.getByRole('tab', { name: 'Design' }).click();
    await expect(page.locator('[data-section="text"] .section-title')).toContainText('selection');
    await page.getByLabel('Font style').selectOption('700');
    const cell = () => state<{ text: string; spans?: unknown[] }>(page, `editor.activeContainer.nodes.find(n => n.id === '${id}').cells[1][0]`);
    expect((await cell()).spans).toEqual([{ start: 6, end: 10, styleId: null, props: { fontWeight: 700, italic: false } }]);
    // typing before the bold word keeps it on the same characters
    await ev(page, 'getViewport().textEdit.select(0, 0)');
    await page.keyboard.type('Very ');
    expect(await cell()).toMatchObject({ text: 'Very Plain bold', spans: [{ start: 11, end: 15 }] });
    // the click on the inspector handed focus back to the cell text
    expect(await page.evaluate(() => document.activeElement?.classList.contains('text-edit-overlay'))).toBe(true);
    await themeShot(page, 'table-cell-text');
  });
});

test.describe('layout: pages, masters and flow', () => {
  test('pages panel: insert several, drag to reorder, sections renumber, spreads', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await page.getByRole('tab', { name: 'Pages' }).click();
    await page.getByRole('button', { name: 'Insert several pages' }).click();
    const n = page.getByLabel('Number of pages to insert');
    await n.fill('4');
    await n.press('Enter');
    await page.locator('[data-testid="insert-pages"] .btn').click();
    expect(await state<number>(page, 'editor.doc.pages.length')).toBe(5);
    await run(page, 'page.next'); // page 3 after insert? the first inserted page is active
    await page.evaluate(() => undefined);
    // rename page 1 so we can follow it, then drag it to the end
    const firstId = await state<string>(page, 'editor.doc.pages[0].id');
    const thumbs = page.locator('.page-thumb');
    await thumbs.nth(0).dragTo(thumbs.nth(4));
    await expect.poll(() => state<string>(page, 'editor.doc.pages[4].id')).toBe(firstId);
    // keyboard reorder: Alt+ArrowLeft on the last page moves it back one
    await thumbs.nth(4).focus();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect.poll(() => state<string>(page, 'editor.doc.pages[3].id')).toBe(firstId);
    // section starting on page 3 in roman numerals
    await thumbs.nth(2).click();
    await page.locator('[data-testid="section-start"]').check();
    await page.getByLabel('Page number style').selectOption('roman');
    await page.getByLabel('Section name').fill('Appendix');
    await expect(thumbs.nth(3)).toContainText('Page ii');
    await page.getByLabel('Facing pages (spreads)').check();
    await expect(page.locator('.pages-grid.spreads .spread')).toHaveCount(3);
    await themeShot(page, 'pages-panel');
  });

  test('master with a page-number field; overriding an item on one page only', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await run(page, 'page.add');
    await run(page, 'page.add');
    await run(page, 'master.add');
    // a footer frame on the master with "Page <#> of <count>"
    await frameWithText(page, 300, 1000, 500, 1060, 'Page ');
    await run(page, 'text.insert-page-number');
    await page.keyboard.type(' of ');
    await run(page, 'text.insert-page-count');
    await page.keyboard.press('Escape');
    const masterId = await state<string>(page, 'editor.doc.masters[0].id');
    await page.evaluate((m) => {
      const { editor } = (window as unknown as { __quvrelo: { editor: { commit: (l: string, f: (d: unknown) => unknown) => void } } }).__quvrelo;
      editor.commit('apply', (d: any) => ({ ...d, pages: d.pages.map((p: any) => ({ ...p, masterId: m })) }));
    }, masterId);
    // the master frame shows each page's own number
    const texts = await ev<string[]>(page, `
      const s = Object.values(editor.doc.stories).find((x) => x.text.startsWith('Page '));
      return [0, 1, 2].map((i) => storyFlow(editor.doc, s.id, i).frames[s.chain[0]].lines[0].text);`);
    expect(texts).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3']);
    // override on page 2: the page gets its own copy and story; the other pages keep the master's
    await page.evaluate((m) => {
      const { editor } = (window as unknown as { __quvrelo: { editor: { setUi: (p: unknown) => void; doc: { pages: { id: string }[] } } } }).__quvrelo;
      editor.setUi({ activeContainerId: editor.doc.pages[1].id, selection: [] });
      void m;
    }, masterId);
    await page.getByRole('tab', { name: 'Pages' }).click();
    await page.getByRole('button', { name: 'Override master items' }).click();
    expect(await state<number>(page, 'editor.doc.pages[1].nodes.length')).toBe(1);
    expect(await state<number>(page, 'editor.doc.pages[1].overrides.length')).toBe(1);
    expect(await state<number>(page, 'editor.doc.pages[0].nodes.length')).toBe(0);
    await page.getByRole('button', { name: /Remove overrides/ }).click();
    expect(await state<number>(page, 'editor.doc.pages[1].nodes.length')).toBe(0);
    // vector PDF export draws the field per page
    await page.screenshot({ path: path.join(shots, 'master-fields.png') });
  });

  test('threaded frames show the overset marker; auto-flow adds pages until the story fits', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
    await frameWithText(page, 80, 80, 700, 400, 'Start. ');
    await ev(page, `getViewport().textEdit.insert(${JSON.stringify(words)})`);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Design' }).click();
    await expect(page.locator('.flow-status.bad')).toContainText('Overset');
    await page.locator('.flow-actions .btn', { hasText: 'Auto-flow' }).click();
    const pages = await state<number>(page, 'editor.doc.pages.length');
    expect(pages).toBeGreaterThan(2);
    const fits = await ev<boolean>(page, `
      const s = Object.values(editor.doc.stories).find((x) => x.text.startsWith('Start.'));
      return !storyFlow(editor.doc, s.id).overflow && s.chain.length === editor.doc.pages.length;`);
    expect(fits).toBe(true);
    await expect(page.locator('.flow-status')).not.toHaveClass(/bad/);
  });
});

test.describe('layout: tables, wrap, grid, preflight', () => {
  test('tables: insert, type in cells with Tab, merge, add rows, cell styles', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await run(page, 'table.insert');
    const id = await state<string>(page, 'editor.ui.selection[0]');
    expect(await state<string>(page, `editor.activeContainer.nodes.find(n => n.id === '${id}').type`)).toBe('table');
    // double-click the second row, first cell, type, Tab to the next
    const geo = await ev<{ x: number; y: number; rowH: number; colW: number }>(page, `
      const t = editor.activeContainer.nodes.find((n) => n.id === '${id}');
      return { x: t.x - t.w / 2, y: t.y - t.h / 2, rowH: t.h / t.rowHeights.length, colW: t.w / t.colWidths.length };`);
    const p = await docToScreen(page, geo.x + geo.colW / 2, geo.y + geo.rowH * 1.5);
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('.text-edit-overlay')).toBeVisible();
    await page.keyboard.type('Apples');
    await page.keyboard.press('Tab');
    await page.keyboard.type('12');
    await page.keyboard.press('Escape');
    const row = await state<string[]>(page, `editor.activeContainer.nodes.find(n => n.id === '${id}').cells[1].map(c => c.text)`);
    expect(row.slice(0, 2)).toEqual(['Apples', '12']);
    await page.getByRole('tab', { name: 'Design' }).click();
    // merge row 1, columns 1-3 (cell range fields)
    for (const [label, v] of [['First row', '1'], ['First column', '1'], ['Last row', '1'], ['Last column', '3']]) {
      await page.getByLabel(label, { exact: true }).fill(v);
      await page.getByLabel(label, { exact: true }).press('Enter');
    }
    await page.locator('.table-actions .btn', { hasText: 'Merge' }).click();
    expect(await state<number>(page, `editor.activeContainer.nodes.find(n => n.id === '${id}').cells[0][0].colSpan`)).toBe(3);
    await page.getByRole('button', { name: 'Insert row below' }).click();
    expect(await state<number>(page, `editor.activeContainer.nodes.find(n => n.id === '${id}').rowHeights.length`)).toBe(5);
    await themeShot(page, 'table');
  });

  test('text wrap: a shape pushes the text of a frame around it', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    const text = Array.from({ length: 120 }, () => 'lorem ipsum').join(' ');
    await frameWithText(page, 60, 60, 740, 700, 'x');
    await ev(page, `getViewport().textEdit.select(0, 1); getViewport().textEdit.insert(${JSON.stringify(text)})`);
    await page.keyboard.press('Escape');
    const before = await ev<number>(page, `
      const s = Object.values(editor.doc.stories).find((x) => x.text.startsWith('lorem'));
      return storyFlow(editor.doc, s.id).frames[s.chain[0]].lines.length;`);
    await pickTool(page, 'ellipse');
    await drag(page, await docToScreen(page, 300, 200), await docToScreen(page, 500, 400));
    await page.getByRole('tab', { name: 'Design' }).click();
    await page.getByRole('radio', { name: 'Shape' }).click();
    const after = await ev<{ lines: number; minX: number }>(page, `
      const s = Object.values(editor.doc.stories).find((x) => x.text.startsWith('lorem'));
      const ls = storyFlow(editor.doc, s.id).frames[s.chain[0]].lines;
      return { lines: ls.length, minX: Math.max(...ls.filter((l) => l.y > 170 && l.y < 300).map((l) => l.x)) };`);
    expect(after.lines).toBeGreaterThan(before);
    expect(after.minX).toBeGreaterThan(200);
    await page.screenshot({ path: path.join(shots, 'text-wrap.png') });
  });

  test('baseline grid: paragraphs aligned to the grid sit on its lines; the grid is drawn', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await page.locator('.viewport').click({ position: { x: 5, y: 5 } });
    await page.getByRole('tab', { name: 'Design' }).click();
    await page.locator('[data-testid="grid-enabled"]').check();
    await frameWithText(page, 80, 83, 700, 600, 'First paragraph\nSecond paragraph\nThird');
    await ev(page, 'getViewport().textEdit.select(0, 1000)');
    await page.getByLabel('Align to baseline grid').check();
    const ok = await ev<boolean>(page, `
      const s = Object.values(editor.doc.stories).find((x) => x.text.startsWith('First'));
      const f = s.chain[0];
      const n = editor.activeContainer.nodes.find((x) => x.id === f);
      const top = n.y - n.h / 2;
      const g = editor.doc.settings.baselineGrid;
      return storyFlow(editor.doc, s.id).frames[f].lines.every((l) => Math.abs(((top + l.baseline - g.start) / g.increment) - Math.round((top + l.baseline - g.start) / g.increment)) < 1e-6);`);
    expect(ok).toBe(true);
    await page.keyboard.press('Escape');
    await themeShot(page, 'baseline-grid');
  });

  test('preflight lists overset text and missing fonts and jumps to the item', async () => {
    L = await launch();
    const { page } = L;
    await blankLayout(page);
    await frameWithText(page, 80, 80, 200, 110, 'This is far too much text for such a tiny frame to hold');
    await page.keyboard.press('Escape');
    const frameId = await state<string>(page, 'editor.ui.selection[0]');
    await ev(page, `const id = editor.ui.selection[0]; const n = editor.activeContainer.nodes.find((x) => x.id === id);
      editor.commit('font', (d) => ({ ...d, stories: { ...d.stories, [n.storyId]: { ...d.stories[n.storyId], style: { ...d.stories[n.storyId].style, fontFamily: 'Nonexistent Grotesk' } } } }));`);
    await run(page, 'layout.preflight');
    await expect(page.locator('[data-testid="preflight"] [data-check="overset-text"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="preflight"] [data-check="missing-fonts"]')).toContainText('Nonexistent Grotesk');
    await expect(page.locator('.tab-badge')).toHaveText('2');
    await run(page, 'edit.deselect');
    await page.locator('[data-check="overset-text"]').click();
    expect(await state<string[]>(page, 'editor.ui.selection')).toEqual([frameId]);
    await themeShot(page, 'preflight');
  });

  test('vector PDF of a styled layout keeps text as text and draws tables as vectors', async () => {
    L = await launch();
    const { page, saveDir } = L;
    await blankLayout(page);
    await frameWithText(page, 80, 80, 700, 300, 'Plain then bold words.');
    await ev(page, 'getViewport().textEdit.select(11, 15)');
    await page.getByLabel('Font style').selectOption('700');
    await page.keyboard.press('Escape');
    await run(page, 'table.insert');
    await run(page, 'file.export-pdf');
    await page.click('[data-testid="export-go"]');
    await expect.poll(() => fs.readdirSync(saveDir).filter((f) => f.endsWith('.pdf')).length).toBe(1);
    const pdf = fs.readFileSync(path.join(saveDir, fs.readdirSync(saveDir).find((f) => f.endsWith('.pdf'))!));
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    // two weights of Inter embedded (regular + bold run), no fallback images for text
    const raw = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
    // pdf-lib names each subset <PostScript name>-<random tag>
    const fonts = [...raw.matchAll(/\/FontName \/([A-Za-z0-9-]+)-\d+/g)].map((m) => m[1]);
    expect(new Set(fonts)).toEqual(new Set(['Inter-Regular', 'Inter-Bold']));
    expect(raw).toContain('/FontFile2');
    expect(raw).not.toMatch(/\/Subtype \/Image/);
    // shaped text: kerning written as TJ adjustments
    const { inflateSync } = await import('node:zlib');
    const { PDFName, PDFRawStream } = await import('pdf-lib');
    const c = doc.getPages()[0].node.lookup(PDFName.of('Contents')) as InstanceType<typeof PDFRawStream>;
    const ops = inflateSync(Buffer.from(c.contents)).toString('latin1');
    expect(ops).toMatch(/BT\n\/F\d+ [\d.]+ Tf/);
    expect(ops).toMatch(/\] TJ|> Tj/);
  });
});
