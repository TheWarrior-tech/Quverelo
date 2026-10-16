import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PDFDocument, PDFName, PDFOperator, PDFString, StandardFonts, rgb, cmyk } from 'pdf-lib';
import { importPdfVectors, isPostScriptOnlyAi, Lexer, parseToUnicode, PX_PER_PT } from '../../src/core/interop/pdfImport';
import type { GroupNode, PathNode, RasterNode, SceneNode, TextNode } from '../../src/core/types';

const flat = (nodes: SceneNode[]): SceneNode[] => nodes.flatMap((n) => (n.type === 'group' ? [n, ...flat(n.children)] : [n]));

async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 100]);
  page.drawRectangle({ x: 10, y: 10, width: 50, height: 30, color: rgb(1, 0, 0), borderColor: cmyk(0, 0, 0, 1), borderWidth: 2, opacity: 0.5 });
  page.drawSvgPath('M 0 0 L 40 0 L 20 -30 Z', { x: 100, y: 80, color: rgb(0, 0, 1) });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Hello PDF', { x: 20, y: 70, size: 12, font, color: rgb(0, 0.5, 0) });
  const png = await pdf.embedPng(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'gradient.png')));
  page.drawImage(png, { x: 150, y: 10, width: 40, height: 20 });

  // Illustrator-style layers: optional content groups, one hidden
  const ctx = pdf.context;
  const ocgOn = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Artwork') }));
  const ocgOff = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Sketch') }));
  pdf.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [ocgOn, ocgOff], D: ctx.obj({ OFF: [ocgOff] }) }));
  const res = page.node.Resources()!;
  res.set(PDFName.of('Properties'), ctx.obj({ L1: ocgOn, L2: ocgOff }));
  const op = (o: string, ...args: unknown[]) => PDFOperator.of(o as never, args as never);
  page.pushOperators(
    op('BDC', PDFName.of('OC'), PDFName.of('L1')),
    op('q'), op('rg', ctx.obj(0), ctx.obj(1), ctx.obj(0)), op('re', ctx.obj(0), ctx.obj(0), ctx.obj(10), ctx.obj(10)), op('f'), op('Q'),
    op('EMC'),
    op('BDC', PDFName.of('OC'), PDFName.of('L2')),
    op('q'), op('re', ctx.obj(20), ctx.obj(0), ctx.obj(10), ctx.obj(10)), op('W'), op('n'),
    op('rg', ctx.obj(1), ctx.obj(1), ctx.obj(0)), op('re', ctx.obj(15), ctx.obj(0), ctx.obj(30), ctx.obj(10)), op('f'), op('Q'),
    op('EMC'),
  );
  return pdf.save({ useObjectStreams: false });
}

