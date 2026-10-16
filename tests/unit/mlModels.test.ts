import { describe, expect, it } from 'vitest';
import { MODEL_PREFERENCE, pickModel } from '../../src/core/ml/models';
import { selectObject, selectSubject, type SegmentationBackend } from '../../src/core/ml/selectSubject';
import { upsampleMatte } from '../../src/core/ml/tensor';

describe('bundled model choice', () => {
  it('prefers v1 fp32, then v1 int8, then the committed v0', () => {
    const all = {
      '../../../ml/models/quvselect.onnx': '/a/v0.onnx',
      '../../../ml/models/quvselect_v1.onnx': '/a/v1.onnx',
      '../../../ml/models/quvselect_v1_int8.onnx': '/a/v1i8.onnx',
    };
    expect(pickModel(all)?.id).toBe('quvselect-v1');
    const { ['../../../ml/models/quvselect_v1.onnx']: _drop, ...noFp32 } = all;
    expect(pickModel(noFp32)?.id).toBe('quvselect-v1-int8');
    expect(pickModel({ '../../../ml/models/quvselect.onnx': '/a/v0.onnx' })).toEqual({ ...MODEL_PREFERENCE[2], url: '/a/v0.onnx' });
    expect(pickModel({})).toBeNull();
  });
});

describe('Select Subject with soft matte', () => {
  // A white image with a dark 60x60 square; the fake network sees a blurry blob slightly larger than it.
  const W = 120, H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const fg = x >= 30 && x < 90 && y >= 20 && y < 80;
      data[i] = data[i + 1] = data[i + 2] = fg ? 40 : 230;
      data[i + 3] = 255;
    }
  const img = { width: W, height: H, data };
  const blob: SegmentationBackend = {
    name: 'fake-blob',
    inputSize: 64,
    run: async (_x, S) => {
      const out = new Float32Array(S * S);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = Math.max(0, Math.abs(x + 0.5 - S / 2) - S * 0.25), dy = Math.max(0, Math.abs(y + 0.5 - S / 2) - S * 0.3);
          out[y * S + x] = 3 - Math.hypot(dx, dy) * 2; // positive 1.5 model px (~3 image px) past the square
        }
      return out;
    },
  };

  it('snaps the soft matte to the real edge and uses the backend input size', async () => {
    let seen = 0;
    const be: SegmentationBackend = { ...blob, run: (x, S) => { seen = S; return blob.run(x, S); } };
    const raw = await selectSubject(img, { backend: be, matte: false });
    const soft = await selectSubject(img, { backend: be });
    expect(seen).toBe(64);
    const area = (b: Uint8Array) => b.reduce((a, v) => a + v, 0);
    const truth = 60 * 60;
    expect(Math.abs(area(soft.binary) - truth)).toBeLessThan(Math.abs(area(raw.binary) - truth));
    expect(Math.abs(area(soft.binary) - truth) / truth).toBeLessThan(0.05);
    // inside opaque, outside transparent, and it is a real soft matte (bytes, not 0/1)
    expect(soft.mask.data[50 * W + 60]).toBe(255);
    expect(soft.mask.data[5 * W + 5]).toBe(0);
  });

  it('flip test-time augmentation runs the network twice and stays symmetric on a symmetric scene', async () => {
    let calls = 0;
    const be: SegmentationBackend = { ...blob, run: (x, S) => { calls++; return blob.run(x, S); } };
    const r = await selectSubject(img, { backend: be, flipTTA: true });
    expect(calls).toBe(2);
    expect(r.binary[50 * W + 31]).toBe(r.binary[50 * W + (W - 1 - 31)]);
  });

  it('upsamples a matte to the full image size', () => {
    const m = { width: 2, height: 1, data: new Uint8Array([0, 255]) };
    const a = upsampleMatte(m, 8, 2);
    expect(a.length).toBe(16);
    expect(a[0]).toBe(0);
    expect(a[7]).toBe(255);
    expect(a[3]).toBeGreaterThan(0);
    expect(a[3]).toBeLessThan(255);
  });
});

describe('per-model focus passes (Object Select)', () => {
  // small dark square on white; the fake network answers a blob around the click, so the coarse region is small
  const W = 400, H = 300;
  const data = new Uint8ClampedArray(W * H * 4).fill(235);
  for (let y = 140; y < 160; y++) for (let x = 190; x < 210; x++) { const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = 30; }
  const img = { width: W, height: H, data };
  const fake = (focusPasses?: boolean) => {
    const sizes: number[] = [];
    const backend: SegmentationBackend = {
      name: 'fake', focusPasses,
      async run(input, size) {
        sizes.push(size);
        const pos = input.subarray(3 * size * size, 4 * size * size); // positive click map -> logits
        return Float32Array.from(pos, (v) => (v > 0.3 ? 4 : -4));
      },
    };
    return { backend, sizes };
  };
  it('v1 runs the single coarse pass, v0 adds the four zoomed passes, an explicit option wins', async () => {
    expect(MODEL_PREFERENCE.find((m) => m.id === 'quvselect-v1')!.focusPasses).toBe(false);
    expect(MODEL_PREFERENCE.find((m) => m.id === 'quvselect-v0')!.focusPasses).toBe(true);
    const click = [{ x: 200, y: 150, positive: true }];
    const a = fake(false); await selectObject(img, click, { backend: a.backend });
    expect(a.sizes.length).toBe(1);
    const b = fake(true); await selectObject(img, click, { backend: b.backend });
    expect(b.sizes.length).toBe(5);
    const c = fake(undefined); await selectObject(img, click, { backend: c.backend });
    expect(c.sizes.length).toBe(5); // default stays as before
    const d = fake(false); await selectObject(img, click, { backend: d.backend, focus: true });
    expect(d.sizes.length).toBe(5);
  });
});
