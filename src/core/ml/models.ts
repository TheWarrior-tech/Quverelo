/**
 * Which bundled QuvSelect model the app uses. Pure, unit-tested (tests/unit/mlModels.test.ts).
 *
 * ml/models/ can hold (see ml/MODEL_CARD.md):
 *   quvselect_v1.onnx       v1, fp32 (CI-downloaded release asset)  <- preferred: fastest in onnxruntime-web WASM
 *   quvselect_v1_int8.onnx  v1, int8 static QDQ (CI-downloaded release asset): 3.5x smaller, but slower on WASM,
 *                           whose int8 conv kernels are not as optimised as its fp32 ones (ml/MODEL_CARD.md)
 *   quvselect.onnx          v0, committed to git: the fallback when a build has no v1 asset
 */
export interface BundledModel {
  id: string;
  file: string;
  url: string;
  /** square model input the app runs Select Subject at */
  inputSize: number;
}

export const MODEL_PREFERENCE: readonly Omit<BundledModel, 'url'>[] = [
  { id: 'quvselect-v1', file: 'quvselect_v1.onnx', inputSize: 320 },
  { id: 'quvselect-v1-int8', file: 'quvselect_v1_int8.onnx', inputSize: 320 },
  { id: 'quvselect-v0', file: 'quvselect.onnx', inputSize: 320 },
];

/** Pick the best available model from a map of path -> url (an import.meta.glob result). */
export function pickModel(urls: Record<string, string>): BundledModel | null {
  const byFile = new Map(Object.entries(urls).map(([p, u]) => [p.split('/').pop()!, u]));
  for (const m of MODEL_PREFERENCE) {
    const url = byFile.get(m.file);
    if (url) return { ...m, url };
  }
  return null;
}
