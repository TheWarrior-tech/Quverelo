import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeDng, isDng, orient, unpackSamples } from '../../src/core/raw/dng';
import { cfaColourFn, demosaicMalvar, isBayer } from '../../src/core/raw/demosaic';
import { invert3, mul3, rgbSpace } from '../../src/core/raw/rawColour';
import { distinctLevels } from '../../src/core/pixels16';
import { writeDng } from './dngFixture';

const enc = (v: number) => Math.round(rgbSpace('srgb').encode(v) * 65535);
const px = (img: { width: number; data: Uint16Array }, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

describe('raw: colour maths', () => {
  it('inverts a 3x3 matrix', () => {
    const m = [[2, 1, 0], [0, 1, 3], [1, 0, 1]];
    const id = mul3(m, invert3(m));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(id[i][j]).toBeCloseTo(i === j ? 1 : 0, 9);
  });
});

describe('raw: sample unpacking', () => {
  it('reads 12-bit MSB-first packed rows with byte-aligned row starts', () => {
    // 3 samples per row (36 bits -> 5 bytes), 2 rows
    const vals = [0xabc, 0x123, 0xfff, 0x001, 0x800, 0x7ff];
    const bytes = new Uint8Array(10);
    for (let r = 0; r < 2; r++) {
      let bit = r * 40;
      for (let i = 0; i < 3; i++) for (let k = 11; k >= 0; k--, bit++) if ((vals[r * 3 + i] >> k) & 1) bytes[bit >> 3] |= 0x80 >> (bit & 7);
    }
    expect(Array.from(unpackSamples(bytes, 6, 3, 12, true))).toEqual(vals);
  });
  it('reads 16-bit samples in either byte order', () => {
    expect(Array.from(unpackSamples(new Uint8Array([0x34, 0x12]), 1, 1, 16, true))).toEqual([0x1234]);
    expect(Array.from(unpackSamples(new Uint8Array([0x12, 0x34]), 1, 1, 16, false))).toEqual([0x1234]);
  });
});

describe('raw: demosaic', () => {
  it('Malvar reconstructs a flat colour exactly on every Bayer arrangement', () => {
    for (const cells of [[0, 1, 1, 2], [2, 1, 1, 0], [1, 0, 2, 1], [1, 2, 0, 1]]) {
      const p = { rows: 2, cols: 2, cells };
      expect(isBayer(p)).toBe(true);
      const col = cfaColourFn(p);
      const w = 12, h = 10;
      const rgb = [0.6, 0.3, 0.1];
      const m = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = rgb[col(x, y)];
      let maxErr = 0;
      demosaicMalvar(m, w, h, col, (_i, r, g, b) => {
        maxErr = Math.max(maxErr, Math.abs(r - rgb[0]), Math.abs(g - rgb[1]), Math.abs(b - rgb[2]));
      });
      expect(maxErr).toBeLessThan(1e-6);
    }
  });
  it('Malvar follows a linear ramp without zipper error in the interior', () => {
    const p = { rows: 2, cols: 2, cells: [0, 1, 1, 2] };
    const col = cfaColourFn(p);
    const w = 32, h = 16;
    const m = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = x / w;
    let maxErr = 0;
    demosaicMalvar(m, w, h, col, (i, r, g, b) => {
      const x = i % w, y = Math.floor(i / w);
      if (x < 2 || x >= w - 2 || y < 2 || y >= h - 2) return;
      maxErr = Math.max(maxErr, Math.abs(r - x / w), Math.abs(g - x / w), Math.abs(b - x / w));
    });
    expect(maxErr).toBeLessThan(1e-5);
  });
});

describe('raw: DNG decode (generated files)', () => {
  const patches = (x: number, y: number): [number, number, number] =>
    x < 16 ? (y < 16 ? [0.18, 0.18, 0.18] : [0.5, 0.1, 0.05]) : y < 16 ? [0.05, 0.3, 0.6] : [0.9, 0.9, 0.9];

  it('recognises a DNG and rejects other files', () => {
    expect(isDng(writeDng({ width: 4, height: 4, scene: () => [0.5, 0.5, 0.5] }))).toBe(true);
    expect(isDng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(false);
  });

  it('develops a Bayer DNG: black/white level, white balance and ColorMatrix give the scene colours', () => {
    const dng = writeDng({ width: 32, height: 32, scene: patches });
    const { image, info } = decodeDng(dng);
    expect(info.cfa).toBe('RGGB');
    expect(info.demosaic).toBe('malvar');
    expect(info.colourMatrix).toBe(true);
    expect(info.wb[1]).toBe(1);
    expect(info.wb[0]).toBeCloseTo(2, 3);
    expect(image.width).toBe(32);
    for (const [x, y, s] of [[8, 8, [0.18, 0.18, 0.18]], [8, 24, [0.5, 0.1, 0.05]], [24, 8, [0.05, 0.3, 0.6]], [24, 24, [0.9, 0.9, 0.9]]] as const) {
      const got = px(image, x, y);
      for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - enc(s[c]))).toBeLessThan(500); // < 0.8 % of full scale
    }
  });

  it('keeps 16-bit precision: a smooth raw gradient has far more than 256 levels', () => {
    const dng = writeDng({ width: 2048, height: 4, scene: (x) => [x / 2048, x / 2048, x / 2048] });
    const { image } = decodeDng(dng);
    expect(distinctLevels(image, 1)).toBeGreaterThan(1500);
  });

  it('reads 12-bit packed data, BGGR and an ActiveArea crop', () => {
    const dng = writeDng({ width: 36, height: 34, bps: 12, pattern: [2, 1, 1, 0], activeArea: [2, 4, 34, 36], scene: (x, y) => patches(x - 4, y - 2) });
    const { image, info } = decodeDng(dng);
    expect(info.bitsPerSample).toBe(12);
    expect(image.width).toBe(32);
    expect(image.height).toBe(32);
    // ActiveArea starts at an even offset, so the pattern stays BGGR
    expect(info.cfa).toBe('BGGR');
    const got = px(image, 24, 8);
    expect(Math.abs(got[2] - enc(0.6))).toBeLessThan(600);
  });

  it('LinearRaw DNGs skip the demosaic', () => {
    const dng = writeDng({ width: 8, height: 8, linearRaw: true, scene: () => [0.2, 0.4, 0.6] });
    const { image, info } = decodeDng(dng);
    expect(info.demosaic).toBe('none');
    const got = px(image, 3, 3);
    expect(Math.abs(got[0] - enc(0.2))).toBeLessThan(200);
    expect(Math.abs(got[2] - enc(0.6))).toBeLessThan(200);
  });

  it('applies Orientation 6 (rotate 90° clockwise)', () => {
    const dng = writeDng({ width: 32, height: 16, orientation: 6, scene: (x) => (x < 16 ? [0.9, 0.9, 0.9] : [0.02, 0.02, 0.02]) });
    const { image } = decodeDng(dng);
    expect(image.width).toBe(16);
    expect(image.height).toBe(32);
    // the left (bright) half of the sensor is now the top
    expect(px(image, 8, 4)[1]).toBeGreaterThan(50000);
    expect(px(image, 8, 28)[1]).toBeLessThan(15000);
  });

  it('orient() handles all eight TIFF orientations as a permutation', () => {
    const p = { width: 3, height: 2, data: new Uint16Array(24).map((_, i) => i) };
    for (let o = 1; o <= 8; o++) {
      const r = orient(p, o);
      expect(r.width * r.height).toBe(6);
      expect([...r.data].sort((a, b) => a - b)).toEqual([...p.data]);
    }
  });

  it('develops into Adobe RGB when the document is Adobe RGB', () => {
    const dng = writeDng({ width: 16, height: 16, scene: () => [0.5, 0.1, 0.05] });
    const s = px(decodeDng(dng).image, 8, 8);
    const a = px(decodeDng(dng, { target: 'adobe-rgb' }).image, 8, 8);
    // the same red is less saturated in the wider Adobe RGB encoding
    expect(a[0]).toBeLessThan(s[0]);
  });

  it('rejects a plain TIFF that is not a DNG', () => {
    const t = writeDng({ width: 4, height: 4, scene: () => [0.5, 0.5, 0.5] });
    // corrupt the DNGVersion tag id
    const dv = new DataView(t.buffer);
    const n = dv.getUint16(8, true);
    for (let i = 0; i < n; i++) if (dv.getUint16(10 + i * 12, true) === 50706) dv.setUint16(10 + i * 12, 50000, true);
    expect(() => decodeDng(t)).toThrow(/not a DNG/);
  });
});

