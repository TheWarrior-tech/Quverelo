/** Types for the vendored lcms-wasm build (MIT, github.com/mattdesl/lcms-wasm) of Little CMS 2 (MIT). */
export interface LcmsModule {
  cmsOpenProfileFromMem(bytes: Uint8Array, size: number): number;
  cmsCloseProfile(h: number): void;
  cmsCreateLab4Profile(whitePoint: number[] | null): number;
  cmsGetProfileInfoASCII(h: number, info: number, lang: string, country: string): string;
  cmsGetColorSpaceASCII(h: number): string | null;
  cmsCreateTransform(input: number, inFmt: number, output: number, outFmt: number, intent: number, flags: number): number;
  cmsCreateProofingTransform(input: number, inFmt: number, output: number, outFmt: number, proof: number, intent: number, proofIntent: number, flags: number): number;
  cmsDeleteTransform(t: number): void;
  cmsDoTransform(t: number, input: ArrayLike<number>, size: number): Uint8Array | Uint16Array | Float32Array;
}
export function instantiate(opts?: { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (name: string) => string }): Promise<LcmsModule>;
