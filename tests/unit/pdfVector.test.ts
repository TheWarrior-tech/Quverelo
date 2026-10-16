import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFDict } from 'pdf-lib';
import { createDocument, make, solid } from '../../src/core/document';
import { addNodes, addTextFrame } from '../../src/core/commands';
import { capsSegments, exportVectorPdf, gradientCoords, parseCssColor, pathOps, pdfShapingFeatures, shapedText, type VectorPdfHooks } from '../../src/core/pdfVector';
import fontkit from '@pdf-lib/fontkit';
import { BUNDLED_FACES, bundledFaceFor, matchWeight } from '../../src/core/pdfFonts';
import { formatPageRange, parsePageRange } from '../../src/core/pageRange';
import { flowStory, lineHeightPx, monoMeasure } from '../../src/core/textflow';
import type { QuvreloDocument, SceneNode } from '../../src/core/types';

// 1×1 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

function hooks(doc: QuvreloDocument, rasterised: SceneNode[] = []): VectorPdfHooks {
  const measure = monoMeasure();
  return {
    measure,
    textSize: (text, style) => ({ w: Math.max(...text.split('\n').map((l) => measure(l, style))), h: text.split('\n').length * lineHeightPx(style) }),
    flow: (id) => {
      const st = doc.stories[id];
      const frames = st.chain.map((fid) => doc.pages.flatMap((p) => p.nodes).find((n) => n.id === fid)).filter(Boolean) as Extract<SceneNode, { type: 'textframe' }>[];
      return flowStory(st.text, st.style, frames, measure);
    },
    font: async (style) => {
      const f = bundledFaceFor(style);
      if (!f) return 'font not bundled';
      const local = `src/renderer/assets/fonts/${f.pkg}/${f.file.replace('files/', '')}`;
      const file = existsSync(local) ? local : `node_modules/@fontsource/${f.pkg}/${f.file}`;
      return { key: f.file, bytes: readFileSync(file), synthItalic: f.synthItalic };
    },
    rasterPixels: async () => ({ bytes: PNG, mime: 'image/png' }),
    assetImage: async () => ({ bytes: PNG, mime: 'image/png' }),
    rasterise: async (n) => {
      rasterised.push(n);
      return { bytes: PNG, mime: 'image/png', box: { x: -5, y: -5, w: 10, h: 10 } };
    },
  };
}

async function contents(bytes: Uint8Array): Promise<{ pdf: PDFDocument; ops: string[] }> {
  const pdf = await PDFDocument.load(bytes);
  const ops = pdf.getPages().map((p) => {
    const c = p.node.lookup(PDFName.of('Contents'));
    const raw = c as PDFRawStream;
    return inflateSync(Buffer.from(raw.contents)).toString('latin1');
  });
  return { pdf, ops };
}

function xobjects(pdf: PDFDocument, i = 0): number {
  const res = pdf.getPages()[i].node.Resources()!;
  const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
  return xo ? xo.entries().length : 0;
}