/**
 * Real camera files: CC0 samples from raw.pixls.us. They are not committed
 * (size); scripts/fetch-raw-samples.sh downloads them to
 * $QUVRELO_RAW_SAMPLES (default ../raw-samples). Skipped when absent.
 */
const sampleDir = process.env.QUVRELO_RAW_SAMPLES ?? join(process.cwd(), '..', 'raw-samples');
const samples = existsSync(sampleDir) ? readdirSync(sampleDir).filter((f) => /\.dng$/i.test(f)) : [];
describe.skipIf(!samples.length)('raw: CC0 camera DNGs from raw.pixls.us', () => {
  for (const f of samples) {
    it(`decodes ${f} to a plausible photo`, () => {
      const bytes = new Uint8Array(readFileSync(join(sampleDir, f)));
      if (!isDng(bytes)) return; // the repository serves some previews as JPEG
      const { image, info } = decodeDng(bytes);
      expect(image.width).toBeGreaterThan(64);
      expect(image.height).toBeGreaterThan(48);
      // not black, not blown: a real exposure has a mid-range mean and many levels
      let sum = 0;
      for (let i = 1; i < image.data.length; i += 4) sum += image.data[i];
      const mean = sum / (image.data.length / 4) / 65535;
      expect(mean).toBeGreaterThan(0.03);
      expect(mean).toBeLessThan(0.97);
      expect(distinctLevels(image, 1)).toBeGreaterThan(256);
      expect(info.colourMatrix).toBe(true);
      console.log(`${f}: ${info.make} ${info.model} ${image.width}x${image.height} ${info.bitsPerSample}-bit cmpr ${info.compression} ${info.cfa} wb ${info.wb.map((v) => v.toFixed(2)).join('/')} mean ${mean.toFixed(3)}`);
    }, 60_000);
  }
});
