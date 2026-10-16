/** AI/PDF import: shadings as real gradients, spot colours, soft masks, rotated pages, separate fill/stroke opacity. */
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, type PDFRef } from 'pdf-lib';
import { importPdfVectors, PX_PER_PT } from '../../src/core/interop/pdfImport';
import { evalFn, parsePs } from '../../src/core/interop/pdfFunction';
import { shadeToPaint, type Shade } from '../../src/core/interop/pdfShading';
import type { PathNode, SceneNode, GradientStop } from '../../src/core/types';

const flat = (nodes: SceneNode[]): SceneNode[] => nodes.flatMap((n) => (n.type === 'group' ? [n, ...flat(n.children)] : [n]));
const paths = (nodes: SceneNode[]) => flat(nodes).filter((n): n is PathNode => n.type === 'path');
const rgbOf = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const alphaOf = (c: string) => (c.length >= 9 ? parseInt(c.slice(7, 9), 16) / 255 : 1);

async function makePdf(build: (pdf: PDFDocument) => { content: string; resources: Record<string, unknown>; size?: [number, number]; rotate?: number }[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const p of build(pdf)) {
    const page = pdf.addPage(p.size ?? [200, 100]);
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(p.content)));
    page.node.set(PDFName.of('Resources'), pdf.context.obj(p.resources as never));
    if (p.rotate) page.node.set(PDFName.of('Rotate'), pdf.context.obj(p.rotate));
  }
  return pdf.save({ useObjectStreams: false });
}

const axialRedBlue = (pdf: PDFDocument, coords = [20, 0, 120, 0]): PDFRef =>
  pdf.context.register(pdf.context.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: coords, Extend: [true, true], Function: { FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 } } as never));

describe('PDF functions', () => {
  it('evaluates exponential, stitching, sampled and PostScript functions', () => {
    expect(evalFn({ type: 2, domain: [0, 1], c0: [0, 0, 0], c1: [1, 0.5, 0], n: 1 }, [0.5])).toEqual([0.5, 0.25, 0]);
    const stitched = { type: 3 as const, domain: [0, 1], bounds: [0.5], encode: [0, 1, 0, 1], fns: [{ type: 2 as const, domain: [0, 1], c0: [0], c1: [1], n: 1 }, { type: 2 as const, domain: [0, 1], c0: [1], c1: [0], n: 1 }] };
    expect(evalFn(stitched, [0.25])[0]).toBeCloseTo(0.5);
    expect(evalFn(stitched, [0.75])[0]).toBeCloseTo(0.5);
    const sampled = { type: 0 as const, domain: [0, 1], range: [0, 1], size: [2], bps: 8, encode: [], decode: [], samples: new Uint8Array([0, 255]) };
    expect(evalFn(sampled, [0.5])[0]).toBeCloseTo(0.5, 2);
    const ps = { type: 4 as const, domain: [0, 1], range: [0, 1, 0, 1, 0, 1, 0, 1], program: parsePs('{ dup 0.5 mul 0 0 }') };
    expect(evalFn(ps, [0.8])).toEqual([0.8, 0.4, 0, 0]);
    const cond = { type: 4 as const, domain: [0, 1], range: [0, 1], program: parsePs('{ dup 0.5 gt { pop 1 } { pop 0 } ifelse }') };
    expect(evalFn(cond, [0.7])).toEqual([1]);
    expect(evalFn(cond, [0.2])).toEqual([0]);
  });

  it('re-expresses an axial shading on an object box (stops land where the PDF had them)', () => {
    const sh: Shade = { kind: 'axial', a: [20, 0], b: [120, 0], r0: 0, r1: 0, stops: [{ t: 0, c: { r: 1, g: 0, b: 0, a: 1 } }, { t: 1, c: { r: 0, g: 0, b: 1, a: 1 } }] };
    const { paint } = shadeToPaint(sh, { x: 0, y: 0, w: 200, h: 50 });
    expect(paint.type).toBe('linear');
    const stops = (paint as { stops: GradientStop[] }).stops;
    expect((paint as { angle: number }).angle).toBeCloseTo(0);
    // box 0..200: the axis 20..120 covers u = 0.1..0.6; red before, blue after (Extend)
    expect(stops.map((s) => s.offset)).toEqual([0, 0.1, 0.6, 1]);
    expect(stops[0].color).toBe('#ff0000');
    expect(stops[3].color).toBe('#0000ff');
  });
});