describe('vector PDF', () => {
  it('writes shapes, gradients, masks and text as vectors with an embedded font', async () => {
    let d = createDocument({ settings: { width: 400, height: 300, background: '#ffffff', dpi: 96 } });
    d = addNodes(d, d.pages[0].id, [
      make.rect({ x: 50, y: 50, w: 80, h: 40, fill: solid('#ff0000'), stroke: { paint: solid('#000000'), width: 2, dash: [4, 2], cap: 'round', join: 'bevel' } }),
      make.ellipse({ x: 150, y: 50, opacity: 0.5, blend: 'multiply', fill: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 0.5, color: '#f00' }, { offset: 1, color: '#fff' }] }, mask: { d: [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['Z']], inverted: true, enabled: true } }),
      make.text({ text: 'Hello PDF', x: 200, y: 200, style: { ...make.text().style, fontFamily: 'Inter, sans-serif', fill: solid('#112233') } }),
    ]);
    d = addTextFrame(d, d.pages[0].id, { x: 20, y: 220, w: 300, h: 60 }, 'Frame text flows here').doc;
    const out: SceneNode[] = [];
    const { bytes, report } = await exportVectorPdf(d, { pages: [0], includeBleed: false, cropMarks: false, fallbackDpi: 300 }, hooks(d, out));
    expect(out).toHaveLength(0);
    expect(report.rasterised).toEqual([]);
    expect(report.vectorObjects).toBe(2);
    expect(report.textObjects).toBe(2);
    expect(report.images).toBe(0);
    const { pdf, ops } = await contents(bytes);
    const s = ops[0];
    expect(s).toMatch(/ re\n/); // rectangle path / background
    expect(s).toMatch(/ c\n/); // ellipse curves
    expect(s).toContain('W* n'); // inverted mask clip
    expect(s).toMatch(/\/Sh\d+ sh/); // gradient shading
    expect(s).toMatch(/\[4 2\] 0 d/); // dash
    expect(s).toContain('1 J 2 j');
    expect(s).toMatch(/BT\n\/F\d+ \d+ Tf/); // real text
    expect(s).toMatch(/> Tj|\] TJ/);
    expect(xobjects(pdf)).toBe(0); // nothing placed as an image
    const raw = Buffer.from(await pdf.save({ useObjectStreams: false })).toString('latin1');
    expect(raw).toContain('/FontFile2'); // embedded TrueType outlines
    expect(raw).toContain('/BM /Multiply');
    expect(raw).toContain('/ShadingType 2');
    expect(raw).toContain('/FunctionType 3'); // three stops → stitching function
    // page is the document size in points
    const [w, h] = [pdf.getPages()[0].getWidth(), pdf.getPages()[0].getHeight()];
    expect(w).toBeCloseTo(300);
    expect(h).toBeCloseTo(225);
  });

  it('places what PDF cannot draw as an image and says why', async () => {
    let d = createDocument({ settings: { width: 200, height: 200 } });
    d = addNodes(d, d.pages[0].id, [
      make.text({ text: 'System font', style: { ...make.text().style, fontFamily: 'Comic Sans MS' } }),
      make.rect({ fill: { type: 'linear', angle: 0, stops: [{ offset: 0, color: 'rgba(0,0,0,0.5)' }, { offset: 1, color: '#fff' }] } }),
      make.text({ text: 'Ω ok', style: { ...make.text().style, fontFamily: 'Inter' } }),
    ]);
    const out: SceneNode[] = [];
    const { bytes, report } = await exportVectorPdf(d, { pages: [0], includeBleed: false, cropMarks: false, fallbackDpi: 150 }, hooks(d, out));
    expect(out.map((n) => n.type)).toEqual(['text', 'rect', 'text']);
    expect(report.rasterised.map((r) => r.reason)).toEqual(['font not bundled', 'gradient with transparency', 'characters Ω are not in the font']);
    const { pdf } = await contents(bytes);
    expect(xobjects(pdf)).toBeGreaterThan(0);
  });

  it('embeds pixel layers once, writes page ranges, bleed boxes and crop marks', async () => {
    let d = createDocument({ settings: { width: 200, height: 100, bleed: 10, dpi: 96 } });
    d = { ...d, pages: [...d.pages, { ...d.pages[0], id: 'p2', name: 'Page 2' }, { ...d.pages[0], id: 'p3', name: 'Page 3' }] };
    const raster = { ...make.rect(), type: 'raster', assetId: 'a1', adjustments: [], w: 50, h: 50 } as unknown as SceneNode;
    d = addNodes(d, d.pages[0].id, [raster, { ...raster, id: 'r2', x: 120 } as SceneNode]);
    const { bytes, report } = await exportVectorPdf(d, { pages: [0, 2], includeBleed: true, cropMarks: true, fallbackDpi: 150 }, hooks(d));
    expect(report.pages).toBe(2);
    expect(report.images).toBe(1); // same pixels embedded once
    const { pdf, ops } = await contents(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const p = pdf.getPages()[0];
    const trim = p.node.lookup(PDFName.of('TrimBox'), PDFArray).asArray().map((n) => Number(n.toString()));
    // 24px slug + 10px bleed = 34px = 25.5pt
    expect(trim[0]).toBeCloseTo(25.5);
    expect(trim[2] - trim[0]).toBeCloseTo(150);
    expect(ops[0]).toMatch(/ m .* l S/);
    expect(ops[0]).toMatch(/\/Im\d+ Do/);
  });
});

describe('PDF page size', () => {
  it('sizes a px document by its Output DPI and a print document at 96 px/in (CRITIQUE-4 P2-17)', async () => {
    const photo = createDocument({ settings: { width: 1264, height: 848, unit: 'px', dpi: 300 } });
    let r = await exportVectorPdf(photo, { pages: [0], includeBleed: false, cropMarks: false, fallbackDpi: 300 }, hooks(photo));
    let pg = (await contents(r.bytes)).pdf.getPages()[0];
    // 1264 px at 300 dpi = 4.2133 in = 303.36 pt = 107 mm
    expect(pg.getWidth()).toBeCloseTo(303.36, 1);
    expect(pg.getHeight()).toBeCloseTo(203.52, 1);
    const a4 = createDocument({ settings: { width: (210 * 96) / 25.4, height: (297 * 96) / 25.4, unit: 'mm', dpi: 300 } });
    r = await exportVectorPdf(a4, { pages: [0], includeBleed: false, cropMarks: false, fallbackDpi: 300 }, hooks(a4));
    pg = (await contents(r.bytes)).pdf.getPages()[0];
    expect(pg.getWidth()).toBeCloseTo(595.3, 0);
    expect(pg.getHeight()).toBeCloseTo(841.9, 0);
  });
});

