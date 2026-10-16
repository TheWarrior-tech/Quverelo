/**
 * Runs veraPDF on freshly exported PDF/X files when it is installed (set
 * VERAPDF=/path/to/verapdf). veraPDF ships no PDF/X profiles, so this uses the
 * rule sets in tests/pdfx (ISO 15930-4 / 15930-7 requirements written as veraPDF
 * rules). Skipped when veraPDF is not available (CI has no Java).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDocument, make, solid } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { exportVectorPdf, type RgbaImage, type VectorPdfHooks } from '../../src/core/pdfVector';
import { bundledFaceFor } from '../../src/core/pdfFonts';
import { PROFILES } from '../../src/core/colour/profiles';
import { lineHeightPx, monoMeasure } from '../../src/core/textflow';
import { testEngine } from './colourTestEngine';

const VERAPDF = process.env.VERAPDF ?? '';
const have = !!VERAPDF && existsSync(VERAPDF);

function rgba(w: number, h: number, c: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(c, i * 4);
  return { data, width: w, height: h };
}

function verapdf(profile: string, file: string): { compliant: boolean; failed: string[]; xml: string } {
  let xml: string;
  try {
    xml = execFileSync(VERAPDF, ['-p', profile, '--format', 'xml', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    xml = String((e as { stdout?: string }).stdout ?? '');
  }
  const failed = [...xml.matchAll(/clause="([^"]+)" testNumber="(\d+)" status="failed"/g)].map((m) => `${m[1]}-${m[2]}`);
  return { compliant: /isCompliant="true"/.test(xml), failed, xml };
}

describe.skipIf(!have)('veraPDF (PDF/X rule sets)', () => {
  it('PDF/X-1a and PDF/X-4 exports pass; an RGB export fails', async () => {
    const e = await testEngine();
    let d = createDocument({ title: 'veraPDF', settings: { width: 400, height: 300, background: '#ffffff', bleed: 10, unit: 'mm' } });
    d = addNodes(d, d.pages[0].id, [
      make.rect({ x: 100, y: 100, w: 120, h: 80, fill: solid('#ff0000') }),
      make.ellipse({ x: 200, y: 150, w: 120, h: 120, opacity: 0.4, blend: 'multiply', fill: solid('#0000ff') }),
      make.text({ text: 'Hello press', x: 200, y: 250, style: { ...make.text().style, fontFamily: 'Inter, sans-serif', fill: solid('#000000') } }),
    ]);
    const measure = monoMeasure();
    const hooks: VectorPdfHooks = {
      measure,
      textSize: (t, s) => ({ w: measure(t, s), h: lineHeightPx(s) }),
      flow: () => null,
      font: async (style) => {
        const f = bundledFaceFor(style)!;
        return { key: f.file, bytes: readFileSync(`node_modules/@fontsource/${f.pkg}/${f.file}`), synthItalic: false };
      },
      rasterPixels: async () => null,
      assetImage: async () => null,
      rasterise: async () => null,
      pixels: {
        raster: async () => null,
        asset: async () => null,
        rasterise: async () => null,
        composite: async (_p, _c, box, ppu) => rgba(Math.max(1, Math.round(box.w * ppu)), Math.max(1, Math.round(box.h * ppu)), [120, 0, 180, 255]),
        bounds: (n) => ('w' in n ? { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h } : { x: -40, y: -10, w: 80, h: 20 }),
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'quvrelo-verapdf-'));
    const out: Record<string, string> = {};
    for (const standard of ['x1a', 'x4', null] as const) {
      const { bytes } = await exportVectorPdf(d, {
        pages: [0], includeBleed: true, cropMarks: true, fallbackDpi: 150,
        colour: standard ? {
          cmyk: (rgb) => e.rgbToCmyk(rgb, 'srgb', 'fogra39'),
          image: (img) => e.rgbaToCmyk(img.data as Uint8Array, img.width * img.height, 'srgb', 'fogra39'),
          pdfx: { standard, profile: e.profileBytes('fogra39'), condition: PROFILES.fogra39.pdfx! },
        } : undefined,
      }, hooks);
      out[standard ?? 'rgb'] = join(dir, `${standard ?? 'rgb'}.pdf`);
      writeFileSync(out[standard ?? 'rgb'], bytes);
    }
    const x1a = verapdf('tests/pdfx/PDFX-1a-2003.xml', out.x1a);
    expect(x1a.failed).toEqual([]);
    expect(x1a.compliant).toBe(true);
    const x4 = verapdf('tests/pdfx/PDFX-4.xml', out.x4);
    expect(x4.failed).toEqual([]);
    expect(x4.compliant).toBe(true);
    // the rules really check: live transparency is not X-1a, and plain RGB is neither
    expect(verapdf('tests/pdfx/PDFX-1a-2003.xml', out.x4).failed).toContain('x1a.transparency-1');
    const rgb = verapdf('tests/pdfx/PDFX-4.xml', out.rgb);
    expect(rgb.compliant).toBe(false);
    expect(rgb.failed).toEqual(expect.arrayContaining(['x.colour-1', 'x.info-1', 'x.file-2']));
  }, 120_000);
});