describe('PDF / Illustrator vector import', () => {
  it('lexes content stream tokens', () => {
    const lx = new Lexer(new TextEncoder().encode('1 0 0 RG /F1 12 Tf (a\\(b\\)) Tj <48 49> Tj [ (x) -120 (y) ] TJ << /A 1 >> % c\nq'));
    const toks = [];
    for (let t = lx.next(); t; t = lx.next()) toks.push(t);
    expect(toks.find((t) => t.t === 'str')).toEqual({ t: 'str', v: 'a(b)' });
    expect(toks.filter((t) => t.t === 'str')[1]).toEqual({ t: 'str', v: 'HI' });
    expect(toks.find((t) => t.t === 'arr')?.v).toHaveLength(3);
    expect(toks.find((t) => t.t === 'dict')).toBeTruthy();
    expect(toks.at(-1)).toEqual({ t: 'op', v: 'q' });
  });

  it('parses ToUnicode CMaps (bfchar and bfrange)', () => {
    const cmap = `1 begincodespacerange <0000> <FFFF> endcodespacerange
      2 beginbfchar <0003> <0020> <0024> <0041> endbfchar
      1 beginbfrange <0044> <0046> <0061> endbfrange
      1 beginbfrange <0050> <0051> [<00E9> <00FC>] endbfrange`;
    const { map, bytes } = parseToUnicode(cmap);
    expect(bytes).toBe(2);
    expect(map.get(3)).toBe(' ');
    expect(map.get(0x24)).toBe('A');
    expect(map.get(0x46)).toBe('c');
    expect(map.get(0x51)).toBe('ü');
  });

  it('rejects PostScript-only .ai files with a clear message', async () => {
    const ps = new TextEncoder().encode('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator(R) 8.0\n');
    expect(isPostScriptOnlyAi(ps)).toBe(true);
    await expect(importPdfVectors(ps, 'old')).rejects.toThrow(/PDF Compatible/);
  });

  it('imports paths, colours, opacity, text, images and layers as editable objects', async () => {
    const r = await importPdfVectors(await samplePdf(), 'Logo');
    const doc = r.doc;
    expect(doc.studio).toBe('vector');
    expect(doc.settings.width).toBeCloseTo(200 * PX_PER_PT);
    expect(doc.settings.height).toBeCloseTo(100 * PX_PER_PT);
    const all = flat(doc.pages[0].nodes);

    const rect = all.find((n) => n.type === 'path' && (n as PathNode).fill.type === 'solid' && ((n as PathNode).fill as { color: string }).color === '#ff0000') as PathNode;
    expect(rect).toBeTruthy();
    // pdf rect x 10..60, y 10..40 (bottom-up) -> px centre (35, 75) * 4/3
    expect(rect.x).toBeCloseTo(35 * PX_PER_PT, 1);
    expect(rect.y).toBeCloseTo((100 - 25) * PX_PER_PT, 1);
    expect(rect.stroke.width).toBeCloseTo(2 * PX_PER_PT, 2);
    expect(rect.stroke.paint).toEqual({ type: 'solid', color: '#000000' });
    expect(rect.opacity).toBeCloseTo(0.5);
    expect(rect.closed).toBe(true);

    const tri = all.find((n) => n.type === 'path' && ((n as PathNode).fill as { color?: string }).color === '#0000ff') as PathNode;
    expect(tri).toBeTruthy();
    expect(tri.d.filter((c) => c[0] !== 'Z').length).toBeGreaterThanOrEqual(3);

    const text = all.find((n) => n.type === 'text') as TextNode;
    expect(text.text).toBe('Hello PDF');
    expect(text.style.fontSize).toBeCloseTo(12 * PX_PER_PT, 1);
    expect(text.style.fontWeight).toBe(700);
    expect(text.style.fill).toEqual({ type: 'solid', color: '#008000' });
    // baseline at y=70pt from bottom -> 30pt from top; node centre sits just above the baseline
    expect(text.y).toBeLessThan(30 * PX_PER_PT);
    expect(text.y).toBeGreaterThan(30 * PX_PER_PT - 12 * PX_PER_PT);

    const img = all.find((n) => n.type === 'raster') as RasterNode;
    expect(img).toBeTruthy();
    expect(r.pixels.has(img.assetId) || r.encoded.has(img.assetId)).toBe(true);
    expect(img.w * img.scaleX).toBeCloseTo(40 * PX_PER_PT, 0);
    expect(img.h * img.scaleY).toBeCloseTo(20 * PX_PER_PT, 0);
    expect(img.x).toBeCloseTo(170 * PX_PER_PT, 0);
    expect(img.y).toBeCloseTo(80 * PX_PER_PT, 0);
    expect(img.flipY).toBe(false);

    const groups = doc.pages[0].nodes.filter((n): n is GroupNode => n.type === 'group');
    expect(groups.map((g) => [g.name, g.visible])).toEqual([['Artwork', true], ['Sketch', false]]);
    const clipped = groups[1].children[0];
    expect(clipped.mask?.enabled).toBe(true);
  });

  it('imports several pages as a multi-page document', async () => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 3; i++) pdf.addPage([300, 300]).drawCircle({ x: 150, y: 150, size: 50, color: rgb(0.2, 0.4, 0.6) });
    const r = await importPdfVectors(await pdf.save(), 'Multi');
    expect(r.doc.pages).toHaveLength(3);
    expect(r.doc.studio).toBe('layout');
    expect(r.doc.pages[2].nodes[0].type).toBe('path');
    expect((r.doc.pages[2].nodes[0] as PathNode).d.some((c) => c[0] === 'C')).toBe(true);
  });
});
