import { describe, expect, it } from 'vitest';
import { writePsdUint8Array, readPsd, type Psd } from 'ag-psd';
import { applyPixelMask, bezierToPath, blendFromPsd, blendToPsd, fontFromPostScript, importPsd, psdColorHex } from '../../src/core/interop/psd';
import { BLEND_MODES } from '../../src/core/types';
import type { GroupNode, PathNode, RasterNode, TextNode } from '../../src/core/types';

function img(w: number, h: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: w, height: h, data };
}

/** A small layered PSD written with ag-psd: background, group with two layers, shape and text. */
export function samplePsd(): Uint8Array {
  const psd: Psd = {
    width: 200,
    height: 100,
    imageData: img(200, 100, [255, 255, 255, 255]),
    children: [
      { name: 'Background', left: 0, top: 0, right: 200, bottom: 100, imageData: img(200, 100, [250, 250, 250, 255]) },
      {
        name: 'Stuff',
        opened: true,
        opacity: 0.5,
        blendMode: 'pass through',
        children: [
          { name: 'Red', left: 10, top: 10, right: 50, bottom: 30, blendMode: 'multiply', opacity: 0.75, imageData: img(40, 20, [255, 0, 0, 255]) },
          { name: 'Hidden', left: 60, top: 10, right: 70, bottom: 20, hidden: true, blendMode: 'linear burn', imageData: img(10, 10, [0, 0, 255, 255]) },
        ],
      },
      {
        name: 'Masked', left: 100, top: 0, right: 140, bottom: 40, imageData: img(40, 40, [0, 255, 0, 255]),
        mask: { left: 100, top: 0, right: 120, bottom: 40, defaultColor: 0, imageData: img(20, 40, [255, 255, 255, 255]) },
      },
      {
        name: 'Box', left: 150, top: 50, right: 190, bottom: 90, imageData: img(40, 40, [0, 0, 0, 255]),
        vectorFill: { type: 'color', color: { r: 10, g: 20, b: 30 } },
        vectorMask: {
          paths: [{
            open: false, fillRule: 'non-zero',
            knots: [
              { linked: false, points: [150, 50, 150, 50, 150, 50] },
              { linked: false, points: [190, 50, 190, 50, 190, 50] },
              { linked: false, points: [190, 90, 190, 90, 190, 90] },
              { linked: false, points: [150, 90, 150, 90, 150, 90] },
            ],
          }],
        },
      },
    ],
  };
  return writePsdUint8Array(psd, { generateThumbnail: false });
}

function importPsdRaw(): Psd {
  importPsd(samplePsd(), 'warm-up'); // installs the pixel factory for Node
  return readPsd(samplePsd(), { useImageData: true });
}

