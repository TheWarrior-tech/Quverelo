/**
 * ICC colour engine: Little CMS 2 (lcms2, MIT) compiled to WebAssembly.
 *
 * One engine per app run. It opens the bundled profiles (core/colour/profiles.ts),
 * caches transforms and converts single colours (swatches, picker fields, PDF
 * vector colours) and whole pixel buffers (PDF images, 16-bit photos), and builds
 * the 3D lookup tables the viewport uses for soft-proofing and the gamut warning.
 *
 * Pure apart from the wasm module, which comes in through `create` so the same
 * code runs in the renderer (bundled .wasm url) and in Node tests (file bytes).
 */
import type { LcmsModule } from '../../vendor/lcms/lcms';
import { INTENT_CODE, PROFILES, type CmykProfileId, type ProfileId, type RenderingIntent, type RgbProfileId } from './profiles';
import { buildLut, type Lut3D } from './lut3d';

const PT_RGB = 4;
const PT_CMYK = 6;
const PT_LAB = 10;
const FLAG_BPC = 0x2000;
/** lcms: don't optimise the pipeline into a reduced-precision cache (single colours) */
const FLAG_NOOPTIMIZE = 0x0100;

type Space = 'RGB' | 'CMYK' | 'Lab';
type Depth = 1 | 2 | 'float';

function fmt(space: Space, depth: Depth): number {
  const pt = space === 'RGB' ? PT_RGB : space === 'CMYK' ? PT_CMYK : PT_LAB;
  const ch = space === 'CMYK' ? 4 : 3;
  const bytes = depth === 'float' ? 4 : depth;
  return (depth === 'float' ? 1 << 22 : 0) | (pt << 16) | (ch << 3) | bytes;
}

export interface ConvertOptions {
  intent?: RenderingIntent;
  /** black point compensation (default on for perceptual and relative) */
  bpc?: boolean;
}

/** Pixels per lcms call: keeps the wasm heap small on 6000×4000 photos. */
const CHUNK = 1 << 18;

export class ColourEngine {
  private handles = new Map<string, number>();
  private transforms = new Map<string, number>();
  private lab = 0;

  constructor(private lcms: LcmsModule, private bytes: (id: ProfileId) => Uint8Array) {}

  /** Load the wasm and the profiles. `profile` returns a bundled profile's bytes. */
  static async create(opts: { profile: (id: ProfileId) => Promise<Uint8Array> | Uint8Array; instantiate: () => Promise<LcmsModule> }): Promise<ColourEngine> {
    const lcms = await opts.instantiate();
    const loaded = new Map<ProfileId, Uint8Array>();
    for (const id of Object.keys(PROFILES) as ProfileId[]) loaded.set(id, await opts.profile(id));
    return new ColourEngine(lcms, (id) => loaded.get(id)!);
  }

  /** The profile's bytes (for PDF OutputIntents and ICCBased colour spaces). */
  profileBytes(id: ProfileId): Uint8Array {
    return this.bytes(id);
  }

  /** The description stored in the profile itself. */
  profileDescription(id: ProfileId): string {
    return this.lcms.cmsGetProfileInfoASCII(this.handle(id), 0, 'en', 'US');
  }

  private handle(id: ProfileId | 'lab'): number {
    if (id === 'lab') {
      if (!this.lab) this.lab = this.lcms.cmsCreateLab4Profile(null);
      return this.lab;
    }
    let h = this.handles.get(id);
    if (!h) {
      const b = this.bytes(id);
      h = this.lcms.cmsOpenProfileFromMem(b, b.length);
      if (!h) throw new Error(`Could not open the ${PROFILES[id].name} profile`);
      this.handles.set(id, h);
    }
    return h;
  }

  private space(id: ProfileId | 'lab'): Space {
    return id === 'lab' ? 'Lab' : PROFILES[id].space;
  }

  private transform(from: ProfileId | 'lab', to: ProfileId | 'lab', inDepth: Depth, outDepth: Depth, o: ConvertOptions = {}, extraFlags = 0): number {
    const intent = o.intent ?? 'relative';
    const bpc = o.bpc ?? (intent === 'relative' || intent === 'perceptual');
    const key = `${from}>${to}|${inDepth}>${outDepth}|${intent}|${bpc}|${extraFlags}`;
    let t = this.transforms.get(key);
    if (!t) {
      t = this.lcms.cmsCreateTransform(
        this.handle(from), fmt(this.space(from), inDepth), this.handle(to), fmt(this.space(to), outDepth),
        INTENT_CODE[intent], (bpc ? FLAG_BPC : 0) | extraFlags,
      );
      if (!t) throw new Error(`No colour transform from ${from} to ${to}`);
      this.transforms.set(key, t);
    }
    return t;
  }

