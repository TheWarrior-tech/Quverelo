// Stage breakdown of Select Subject at the app's 1024 px analysis size, in Node with the same onnxruntime-web WASM
// binary the app bundles:  npx vite-node ml/bench/subject_breakdown.ts [model.onnx] [subsample=1,2]
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import jpeg from 'jpeg-js';
import { analysisSize } from '../../src/core/ml/coords';
import { buildInput, logitsToProb, resizePlane } from '../../src/core/ml/tensor';
import { refineMatte } from '../../src/core/ml/matte';
import { selectSubject } from '../../src/core/ml/selectSubject';

const model = process.argv[2] ?? 'ml/models/quvselect_v1.onnx';
const subs = (process.argv[3] ?? '1,2').split(',').map(Number);
const raw = jpeg.decode(readFileSync('tests/fixtures/sample-photo.jpg'), { useTArray: true, formatAsRGBA: true });
const { width, height } = analysisSize(raw.width, raw.height, 1024);
const data = new Uint8ClampedArray(width * height * 4);
for (let c = 0; c < 3; c++) {
  const p = new Float32Array(raw.width * raw.height);
  for (let i = 0; i < p.length; i++) p[i] = raw.data[i * 4 + c];
  const r = resizePlane(p, raw.width, raw.height, width, height);
  for (let i = 0; i < r.length; i++) data[i * 4 + c] = r[i];
}
for (let i = 0; i < width * height; i++) data[i * 4 + 3] = 255;
const img = { width, height, data };
ort.env.wasm.numThreads = 1;
const sess = await ort.InferenceSession.create(readFileSync(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const S = 320;
const backend = { name: 'bench', inputSize: S, run: async (x: Float32Array, s: number) => (await sess.run({ input: new ort.Tensor('float32', x, [1, 6, s, s]) })).logits.data as Float32Array };
const med = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
// CPU time per call (user + system) as well as wall time: on a shared machine wall time mostly measures the other jobs
const cpu: Record<string, number> = {};
let label = '';
const time = async (f: () => unknown, n = 5) => { await f(); const t: number[] = []; const c0 = process.cpuUsage(); for (let i = 0; i < n; i++) { const t0 = performance.now(); await f(); t.push(performance.now() - t0); } const c = process.cpuUsage(c0); cpu[label] = Math.round((c.user + c.system) / 1000 / n); return Math.round(med(t)); };
const T = async (k: string, f: () => unknown) => { label = k; out[k] = await time(f); };
const input = buildInput(img, [], null, S);
const logits = await backend.run(input, S);
const prob = logitsToProb(logits, S, width, height);
const out: Record<string, number | string> = { model, analysis: `${width}x${height}` };
await T('buildInput', () => buildInput(img, [], null, S));
await T('model_run', () => backend.run(input, S));
await T('logitsToProb', () => logitsToProb(logits, S, width, height));
for (const s of subs) await T(`matte_sub${s}`, () => refineMatte(img, prob, { modelScale: Math.max(width, height) / S, subsample: s }));
await T('selectSubject_total', () => selectSubject(img, { backend }));
console.log(JSON.stringify({ wall_ms: out, cpu_ms: cpu }));