describe('pdf helpers', () => {
  it('parses css colours', () => {
    expect(parseCssColor('#f00')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseCssColor('#00000080')!.a).toBeCloseTo(0.5, 2);
    expect(parseCssColor('rgba(255, 0, 0, 0.25)')).toEqual({ r: 1, g: 0, b: 0, a: 0.25 });
    expect(parseCssColor('white')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseCssColor('hsl(0 0% 0%)')).toBeNull();
  });
  it('turns quadratics into cubics', () => {
    expect(pathOps([['M', 0, 0], ['Q', 3, 3, 6, 0], ['Z']])).toBe('0 0 m\n2 2 4 2 6 0 c\nh');
  });
  it('matches the canvas gradient geometry', () => {
    expect(gradientCoords({ type: 'linear', angle: 0, stops: [] }, { x: -50, y: -10, w: 100, h: 20 })).toEqual([-50, 0, 50, 0]);
    expect(gradientCoords({ type: 'radial', stops: [] }, { x: 0, y: 0, w: 100, h: 40 })).toEqual([50, 20, 0, 50, 20, 50]);
  });
  it('picks the face the browser draws', () => {
    expect(matchWeight(450, [400, 700])).toBe(400);
    expect(matchWeight(600, [400, 700])).toBe(700);
    expect(matchWeight(300, [400, 700])).toBe(400);
    expect(matchWeight(900, [400, 500, 600, 700, 800])).toBe(800);
    expect(bundledFaceFor({ fontFamily: '"Roboto Slab", serif', fontWeight: 700, italic: true })).toMatchObject({ pkg: 'roboto-slab', weight: 700, synthItalic: true, synthBold: false });
    expect(bundledFaceFor({ fontFamily: 'Arial', fontWeight: 400, italic: false })).toBeNull();
  });
  it('parses page ranges', () => {
    expect(parsePageRange('1-3, 5', 6)).toEqual({ ok: true, pages: [0, 1, 2, 4] });
    expect(parsePageRange('2–', 4)).toEqual({ ok: true, pages: [1, 2, 3] });
    expect(parsePageRange('3, 3, 1', 4)).toEqual({ ok: true, pages: [2, 0] });
    expect(parsePageRange('7', 4)).toMatchObject({ ok: false });
    expect(parsePageRange('3-1', 4)).toMatchObject({ ok: false });
    expect(parsePageRange('a', 4)).toMatchObject({ ok: false });
    expect(parsePageRange('', 4)).toMatchObject({ ok: false });
    expect(formatPageRange([0, 1, 2, 4])).toBe('1–3, 5');
  });
});

describe('bundled PDF fonts', () => {
  it('embeds exactly the faces main.tsx loads, and every file exists', () => {
    const main = readFileSync('src/renderer/main.tsx', 'utf8');
    const loaded = [...main.matchAll(/@fontsource\/([a-z-]+)\/(\d+)\.css/g)].map((m) => `${m[1]}/${m[2]}`).sort();
    // faces shipped in the repo (full OpenType feature sets) are loaded by their own @font-face file
    const local = readdirSync('src/renderer/assets/fonts');
    for (const pkg of local) {
      const css = readFileSync(`src/renderer/assets/fonts/${pkg}/${pkg}.css`, 'utf8');
      expect(main).toContain(`./assets/fonts/${pkg}/${pkg}.css`);
      for (const m of css.matchAll(/font-weight: (\d+);/g)) loaded.push(`${pkg}/${m[1]}`);
    }
    loaded.sort();
    const declared = Object.values(BUNDLED_FACES).flatMap((f) => f.weights.map((w) => `${f.pkg}/${w}`)).sort();
    expect(declared).toEqual(loaded);
    const urls = readFileSync('src/renderer/engine/pdfFontFiles.ts', 'utf8');
    for (const f of Object.values(BUNDLED_FACES)) {
      for (const w of f.weights) {
        const file = `files/${f.pkg}-latin-${w}-normal.woff`;
        expect(urls).toContain(`'${f.pkg}/${file}'`);
        const path = local.includes(f.pkg) ? `src/renderer/assets/fonts/${f.pkg}/${f.pkg}-latin-${w}-normal.woff` : `node_modules/@fontsource/${f.pkg}/${file}`;
        expect(readFileSync(path).length).toBeGreaterThan(1000);
      }
    }
  });
});