  private run<T extends Uint8Array | Uint16Array | Float32Array>(t: number, input: ArrayLike<number>, n: number, inCh: number, outCh: number, make: (len: number) => T): T {
    const out = make(n * outCh);
    for (let start = 0; start < n; start += CHUNK) {
      const count = Math.min(CHUNK, n - start);
      const slice = (input as Uint8Array).subarray
        ? (input as Uint8Array).subarray(start * inCh, (start + count) * inCh)
        : Array.prototype.slice.call(input, start * inCh, (start + count) * inCh);
      out.set(this.lcms.cmsDoTransform(t, slice, count) as unknown as ArrayLike<number>, start * outCh);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // single colours (0..1)

  /** One colour between two profiles, values 0..1 (Lab as L 0..100, a/b ±128). */
  convertColor(values: number[], from: ProfileId | 'lab', to: ProfileId | 'lab', o: ConvertOptions = {}): number[] {
    const outDepth: Depth = 'float';
    const t = this.transform(from, to, 'float', outDepth, o, FLAG_NOOPTIMIZE);
    // lcms float RGB/CMYK: RGB 0..1, CMYK 0..100; Lab L 0..100
    const inp = this.space(from) === 'CMYK' ? values.map((v) => v * 100) : values;
    const res = Array.from(this.lcms.cmsDoTransform(t, Float32Array.from(inp), 1));
    const sp = this.space(to);
    return sp === 'CMYK' ? res.map((v) => clamp01(v / 100)) : sp === 'RGB' ? res.map(clamp01) : res;
  }

  rgbToCmyk(rgb: [number, number, number], rgbId: RgbProfileId, cmykId: CmykProfileId, o?: ConvertOptions): [number, number, number, number] {
    return this.convertColor(rgb, rgbId, cmykId, o) as [number, number, number, number];
  }

  cmykToRgb(cmyk: [number, number, number, number], cmykId: CmykProfileId, rgbId: RgbProfileId, o: ConvertOptions = { intent: 'relative', bpc: false }): [number, number, number] {
    return this.convertColor(cmyk, cmykId, rgbId, o) as [number, number, number];
  }

  rgbToRgb(rgb: [number, number, number], from: RgbProfileId, to: RgbProfileId, o?: ConvertOptions): [number, number, number] {
    if (from === to) return rgb;
    return this.convertColor(rgb, from, to, o) as [number, number, number];
  }

  toLab(values: number[], from: ProfileId): [number, number, number] {
    return this.convertColor(values, from, 'lab', { intent: 'relative', bpc: false }) as [number, number, number];
  }

  /** Is this RGB colour outside the press gamut? (colorimetric round trip ΔE76 above `threshold`) */
  outOfGamut(rgb: [number, number, number], rgbId: RgbProfileId, cmykId: CmykProfileId, threshold = GAMUT_DE): boolean {
    const a = this.toLab(rgb, rgbId);
    const b = this.toLab(this.rgbToCmyk(rgb, rgbId, cmykId, { intent: 'relative', bpc: false }), cmykId);
    return deltaE(a, b) > threshold;
  }

  // -------------------------------------------------------------------------
  // pixel buffers

  /** RGBA (8-bit, straight alpha) → CMYK 8-bit; alpha is dropped (the caller keeps it as a soft mask). */
  rgbaToCmyk(rgba: Uint8Array | Uint8ClampedArray, n: number, rgbId: RgbProfileId, cmykId: CmykProfileId, o: ConvertOptions = { intent: 'perceptual' }): Uint8Array {
    const rgb = new Uint8Array(n * 3);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      rgb[i * 3] = rgba[j];
      rgb[i * 3 + 1] = rgba[j + 1];
      rgb[i * 3 + 2] = rgba[j + 2];
    }
    return this.run(this.transform(rgbId, cmykId, 1, 1, o), rgb, n, 3, 4, (l) => new Uint8Array(l));
  }

  /** RGBA 16-bit → CMYK 8-bit (16-bit photos keep their precision through the conversion). */
  rgba16ToCmyk(rgba: Uint16Array, n: number, rgbId: RgbProfileId, cmykId: CmykProfileId, o: ConvertOptions = { intent: 'perceptual' }): Uint8Array {
    const rgb = new Uint16Array(n * 3);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      rgb[i * 3] = rgba[j];
      rgb[i * 3 + 1] = rgba[j + 1];
      rgb[i * 3 + 2] = rgba[j + 2];
    }
    return this.run(this.transform(rgbId, cmykId, 2, 1, o), rgb, n, 3, 4, (l) => new Uint8Array(l));
  }

