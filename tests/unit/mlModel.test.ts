/**
 * End-to-end check of the shipped model through the same TS pre/post-processing the app uses,
 * run with onnxruntime-web (WASM) in Node, compared with the Python onnxruntime reference mask
 * stored in tests/fixtures/ml/model_parity.json (generated from the held-out split; CC BY 2.0
 * attribution inside the fixture).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-web';
import { buildInput } from '../../src/core/ml/tensor';
import { selectSubject, type SegmentationBackend } from '../../src/core/ml/selectSubject';

const MODEL = resolve(__dirname, '../../ml/models/quvselect.onnx');
const fx = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/ml/model_parity.json'), 'utf8'));

function unpackBits(b64: string, n: number): Uint8Array {
  const bytes = Buffer.from(b64, 'base64');
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return out;
}

describe.skipIf(!existsSync(MODEL))('QuvSelect ONNX model (onnxruntime-web, CPU)', () => {
  it('matches the Python reference mask and runs well under 1 s', async () => {
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ['wasm'] });
    const img = { width: fx.w, height: fx.h, data: new Uint8ClampedArray(Buffer.from(fx.rgba, 'base64')) };
    const S = fx.size as number;
    const input = buildInput(img, [], null, S);
    const t0 = performance.now();
    const out = await session.run({ input: new ort.Tensor('float32', input, [1, 6, S, S]) });
    const ms = performance.now() - t0;
    const logits = out.logits.data as Float32Array;
    expect(logits.length).toBe(S * S);
    const ref = unpackBits(fx.subject_mask_320, S * S);
    let agree = 0;
    for (let i = 0; i < ref.length; i++) if ((logits[i] > 0 ? 1 : 0) === ref[i]) agree++;
    // Python resizes in uint8 (PIL), TS in float: allow a little disagreement along edges
    expect(agree / ref.length).toBeGreaterThan(0.97);
    expect(ms).toBeLessThan(1000);

    const backend: SegmentationBackend = {
      name: 'test-ort-web',
      run: async (x, size) => (await session.run({ input: new ort.Tensor('float32', x, [1, 6, size, size]) })).logits.data as Float32Array,
    };
    // parity with the Python reference: compare the raw network mask (no edge refinement / matting)
    const res = await selectSubject(img, { backend, matte: false });
    expect(res.source).toBe('ml');
    const frac = res.binary.reduce((a, b) => a + b, 0) / res.binary.length;
    expect(Math.abs(frac - fx.subject_fg_frac)).toBeLessThan(0.08);
  }, 30000);
});
