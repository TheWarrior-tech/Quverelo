import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { createDocument, make, makeStroke, solid } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { pageToSvg } from '../../src/core/svg';
import { exportVectorPdf, type VectorPdfHooks } from '../../src/core/pdfVector';
import { bundledFaceFor } from '../../src/core/pdfFonts';
import { lineHeightPx, monoMeasure } from '../../src/core/textflow';
import type { GroupNode, QuvreloDocument, SceneNode } from '../../src/core/types';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

function hooks(rasterised: SceneNode[] = []): VectorPdfHooks {
  const measure = monoMeasure();
  return {
    measure,
    textSize: (text, style) => ({ w: measure(text, style), h: lineHeightPx(style) }),
    flow: () => null as never,
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

async function ops(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const c = pdf.getPages()[0].node.lookup(PDFName.of('Contents')) as PDFRawStream;
  return inflateSync(Buffer.from(c.contents)).toString('latin1');
}

const stops = [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }];

function sample(): QuvreloDocument {
  let d = createDocument({ settings: { width: 800, height: 600, background: '#ffffff' } });
  const arrow = make.path({ x: 100, y: 100, d: [['M', -50, 0], ['L', 50, 0]], stroke: { ...makeStroke('#000000', 4), endArrow: 'triangle' } });
  const taper = make.path({ x: 100, y: 200, d: [['M', -50, 0], ['C', -20, -40, 20, 40, 50, 0]], stroke: { ...makeStroke('#112233', 12), profile: [{ t: 0, w: 0 }, { t: 0.5, w: 1 }, { t: 1, w: 0 }] } });
  const lin = make.rect({ x: 300, y: 100, w: 100, h: 50, fill: { type: 'linear', angle: 0, stops, from: { x: 0.25, y: 0.5 }, to: { x: 0.75, y: 0.5 } } });
  const rad = make.ellipse({ x: 300, y: 200, w: 100, h: 100, fill: { type: 'radial', stops, center: { x: 0.5, y: 0.5 }, edge: { x: 1, y: 0.5 }, focal: { x: 0.4, y: 0.4 } } });
  const con = make.rect({ x: 450, y: 100, w: 80, h: 80, fill: { type: 'conical', angle: 30, stops } });
  const comp: GroupNode = {
    ...make.group([make.rect({ x: 0, y: 0, w: 80, h: 80 }), make.ellipse({ x: 30, y: 0, w: 50, h: 50 })], { x: 450, y: 250 }),
    compound: { op: 'subtract', fill: solid('#00aa00'), stroke: makeStroke() },
  };
  const board: GroupNode = { ...make.group([make.rect({ x: 0, y: 0, w: 300, h: 50, fill: solid('#333333') })], { x: 650, y: 450, name: 'Card' }), artboard: { w: 200, h: 200, background: '#eeeeee' } };
  const onPath = make.text({ x: 200, y: 450, text: 'Around', style: { ...make.text().style, fontFamily: 'Inter, sans-serif', fontSize: 20, fill: solid('#000000') }, onPath: { d: [['M', -100, 0], ['C', -50, -60, 50, -60, 100, 0]], start: 0.1 } });
  d = addNodes(d, d.pages[0].id, [arrow, taper, lin, rad, con, comp, board, onPath]);
  return d;
}

describe('SVG export of vector features', () => {
  const svg = pageToSvg(sample(), sample().pages[0]);
  it('writes gradient geometry in user space, including radial focus', () => {
    expect(svg).toMatch(/<linearGradient id="lg\d+" gradientUnits="userSpaceOnUse" x1="-25" y1="0" x2="25" y2="0">/);
    expect(svg).toMatch(/<radialGradient id="rg\d+" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="50" fx="-10" fy="-10">/);
  });
  it('writes conical fills as clipped wedges, arrowheads and variable width as filled outlines', () => {
    const wedges = svg.match(/fill="#[0-9a-f]{6}" stroke="none" fill-rule="evenodd"/g) ?? [];
    expect(wedges.length).toBeGreaterThanOrEqual(180);
    expect(svg).toContain('fill-rule="nonzero"'); // tapered stroke outline
    expect(svg).toMatch(/<path d="M50 0 L38 6.6 L38 -6.6 Z"/); // triangle head with its tip on the end point
  });
  it('writes compounds as one path, artboards clipped with their background, and text on a path', () => {
    expect(svg).toContain('fill="#00aa00"');
    expect(svg).toContain('data-artboard="true"');
    expect(svg).toContain('fill="#eeeeee"');
    expect(svg).toMatch(/<clipPath id="clip\d+"><path d="M-100 -100 L100 -100 L100 100 L-100 100 Z"\/><\/clipPath>/);
    expect(svg).toMatch(/<textPath href="#tp\d+" xlink:href="#tp\d+" startOffset="10%">Around<\/textPath>/);
  });
  it('is well-formed XML', () => {
    const tags = svg.replace(/<\?xml[^>]*\?>/, '').match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
    const stack: string[] = [];
    for (const t of tags) {
      if (t.endsWith('/>')) continue;
      const name = /<\/?([a-zA-Z]+)/.exec(t)![1];
      if (t.startsWith('</')) expect(stack.pop()).toBe(name);
      else stack.push(name);
    }
    expect(stack).toEqual([]);
  });
});

describe('PDF export of vector features', () => {
  it('keeps arrows, profiles, compounds, artboards, conical wedges and text on a path as vectors', async () => {
    const rasterised: SceneNode[] = [];
    const d = sample();
    const { bytes, report } = await exportVectorPdf(d, { pages: [0], includeBleed: false, cropMarks: false, fallbackDpi: 150 }, hooks(rasterised));
    expect(report.rasterised).toEqual([]);
    expect(rasterised).toHaveLength(0);
    const s = await ops(bytes);
    // rotated glyphs for text on a path: Tm with non-trivial rotation
    const tms = s.match(/^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm$/gm) ?? [];
    expect(tms.length).toBe(6);
    expect(tms.some((t) => !t.startsWith('1 0 '))).toBe(true);
    // conical wedges: many solid fills
    expect((s.match(/ rg\n/g) ?? []).length).toBeGreaterThan(180);
    // radial shading with a focal point and a non-zero filled outline
    expect(s).toMatch(/\/Sh\d+ sh/);
    expect(s).toMatch(/\nf\n/);
  });
});
