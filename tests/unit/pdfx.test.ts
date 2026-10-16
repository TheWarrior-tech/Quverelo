/**
 * Print PDF: CMYK conversion, spot colours, PDF/X-1a:2003 and PDF/X-4 structure.
 * Set QUVRELO_PDFX_OUT=<dir> to keep the files (veraPDF runs on them, see docs/COLOUR.md).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString } from 'pdf-lib';
import { createDocument, make, solid } from '../../src/core/document';
import { addNodes, addTextFrame } from '../../src/core/commands';
import { exportVectorPdf, type PdfColourOutput, type RgbaImage, type VectorPdfHooks } from '../../src/core/pdfVector';
import { bundledFaceFor } from '../../src/core/pdfFonts';
import { buildXmp, pdfDate, PDFX_VERSION, xmpDate } from '../../src/core/colour/pdfx';
import { PROFILES } from '../../src/core/colour/profiles';
import { flowStory, lineHeightPx, monoMeasure } from '../../src/core/textflow';
import type { QuvreloDocument, SceneNode } from '../../src/core/types';
import { testEngine } from './colourTestEngine';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

function rgba(w: number, h: number, c: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(c, i * 4);
  return { data, width: w, height: h };
}

function hooks(doc: QuvreloDocument, log: { composites: number[]; } = { composites: [] }): VectorPdfHooks {
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
    rasterise: async () => ({ bytes: PNG, mime: 'image/png', box: { x: -5, y: -5, w: 10, h: 10 } }),
    pixels: {
      raster: async (n) => rgba(8, 6, n.name === 'cutout' ? [200, 40, 40, 120] : [30, 120, 200, 255]),
      asset: async () => rgba(4, 4, [250, 200, 0, 255]),
      rasterise: async () => ({ ...rgba(10, 10, [0, 0, 0, 128]), box: { x: -5, y: -5, w: 10, h: 10 } }),
      composite: async (_page, count, box, ppu) => {
        log.composites.push(count);
        return rgba(Math.max(1, Math.round(box.w * ppu)), Math.max(1, Math.round(box.h * ppu)), [120, 60, 200, 255]);
      },
      bounds: (n) => ('w' in n ? { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h } : { x: -50, y: -10, w: 100, h: 20 }),
    },
  };
}

async function colour(standard?: 'x1a' | 'x4'): Promise<PdfColourOutput> {
  const e = await testEngine();
  return {
    cmyk: (rgb) => e.rgbToCmyk(rgb, 'srgb', 'fogra39'),
    image: (img) => (img.data instanceof Uint16Array ? e.rgba16ToCmyk(img.data, img.width * img.height, 'srgb', 'fogra39') : e.rgbaToCmyk(img.data, img.width * img.height, 'srgb', 'fogra39')),
    pdfx: standard ? { standard, profile: e.profileBytes('fogra39'), condition: PROFILES.fogra39.pdfx! } : undefined,
  };
}

/** A page with everything print has to deal with. */
function sampleDoc(): QuvreloDocument {
  let d = createDocument({ title: 'Print test', settings: { width: 600, height: 400, background: '#ffffff', dpi: 300, bleed: 12, unit: 'mm' } });
  d = addNodes(d, d.pages[0].id, [
    make.rect({ name: 'red box', x: 80, y: 80, w: 120, h: 80, fill: solid('#ff0000'), stroke: { paint: solid('#000000'), width: 2, dash: [], cap: 'butt', join: 'miter' } }),
    make.rect({ name: 'cmyk box', x: 260, y: 80, w: 80, h: 80, fill: { type: 'solid', color: '#00a0e0', cmyk: [1, 0, 0, 0] } }),
    make.ellipse({ name: 'spot dot', x: 400, y: 80, w: 60, h: 60, fill: { type: 'solid', color: '#e4002b', cmyk: [0, 1, 0.8, 0], spot: 'PANTONE 185 C' } }),
    make.rect({ name: 'gradient', x: 100, y: 250, w: 160, h: 60, fill: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#0000ff' }, { offset: 1, color: '#ffff00' }] } }),
    make.ellipse({ name: 'see-through', x: 300, y: 260, w: 100, h: 100, opacity: 0.5, fill: solid('#00ff00') }),
    make.text({ name: 'headline', text: 'Print me', x: 450, y: 300, style: { ...make.text().style, fontFamily: 'Inter, sans-serif', fill: solid('#112233') } }),
    { ...make.rect({ x: 0, y: 0, w: 10, h: 10 }), type: 'raster', name: 'photo', assetId: 'a1', adjustments: [], w: 80, h: 60, x: 520, y: 200 } as unknown as SceneNode,
  ]);
  d = addTextFrame(d, d.pages[0].id, { x: 20, y: 330, w: 300, h: 50 }, 'Body copy in a frame').doc;
  return d;
}

async function load(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const ops = pdf.getPages().map((p) => {
    const c = p.node.lookup(PDFName.of('Contents')) as PDFRawStream;
    return inflateSync(Buffer.from(c.contents)).toString('latin1');
  });
  return { pdf, ops, raw: Buffer.from(bytes).toString('latin1') };
}

function keep(name: string, bytes: Uint8Array) {
  const dir = process.env.QUVRELO_PDFX_OUT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}`, bytes);
}

/** Every image XObject on the page */
function images(pdf: PDFDocument) {
  const out: PDFDict[] = [];
  for (const p of pdf.getPages()) {
    const xo = p.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const [, ref] of xo?.entries() ?? []) out.push((pdf.context.lookup(ref) as PDFStream).dict);
  }
  return out;
}

describe('CMYK PDF', () => {
  it('writes every colour as CMYK, keeps exact CMYK values and spot inks', async () => {
    const d = sampleDoc();
    const { bytes, report } = await exportVectorPdf(d, { pages: [0], includeBleed: true, cropMarks: true, fallbackDpi: 150, colour: await colour() }, hooks(d));
    keep('quvrelo-cmyk-not-x.pdf', bytes);
    keep('quvrelo-rgb.pdf', (await exportVectorPdf(d, { pages: [0], includeBleed: true, cropMarks: true, fallbackDpi: 150 }, hooks(d))).bytes);
    const { pdf, ops } = await load(bytes);
    const s = ops[0];
    expect(s).not.toMatch(/ (rg|RG)\n/); // no RGB colour operators
    expect(s).toMatch(/ k\n/);
    expect(s).toContain('1 0 0 0 k'); // the CMYK swatch colour exactly
    expect(s).toContain('0 0 0 1 K'); // crop marks in black ink
    expect(s).toMatch(/\/CS\d+ cs 1 scn/); // spot as Separation
    expect(report.spots).toEqual(['PANTONE 185 C']);
    const cs = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('ColorSpace'), PDFDict);
    const sep = pdf.context.lookup(cs.entries()[0][1], PDFArray);
    expect(sep.get(0)).toEqual(PDFName.of('Separation'));
    expect((sep.get(1) as PDFName).decodeText()).toBe('PANTONE 185 C');
    expect(sep.get(2)).toEqual(PDFName.of('DeviceCMYK'));
    for (const im of images(pdf)) expect(im.get(PDFName.of('ColorSpace'))).toEqual(PDFName.of('DeviceCMYK'));
    expect(report.images).toBeGreaterThan(0);
    // shadings in CMYK
    const sh = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Shading'), PDFDict);
    const shading = pdf.context.lookup(sh.entries()[0][1], PDFDict);
    expect(shading.get(PDFName.of('ColorSpace'))).toEqual(PDFName.of('DeviceCMYK'));
  });

  it('16-bit pixels convert with full precision', async () => {
    const e = await testEngine();
    const px = new Uint16Array([65535, 0, 0, 65535, 0, 0, 0, 65535]);
    const out = e.rgba16ToCmyk(px, 2, 'srgb', 'fogra39');
    expect(out.length).toBe(8);
    expect(out[1]).toBeGreaterThan(220); // magenta of red
    expect(out[7]).toBeGreaterThan(200); // black of black
  });
});

describe('PDF/X', () => {
  it('helpers: matching PDF and XMP dates, XMP identification', () => {
    const d = new Date(Date.UTC(2026, 9, 16, 7, 5, 3, 456));
    expect(pdfDate(d)).toBe('D:20261016070503Z');
    expect(xmpDate(d)).toBe('2026-10-16T07:05:03Z');
    const x = buildXmp({ standard: 'x4', title: 'A & B', creatorTool: 'Quvrelo', producer: 'Quvrelo', created: d, modified: d, documentId: '1', instanceId: '2' });
    expect(x).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>');
    expect(x).toContain('A &amp; B');
    expect(x).toContain('<pdf:Trapped>False</pdf:Trapped>');
    expect(PDFX_VERSION.x1a).toBe('PDF/X-1a:2003');
  });

  for (const standard of ['x1a', 'x4'] as const) {
    it(`${standard === 'x1a' ? 'PDF/X-1a:2003' : 'PDF/X-4'}: header, ID, OutputIntent, Info, XMP, boxes`, async () => {
      const d = sampleDoc();
      const log = { composites: [] as number[] };
      const { bytes, report } = await exportVectorPdf(d, { pages: [0], includeBleed: true, cropMarks: true, fallbackDpi: 150, colour: await colour(standard) }, hooks(d, log));
      keep(`quvrelo-${standard}.pdf`, bytes);
      const { pdf, ops, raw } = await load(bytes);
      expect(raw.startsWith(standard === 'x1a' ? '%PDF-1.4' : '%PDF-1.6')).toBe(true);
      expect(raw).not.toContain('/ObjStm');
      expect(raw).toMatch(/\/ID \[ <[0-9A-F]{32}> <[0-9A-F]{32}> \]/);
      // OutputIntent
      const oi = pdf.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).lookup(0, PDFDict);
      expect(oi.get(PDFName.of('S'))).toEqual(PDFName.of('GTS_PDFX'));
      expect((oi.lookup(PDFName.of('OutputConditionIdentifier'), PDFString)).decodeText()).toBe('FOGRA39');
      const icc = oi.lookup(PDFName.of('DestOutputProfile'), PDFRawStream);
      expect(icc.dict.get(PDFName.of('N'))?.toString()).toBe('4');
      const iccBytes = inflateSync(Buffer.from(icc.contents));
      expect(iccBytes.subarray(12, 20).toString('latin1')).toBe('prtrCMYK');
      // Info
      const info = pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict);
      expect((info.lookup(PDFName.of('GTS_PDFXVersion'), PDFString)).decodeText()).toBe(PDFX_VERSION[standard]);
      expect(info.get(PDFName.of('Trapped'))).toEqual(PDFName.of('False'));
      const title = info.lookup(PDFName.of('Title')) as PDFString | PDFHexString;
      expect(title.decodeText()).toBe('Print test');
      // XMP agrees with Info
      const meta = pdf.catalog.lookup(PDFName.of('Metadata'), PDFRawStream);
      const xmp = Buffer.from(meta.contents).toString('utf8');
      expect(xmp).toContain(`<pdfxid:GTS_PDFXVersion>${PDFX_VERSION[standard]}</pdfxid:GTS_PDFXVersion>`);
      const cd = (info.lookup(PDFName.of('CreationDate'), PDFString)).decodeText();
      const m = /^D:(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(cd)!;
      expect(xmp).toContain(`<xmp:CreateDate>${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z</xmp:CreateDate>`);
      // trim inside bleed inside media
      const p = pdf.getPages()[0];
      const box = (k: string) => (p.node.lookup(PDFName.of(k), PDFArray).asArray().map((v) => Number(v.toString())));
      const [mb, bb, tb] = [box('MediaBox'), box('BleedBox'), box('TrimBox')];
      expect(tb[0]).toBeGreaterThanOrEqual(bb[0]);
      expect(tb[2]).toBeLessThanOrEqual(bb[2]);
      expect(bb[0]).toBeGreaterThanOrEqual(mb[0]);
      expect(bb[2]).toBeLessThanOrEqual(mb[2]);
      // colour
      expect(ops[0]).not.toMatch(/ (rg|RG)\n/);
      expect(raw).not.toContain('/DeviceRGB');
      for (const im of images(pdf)) expect(im.get(PDFName.of('ColorSpace'))).toEqual(PDFName.of('DeviceCMYK'));
      // fonts travel with the file
      expect(raw).toContain('/FontFile2');

      const gsDicts = () => {
        const gs = p.node.Resources()!.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
        return (gs?.entries() ?? []).map(([, r]) => pdf.context.lookup(r, PDFDict));
      };
      if (standard === 'x1a') {
        // no transparency anywhere: no soft masks, no alpha or blend graphics states, no transparency group
        expect(raw).not.toContain('/SMask');
        expect(gsDicts()).toHaveLength(0);
        expect(p.node.get(PDFName.of('Group'))).toBeUndefined();
        // the see-through circle (and the half-transparent raster fallback) were flattened with what lies under them
        expect(report.flattened.map((f) => f.name)).toContain('see-through');
        expect(log.composites.length).toBe(report.flattened.length);
        // composite of everything up to and including the circle (index 4 of the page's objects)
        expect(log.composites).toContain(5);
        // the objects above stay vector: live text
        expect(ops[0]).toMatch(/BT\n\/F\d+ [\d.]+ Tf/);
      } else {
        // live transparency, blended in CMYK
        expect(gsDicts().some((g) => g.get(PDFName.of('ca'))?.toString() === '0.5')).toBe(true);
        const grp = p.node.lookup(PDFName.of('Group'), PDFDict);
        expect(grp.get(PDFName.of('CS'))).toEqual(PDFName.of('DeviceCMYK'));
        expect(report.flattened).toEqual([]);
      }
    });
  }

  it('X-1a: a transparent pixel layer is flattened, an opaque one stays an image', async () => {
    let d = createDocument({ title: 'Photos', settings: { width: 300, height: 200, background: null, dpi: 300 } });
    d = addNodes(d, d.pages[0].id, [
      { ...make.rect({ x: 0, y: 0, w: 10, h: 10 }), type: 'raster', name: 'solid photo', assetId: 'a1', adjustments: [], w: 80, h: 60, x: 60, y: 60 } as unknown as SceneNode,
      { ...make.rect({ x: 0, y: 0, w: 10, h: 10 }), type: 'raster', name: 'cutout', assetId: 'a2', adjustments: [], w: 80, h: 60, x: 200, y: 60 } as unknown as SceneNode,
    ]);
    const { report } = await exportVectorPdf(d, { pages: [0], includeBleed: false, cropMarks: false, fallbackDpi: 150, colour: await colour('x1a') }, hooks(d));
    expect(report.flattened.map((f) => f.name)).toEqual(['cutout']);
  });
});
