import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFDict } from 'pdf-lib';
import { createDocument, make, solid } from '../../src/core/document';
import { addNodes, addTextFrame } from '../../src/core/commands';
import { exportVectorPdf, gradientCoords, parseCssColor, pathOps, type VectorPdfHooks } from '../../src/core/pdfVector';
import { bundledFaceFor, matchWeight } from '../../src/core/pdfFonts';
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
      return { key: f.file, bytes: readFileSync(`node_modules/@fontsource/${f.pkg}/${f.file}`), synthItalic: f.synthItalic };
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
    let d = createDocument({ settings: { width: 400, height: 300, background: '#ffffff' } });
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
    expect(s).toMatch(/> Tj/);
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
    let d = createDocument({ settings: { width: 200, height: 100, bleed: 10 } });
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