describe('PSD import', () => {
  it('maps every Photoshop blend mode to a model mode and back', () => {
    expect(blendFromPsd('multiply')).toEqual({ blend: 'multiply', exact: true });
    expect(blendFromPsd('color burn').blend).toBe('color-burn');
    expect(blendFromPsd('linear burn')).toEqual({ blend: 'color-burn', exact: false });
    expect(blendFromPsd(undefined).blend).toBe('normal');
    for (const m of BLEND_MODES) expect(blendFromPsd(blendToPsd(m)).blend).toBe(m);
  });

  it('reads colours in every PSD colour space', () => {
    expect(psdColorHex({ r: 255, g: 0, b: 128 })).toBe('#ff0080');
    expect(psdColorHex({ fr: 1, fg: 1, fb: 0 })).toBe('#ffff00');
    expect(psdColorHex({ c: 0, m: 0, y: 0, k: 255 })).toBe('#000000');
    expect(psdColorHex({ k: 0 })).toBe('#ffffff');
    expect(psdColorHex({ l: 100, a: 0, b: 0 })).toBe('#ffffff');
    expect(psdColorHex({ h: 120, s: 1, b: 1 })).toBe('#00ff00');
  });

  it('turns PostScript font names into family, weight and style', () => {
    expect(fontFromPostScript('Inter-SemiBoldItalic')).toMatchObject({ weight: 600, italic: true });
    expect(fontFromPostScript('ArialMT').family.startsWith('Arial,')).toBe(true);
    expect(fontFromPostScript('Roboto-Black').weight).toBe(900);
  });

  it('converts bezier knots to closed path commands', () => {
    const d = bezierToPath([{ open: false, fillRule: 'non-zero', knots: [{ linked: false, points: [0, 0, 0, 0, 0, 0] }, { linked: false, points: [10, 0, 10, 0, 10, 0] }] }]);
    expect(d[0]).toEqual(['M', 0, 0]);
    expect(d.at(-1)).toEqual(['Z']);
    expect(d.filter((c) => c[0] === 'C')).toHaveLength(2);
  });

  it('applies a pixel mask to alpha, using the default colour outside the mask', () => {
    const px = img(4, 1, [1, 2, 3, 255]);
    applyPixelMask(px, 0, 0, { left: 0, top: 0, right: 2, bottom: 1, defaultColor: 0, imageData: img(2, 1, [128, 128, 128, 255]) });
    expect([px.data[3], px.data[7], px.data[11], px.data[15]]).toEqual([128, 128, 0, 0]);
  });

  it('imports layers, groups, blend modes, opacity, visibility, masks and shapes', () => {
    const r = importPsd(samplePsd(), 'Sample');
    const doc = r.doc;
    expect(doc.studio).toBe('photo');
    expect(doc.settings).toMatchObject({ width: 200, height: 100, background: null });
    const nodes = doc.pages[0].nodes;
    expect(nodes.map((n) => n.name)).toEqual(['Background', 'Stuff', 'Masked', 'Box']);

    const bg = nodes[0] as RasterNode;
    expect(bg.type).toBe('raster');
    expect([bg.x, bg.y, bg.w, bg.h]).toEqual([100, 50, 200, 100]);
    expect(r.pixels.get(bg.assetId)?.data[0]).toBe(250);
    expect(doc.assets[bg.assetId]).toMatchObject({ width: 200, height: 100 });

    const g = nodes[1] as GroupNode;
    expect(g.type).toBe('group');
    expect(g.opacity).toBeCloseTo(0.5, 2);
    expect(g.children.map((c) => c.name)).toEqual(['Red', 'Hidden']);
    const red = g.children[0] as RasterNode;
    expect(red.blend).toBe('multiply');
    expect(red.opacity).toBeCloseTo(0.75, 2);
    // children are group-local; group + child = original document position (centre 30,20)
    expect(g.x + red.x).toBeCloseTo(30);
    expect(g.y + red.y).toBeCloseTo(20);
    expect(g.children[1].visible).toBe(false);
    expect(g.children[1].blend).toBe('color-burn');

    const masked = nodes[2] as RasterNode;
    const mp = r.pixels.get(masked.assetId)!;
    expect(mp.data[3]).toBe(255); // inside mask
    expect(mp.data[(0 * 40 + 30) * 4 + 3]).toBe(0); // outside: default colour 0

    const box = nodes[3] as PathNode;
    expect(box.type).toBe('path');
    expect(box.fill).toEqual({ type: 'solid', color: '#0a141e' });
    expect([box.x, box.y]).toEqual([170, 70]);
    expect(box.closed).toBe(true);

    expect(r.warnings.some((w) => w.includes('linear burn'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('Pixel masks'))).toBe(true);
  });

  it('keeps text layers as editable text', () => {
    // ag-psd reads text layers from the layer's TySh block; build one and read it back as parsed data
    const psd = importPsdRaw();
    psd.children!.push({
      name: 'Title', left: 20, top: 60, right: 120, bottom: 90, imageData: img(100, 30, [0, 0, 0, 0]),
      text: {
        text: 'Hello\rworld', transform: [2, 0, 0, 2, 20, 80],
        style: { font: { name: 'Inter-Bold' }, fontSize: 12, fillColor: { r: 200, g: 0, b: 0 }, tracking: 50 },
        paragraphStyle: { justification: 'center' },
      },
    });
    const bytes = writePsdUint8Array(psd, { generateThumbnail: false, invalidateTextLayers: true });
    const r = importPsd(bytes, 'T');
    const t = r.doc.pages[0].nodes.find((n) => n.name === 'Title') as TextNode;
    expect(t.type).toBe('text');
    expect(t.text).toBe('Hello\nworld');
    expect(t.style.fontSize).toBeCloseTo(24);
    expect(t.style.fontWeight).toBe(700);
    expect(t.style.align).toBe('center');
    expect(t.style.letterSpacing).toBe(50);
    expect(t.style.fill).toEqual({ type: 'solid', color: '#c80000' });
  });

  it('falls back to the composite for a flattened PSD', () => {
    const bytes = writePsdUint8Array({ width: 8, height: 4, imageData: img(8, 4, [9, 9, 9, 255]) }, { generateThumbnail: false });
    const r = importPsd(bytes, 'Flat');
    const n = r.doc.pages[0].nodes;
    expect(n).toHaveLength(1);
    expect(n[0].name).toBe('Background');
  });
});
