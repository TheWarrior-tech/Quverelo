import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decode, encode } from 'fast-png';
import jpeg from 'jpeg-js';
import { crc32, embedIccInJpeg, embedIccInPng, iccDescription, readJpegIcc, readPngChunks, readPngIcc, writePngChunks } from '../../src/core/colour/embedIcc';

const icc = (f: string) => new Uint8Array(readFileSync(join(__dirname, '../../src/core/colour/icc', f)));

describe('ICC embedding', () => {
  it('crc32 matches the PNG reference value for IEND', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });

  it('PNG: iCCP goes right after IHDR, replaces sRGB/gAMA, and the image still decodes', () => {
    const png = encode({ width: 2, height: 2, data: new Uint8Array(16).fill(200), channels: 4, depth: 8 });
    // add an sRGB chunk the way browser encoders do
    const ch = readPngChunks(png);
    ch.splice(1, 0, { type: 'sRGB', data: new Uint8Array([0]) });
    const withSrgb = writePngChunks(ch);
    const prof = icc('AdobeCompat-v2.icc');
    const out = embedIccInPng(withSrgb, prof, iccDescription(prof)!);
    const types = readPngChunks(out).map((c) => c.type);
    expect(types[0]).toBe('IHDR');
    expect(types[1]).toBe('iCCP');
    expect(types).not.toContain('sRGB');
    const back = readPngIcc(out)!;
    expect(Array.from(back.profile)).toEqual(Array.from(prof));
    expect(back.name.length).toBeGreaterThan(0);
    // fast-png (an independent decoder) reads the same profile
    const dec = decode(out);
    expect(dec.iccEmbeddedProfile?.profile.length).toBe(prof.length);
    expect(dec.width).toBe(2);
  });

  it('JPEG: APP2 ICC_PROFILE after APP0, readable back, image still decodes', () => {
    const raw = { width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4, 128) };
    const jpg = new Uint8Array(jpeg.encode(raw, 90).data);
    const prof = icc('DisplayP3Compat-v2-magic.icc');
    const out = embedIccInJpeg(jpg, prof);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(Array.from(readJpegIcc(out)!)).toEqual(Array.from(prof));
    // replacing: embedding twice keeps one profile
    const twice = embedIccInJpeg(out, prof);
    expect(readJpegIcc(twice)!.length).toBe(prof.length);
    const img = jpeg.decode(Buffer.from(out));
    expect(img.width).toBe(8);
  });

  it('JPEG: a profile larger than one segment is split and reassembled in order', () => {
    const big = new Uint8Array(150_000).map((_, i) => i * 7);
    const raw = { width: 4, height: 4, data: Buffer.alloc(64, 10) };
    const out = embedIccInJpeg(new Uint8Array(jpeg.encode(raw, 90).data), big);
    expect(Array.from(readJpegIcc(out)!)).toEqual(Array.from(big));
  });

  it('reads profile descriptions (v2 desc)', () => {
    expect(iccDescription(icc('sRGB-v2-magic.icc'))).toMatch(/sRGB/i);
  });
});