  /** Convert RGBA pixels between RGB profiles in place (8 or 16 bit). */
  convertRgbaInPlace(rgba: Uint8Array | Uint8ClampedArray | Uint16Array, n: number, from: RgbProfileId, to: RgbProfileId, o: ConvertOptions = { intent: 'relative' }): void {
    if (from === to) return;
    const sixteen = rgba instanceof Uint16Array;
    const rgb = sixteen ? new Uint16Array(n * 3) : new Uint8Array(n * 3);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      rgb[i * 3] = rgba[j];
      rgb[i * 3 + 1] = rgba[j + 1];
      rgb[i * 3 + 2] = rgba[j + 2];
    }
    const d: Depth = sixteen ? 2 : 1;
    const out = this.run(this.transform(from, to, d, d, o), rgb, n, 3, 3, (l) => (sixteen ? new Uint16Array(l) : new Uint8Array(l)));
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      rgba[j] = out[i * 3];
      rgba[j + 1] = out[i * 3 + 1];
      rgba[j + 2] = out[i * 3 + 2];
    }
  }

  // -------------------------------------------------------------------------
  // display lookup tables

  /**
   * Viewport lookup table: document RGB → monitor (sRGB), optionally through the
   * press (soft proof: RGB → CMYK → screen) and with out-of-gamut flags.
   */
  displayLut(o: { rgbProfile: RgbProfileId; cmykProfile: CmykProfileId; proof: boolean; gamut: boolean; intent?: RenderingIntent; size?: number }): Lut3D {
    const size = o.size ?? 33;
    const intent = o.intent ?? 'relative';
    return buildLut(size, (grid) => {
      const n = grid.length / 3;
      const g16 = new Uint16Array(grid.length);
      for (let i = 0; i < grid.length; i++) g16[i] = Math.round(grid[i] * 65535);
      let rgbOut: Uint16Array;
      if (o.proof) {
        const cmyk = this.run(this.transform(o.rgbProfile, o.cmykProfile, 2, 2, { intent }), g16, n, 3, 4, (l) => new Uint16Array(l));
        // the press colour as the screen shows it: relative colorimetric, paper white as monitor white
        rgbOut = this.run(this.transform(o.cmykProfile, 'srgb', 2, 2, { intent: 'relative', bpc: false }), cmyk, n, 4, 3, (l) => new Uint16Array(l));
      } else if (o.rgbProfile !== 'srgb') {
        rgbOut = this.run(this.transform(o.rgbProfile, 'srgb', 2, 2, { intent: 'relative' }), g16, n, 3, 3, (l) => new Uint16Array(l));
      } else {
        rgbOut = g16;
      }
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(rgbOut[i] / 257);
      let flags: Uint8Array | undefined;
      if (o.gamut) {
        const labA = this.run(this.transform(o.rgbProfile, 'lab', 2, 'float', { intent: 'relative', bpc: false }), g16, n, 3, 3, (l) => new Float32Array(l));
        const cm = this.run(this.transform(o.rgbProfile, o.cmykProfile, 2, 2, { intent: 'relative', bpc: false }), g16, n, 3, 4, (l) => new Uint16Array(l));
        const labB = this.run(this.transform(o.cmykProfile, 'lab', 2, 'float', { intent: 'relative', bpc: false }), cm, n, 4, 3, (l) => new Float32Array(l));
        flags = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          const k = i * 3;
          flags[i] = deltaE([labA[k], labA[k + 1], labA[k + 2]], [labB[k], labB[k + 1], labB[k + 2]]) > GAMUT_DE ? 255 : 0;
        }
      }
      return { rgb, flags };
    });
  }

  dispose(): void {
    for (const t of this.transforms.values()) this.lcms.cmsDeleteTransform(t);
    for (const h of this.handles.values()) this.lcms.cmsCloseProfile(h);
    if (this.lab) this.lcms.cmsCloseProfile(this.lab);
    this.transforms.clear();
    this.handles.clear();
    this.lab = 0;
  }
}

/** Round-trip difference above which a colour counts as out of the press gamut (ΔE76). */
export const GAMUT_DE = 4;

export function deltaE(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
