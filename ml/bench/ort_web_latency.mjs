// onnxruntime-web (WASM, same package + binary the app bundles) latency in Node.
//   node ml/bench/ort_web_latency.mjs <model.onnx> [sizes=320,384] [threads=1]
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
const [model, sizesArg = '320,384', thr = '1'] = process.argv.slice(2);
ort.env.wasm.numThreads = Number(thr);
const sess = await ort.InferenceSession.create(readFileSync(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const out = {};
for (const S of sizesArg.split(',').map(Number)) {
  const x = new Float32Array(6 * S * S).map(() => Math.random() - 0.5);
  x.fill(0, 3 * S * S);
  const t = new ort.Tensor('float32', x, [1, 6, S, S]);
  await sess.run({ input: t });
  const n = 5, t0 = performance.now();
  for (let i = 0; i < n; i++) await sess.run({ input: t });
  out[S] = Math.round((performance.now() - t0) / n);
}
console.log(JSON.stringify({ model, threads: Number(thr), ms: out }));
