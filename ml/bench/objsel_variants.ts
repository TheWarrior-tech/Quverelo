// Object Select on the showcase cottage, per click, for each pipeline variant (coarse only / +focus / +refine / both).
//   npx vite-node ml/bench/objsel_variants.ts [model.onnx]
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import jpeg from 'jpeg-js';
import { analysisSize } from '../../src/core/ml/coords';
import { resizePlane } from '../../src/core/ml/tensor';
import { selectObject } from '../../src/core/ml/selectSubject';

const model = process.argv[2] ?? 'ml/models/quvselect_v1.onnx';
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
const k = width / raw.width;
// hand-traced cottage, full-resolution px (same polygon as tests/unit/mlObjectSelect.test.ts)
const COTTAGE_POLYGON: [number, number][] = [
  [964.2, 490], [981.7, 470], [981.7, 460.8], [985.8, 456.7], [990, 456.7], [992.5, 460.8], [992.5, 466.7],
  [1019.2, 469.2], [1020, 465], [1023.3, 459.2], [1026.7, 459.2], [1030, 465.8], [1030.8, 475.8],
  [1050, 495], [1050.8, 517.5], [1001.7, 521.7], [965, 511.7],
];
const poly = COTTAGE_POLYGON.map(([x, y]) => [x * k, y * k]);
const ref = new Uint8Array(width * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  let inside = false; const px = x + 0.5, py = y + 0.5;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside; }
  ref[y * width + x] = inside ? 1 : 0;
}
const iou = (m: Uint8Array) => { let a = 0, b = 0; for (let i = 0; i < m.length; i++) { if (m[i] && ref[i]) a++; if (m[i] || ref[i]) b++; } return a / b; };
ort.env.wasm.numThreads = 1;
const sess = await ort.InferenceSession.create(readFileSync(model), { executionProviders: ['wasm'] });
const backend = { name: 'b', inputSize: 320, run: async (x: Float32Array, s: number) => (await sess.run({ input: new ort.Tensor('float32', x, [1, 6, s, s]) })).logits.data as Float32Array };
const clicks = [[1005, 492], [1020, 500], [985, 500], [1040, 505], [1000, 478], [1035, 490], [975, 505]];
const variants: Record<string, object> = { coarse: { focus: false, refine: false }, focus: { refine: false }, refine: { focus: false }, both: {},
  ...Object.fromEntries((process.env.FS ?? '').split(',').filter(Boolean).map((s) => [`both_fs${s}`, { focusSize: Number(s) }])) };
for (const [name, o] of Object.entries(variants)) {
  const r: string[] = [];
  for (const [x, y] of clicks) r.push(iou((await selectObject(img, [{ x: x * k, y: y * k, positive: true }], { backend, ...o })).binary).toFixed(3));
  console.log(name.padEnd(10), r.join(' '));
}