describe('PDF shaping: kerning and small caps as real text', () => {
  const inter = readFileSync('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff');
  const garamond = readFileSync('src/renderer/assets/fonts/eb-garamond/eb-garamond-latin-400-normal.woff');
  async function embed(bytes: Uint8Array, features: Record<string, boolean>) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    return pdf.embedFont(bytes, { subset: true, features });
  }

  it('writes GPOS kerning as TJ adjustments, and plain Tj with kerning off', async () => {
    const kerned = shapedText(await embed(inter, pdfShapingFeatures({}, false)), 'AVATAR To', 20);
    expect(kerned.adjusted).toBe(true);
    expect(kerned.op).toMatch(/^\[<[0-9A-F]+> -?[\d.]+ .*\] TJ$/);
    const flat = shapedText(await embed(inter, pdfShapingFeatures({ kerning: false }, false)), 'AVATAR To', 20);
    expect(flat.adjusted).toBe(false);
    expect(flat.op).toMatch(/^<[0-9A-F]+> Tj$/);
    // kerning tightens AV / To: the shaped width is narrower than the raw advances
    expect(kerned.width).toBeLessThan(flat.width);
  });

  it('uses the real smcp / c2sc glyphs when the face has them (EB Garamond)', async () => {
    const plain = await embed(garamond, pdfShapingFeatures({}, false));
    const sc = await embed(garamond, pdfShapingFeatures({ caps: 'small-caps' }, true));
    expect(pdfShapingFeatures({ caps: 'all-small-caps' }, true)).toMatchObject({ smcp: true, c2sc: true });
    const fk = fontkit.create(garamond as unknown as Buffer);
    expect(fk.availableFeatures).toEqual(expect.arrayContaining(['smcp', 'c2sc', 'kern']));
    const a = fk.layout('abc', {}).glyphs.map((g) => g.id);
    const b = fk.layout('abc', { smcp: true }).glyphs.map((g) => g.id);
    expect(b).not.toEqual(a); // different (small-cap) glyphs
    expect(shapedText(sc, 'abc', 12).width).not.toBeCloseTo(shapedText(plain, 'abc', 12).width, 3);
  });

  it('splits text for synthesised small caps like Chromium', () => {
    expect(capsSegments('Hello World 42', 'small-caps')).toEqual([
      { t: 'H', small: false }, { t: 'ELLO', small: true }, { t: ' W', small: false }, { t: 'ORLD', small: true }, { t: ' 42', small: false },
    ]);
    expect(capsSegments('Hi 2', 'all-small-caps')).toEqual([{ t: 'HI', small: true }, { t: ' 2', small: false }]);
  });

  it('exports small caps frames as text, never as an image', async () => {
    let d = createDocument({ settings: { width: 400, height: 300, background: '#ffffff', dpi: 96 } });
    const r1 = addTextFrame(d, d.pages[0].id, { x: 20, y: 20, w: 300, h: 60 }, 'Small caps in Inter');
    d = r1.doc;
    const r2 = addTextFrame(d, d.pages[0].id, { x: 20, y: 120, w: 300, h: 60 }, 'Small caps in Garamond');
    d = r2.doc;
    const sid = (id: string) => (d.pages[0].nodes.find((n) => n.id === id) as Extract<SceneNode, { type: 'textframe' }>).storyId;
    const s1 = sid(r1.id);
    const s2 = sid(r2.id);
    d = { ...d, stories: { ...d.stories,
      [s1]: { ...d.stories[s1], style: { ...d.stories[s1].style, fontFamily: 'Inter', caps: 'small-caps' } },
      [s2]: { ...d.stories[s2], style: { ...d.stories[s2].style, fontFamily: 'EB Garamond', caps: 'small-caps' } } } };
    const out: SceneNode[] = [];
    const { bytes, report } = await exportVectorPdf(d, { pages: [0], includeBleed: false, cropMarks: false, fallbackDpi: 150 }, hooks(d, out));
    expect(report.rasterised).toEqual([]);
    expect(out).toHaveLength(0);
    const { pdf, ops } = await contents(bytes);
    expect(xobjects(pdf)).toBe(0);
    // Inter has no smcp: synthesised at 70% of the size (two Tf sizes in one text object)
    const size = d.stories[s1].style.fontSize;
    expect(ops[0]).toContain(` ${+(size * 0.7).toFixed(3)} Tf`);
  });
});
