import { describe, expect, it } from 'vitest';
import { encode } from 'fast-png';
import JSZip from 'jszip';
import { decodePng16, encodePng16, pngBitDepth } from '../../src/core/png16';
import { createPixels16, distinctLevels } from '../../src/core/pixels16';
import { packQuvrelo, unpackQuvrelo } from '../../src/core/serialization';
import { createDocument, make } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';

function ramp(w = 1024): ReturnType<typeof createPixels16> {
  const p = createPixels16(w, 3);
  for (let i = 0; i < w * 3; i++) {
    const v = Math.round(((i % w) / (w - 1)) * 65535);
    p.data.set([v, 65535 - v, (v * 3) % 65536, 65535], i * 4);
  }
  return p;
}

describe('16-bit PNG', () => {
  it('encodes and decodes 16 bits per channel losslessly', () => {
    const p = ramp();
    const bytes = encodePng16(p);
    expect(pngBitDepth(bytes)).toBe(16);
    const back = decodePng16(bytes);
    expect(Array.from(back.data)).toEqual(Array.from(p.data));
    expect(distinctLevels(back)).toBe(1024);
  });

  it('keeps alpha when any pixel is see-through', () => {
    const p = ramp(16);
    p.data[3] = 1234;
    const back = decodePng16(encodePng16(p));
    expect(back.data[3]).toBe(1234);
  });

  it('widens 8-bit, grey and palette PNGs', () => {
    const g = decodePng16(encode({ width: 2, height: 1, data: new Uint8Array([0, 255]), channels: 1, depth: 8 }));
    expect(Array.from(g.data)).toEqual([0, 0, 0, 65535, 65535, 65535, 65535, 65535]);
    expect(pngBitDepth(encode({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]), channels: 4, depth: 8 }))).toBe(8);
  });

  it('a .quvrelo file keeps 16-bit assets as 16-bit PNGs', async () => {
    const p = ramp(512);
    const bytes = encodePng16(p);
    let doc = createDocument({ title: 'Deep', studio: 'photo', settings: { width: 512, height: 3, colour: { mode: 'rgb', rgbProfile: 'srgb', cmykProfile: 'fogra39', bitDepth: 16, intent: 'relative' } } });
    const node = make.raster({ assetId: 'a16', w: 512, h: 3, x: 256, y: 1.5 });
    doc = addNodes({ ...doc, assets: { a16: { id: 'a16', name: 'Deep', mime: 'image/png', width: 512, height: 3 } } }, doc.pages[0].id, [node]);
    const file = await packQuvrelo(doc, async () => ({ bytes, mime: 'image/png' }));
    const zip = await JSZip.loadAsync(file);
    expect(Object.keys(zip.files)).toContain('assets/a16.png');
    const { doc: back, assets } = await unpackQuvrelo(file);
    expect(back.settings.colour?.bitDepth).toBe(16);
    const px = decodePng16(assets.get('a16')!.bytes);
    expect(Array.from(px.data)).toEqual(Array.from(p.data));
  });
});