describe('AI/PDF import: gradients, spot colours, masks, rotation, opacity', () => {
  it('turns "clip + sh" into a gradient-filled shape', async () => {
    const bytes = await makePdf((pdf) => [{ content: 'q 20 20 100 50 re W n /Sh0 sh Q', resources: { Shading: { Sh0: axialRedBlue(pdf) } } }]);
    const r = await importPdfVectors(bytes, 'Gradient');
    const p = paths(r.doc.pages[0].nodes);
    expect(p).toHaveLength(1);
    expect(p[0].fill.type).toBe('linear');
    const stops = (p[0].fill as { stops: GradientStop[] }).stops;
    expect(stops[0].color).toBe('#ff0000');
    // the shape spans x 20..120 = the axis: pure red to pure blue
    expect(stops.at(-1)!.color).toBe('#0000ff');
    expect(p[0].mask).toBeUndefined();
    expect(r.warnings.join(' ')).not.toMatch(/not imported|flat grey/);
  });

  it('fills with a shading pattern (radial) and keeps spot colours through their tint transform', async () => {
    const bytes = await makePdf((pdf) => {
      const radial = pdf.context.register(pdf.context.obj({ ShadingType: 3, ColorSpace: 'DeviceGray', Coords: [100, 50, 0, 100, 50, 40], Extend: [true, true], Function: { FunctionType: 2, Domain: [0, 1], C0: [1], C1: [0], N: 1 } } as never));
      const pattern = pdf.context.register(pdf.context.obj({ PatternType: 2, Shading: radial, Matrix: [1, 0, 0, 1, 0, 0] } as never));
      const tint = pdf.context.register(pdf.context.stream('{ dup 0.5 mul 0 0 }', { FunctionType: 4, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1, 0, 1] } as never));
      const spot = pdf.context.obj(['Separation', 'School#20Blue', 'DeviceCMYK', tint] as never);
      return [{ content: '/Pattern cs /P0 scn 60 10 80 80 re f /CS0 cs 1 scn 0 0 20 20 re f', resources: { Pattern: { P0: pattern }, ColorSpace: { CS0: spot } } }];
    });
    const r = await importPdfVectors(bytes, 'Radial');
    const [ring, spot] = paths(r.doc.pages[0].nodes);
    expect(ring.fill.type).toBe('radial');
    const stops = (ring.fill as { stops: GradientStop[] }).stops;
    expect(stops[0].color).toBe('#ffffff'); // white centre
    expect(rgbOf(stops.at(-1)!.color)[0]).toBeLessThan(10); // black at the edge (r1 = 40pt = the box half-width)
    // tint 1 of the spot → CMYK (1, 0.5, 0, 0) → a blue, not grey or white
    expect(spot.fill).toEqual({ type: 'solid', color: '#0080ff' });
  });

  it('keeps different fill and stroke opacity on their own paints', async () => {
    const bytes = await makePdf((pdf) => [{ content: '/GS0 gs 1 0 0 rg 0 0 1 RG 4 w 20 20 60 40 re B', resources: { ExtGState: { GS0: pdf.context.obj({ ca: 0.25, CA: 0.75 } as never) } } }]);
    const r = await importPdfVectors(bytes, 'Alpha');
    const [p] = paths(r.doc.pages[0].nodes);
    expect(p.opacity).toBe(1);
    expect(alphaOf((p.fill as { color: string }).color)).toBeCloseTo(0.25, 1);
    expect(alphaOf((p.stroke.paint as { color: string }).color)).toBeCloseTo(0.75, 1);
    expect(r.warnings.join(' ')).not.toMatch(/merged/);
  });

  it('turns a luminosity soft mask with a gradient into a fading fill plus a shape mask', async () => {
    const bytes = await makePdf((pdf) => {
      const white2black = pdf.context.register(pdf.context.obj({ ShadingType: 2, ColorSpace: 'DeviceGray', Coords: [10, 0, 110, 0], Extend: [true, true], Function: { FunctionType: 2, Domain: [0, 1], C0: [1], C1: [0], N: 1 } } as never));
      const group = pdf.context.register(pdf.context.stream('q 10 10 100 50 re W n /Sh1 sh Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 100], Group: { S: 'Transparency', CS: 'DeviceGray' }, Resources: { Shading: { Sh1: white2black } } } as never));
      const gs = pdf.context.obj({ SMask: { Type: 'Mask', S: 'Luminosity', G: group } } as never);
      return [{ content: '/GS1 gs 1 0 0 rg 10 10 100 50 re f', resources: { ExtGState: { GS1: gs } } }];
    });
    const r = await importPdfVectors(bytes, 'Fade');
    const [p] = paths(r.doc.pages[0].nodes);
    expect(p.fill.type).toBe('linear');
    const stops = (p.fill as { stops: GradientStop[] }).stops;
    // red throughout, opaque on the left, transparent on the right
    expect(rgbOf(stops[0].color)).toEqual([255, 0, 0]);
    expect(alphaOf(stops[0].color)).toBeCloseTo(1, 1);
    expect(alphaOf(stops.at(-1)!.color)).toBeLessThan(0.05);
    expect(p.mask?.enabled).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/Soft|opacity mask/i);
  });

  it('turns a solid-shape soft mask into a vector mask', async () => {
    const bytes = await makePdf((pdf) => {
      const group = pdf.context.register(pdf.context.stream('1 g 50 0 50 100 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 100], Resources: {} } as never));
      return [{ content: '/GS1 gs 0 0 1 rg 0 0 200 100 re f', resources: { ExtGState: { GS1: pdf.context.obj({ SMask: { S: 'Luminosity', G: group } } as never) } } }];
    });
    const r = await importPdfVectors(bytes, 'Shape mask');
    const [p] = paths(r.doc.pages[0].nodes);
    expect(p.mask?.d.length).toBeGreaterThan(3);
    expect(p.opacity).toBeCloseTo(1);
  });

  it('shows a /Rotate 90 page the way a PDF viewer does', async () => {
    const bytes = await makePdf(() => [{ content: '1 0 0 rg 0 0 50 20 re f', resources: {}, size: [200, 100], rotate: 90 }]);
    const r = await importPdfVectors(bytes, 'Rotated');
    expect(r.doc.settings.width).toBeCloseTo(100 * PX_PER_PT);
    expect(r.doc.settings.height).toBeCloseTo(200 * PX_PER_PT);
    const [p] = paths(r.doc.pages[0].nodes);
    // bottom-left 50×20 pt box ends up top-left after a clockwise quarter turn: 20 wide, 50 tall
    const xs = p.d.filter((c) => c[0] !== 'Z').map((c) => (c[1] as number) + p.x);
    const ys = p.d.filter((c) => c[0] !== 'Z').map((c) => (c[2] as number) + p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(20 * PX_PER_PT, 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
    expect(Math.max(...ys)).toBeCloseTo(50 * PX_PER_PT, 1);
    expect(r.warnings.join(' ')).not.toMatch(/Rotated/);
  });
});
