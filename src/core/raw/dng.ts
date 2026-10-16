/**
 * DNG (Adobe Digital Negative) raw import.
 *
 * TIFF structure and decompression (uncompressed, lossless JPEG, deflate…)
 * come from UTIF.js (MIT, bundled). Everything after that is ours, following
 * the DNG 1.6 specification:
 *
 *   unpack samples (8/10/12/14/16-bit) → LinearizationTable → subtract
 *   BlackLevel (with BlackLevelRepeatDim and the per-row/column deltas) and
 *   scale by WhiteLevel → crop to ActiveArea and DefaultCrop → white balance
 *   from AsShotNeutral (or AsShotWhiteXY) → demosaic (Malvar–He–Cutler for
 *   Bayer, generic for other CFA patterns; LinearRaw files are already RGB)
 *   → camera to the document's RGB space through ColorMatrix (with
 *   CameraCalibration), rows normalised so a neutral stays neutral →
 *   BaselineExposure → transfer curve → 16 bits per channel → Orientation.
 *
 * Proprietary raw formats (Canon CR2/CR3, Nikon NEF, Sony ARW, …) are not
 * read: their decoders in the open-source world (LibRaw, rawspeed) are LGPL,
 * which this MIT app does not link, and the formats are undocumented. Adobe's
 * free DNG Converter turns any of them into a DNG this importer reads.
 *
 * Pure and DOM-free; tested on generated DNGs and on CC0 samples from
 * raw.pixls.us (tests/unit/raw.test.ts).
 */
import UTIF, { type IFD } from 'utif';
import type { Pixels16 } from '../pixels16';
import { cfaColourFn, demosaicGeneric, demosaicMalvar, isBayer, type CfaPattern } from './demosaic';
import { invert3, mul3, rgbSpace, type Mat3, type RawTarget } from './rawColour';

export interface DngInfo {
  make: string;
  model: string;
  /** output size after crop and orientation */
  width: number;
  height: number;
  bitsPerSample: number;
  compression: number;
  /** 'RGGB', 'BGGR'… for Bayer, 'CFA nxm' for other patterns, 'LinearRaw' for demosaiced DNGs */
  cfa: string;
  demosaic: 'malvar' | 'generic' | 'none';
  blackLevel: number;
  whiteLevel: number;
  /** white balance multipliers applied (green = 1) */
  wb: [number, number, number];
  /** true when the file had a ColorMatrix (otherwise camera RGB is taken as is) */
  colourMatrix: boolean;
  baselineExposure: number;
  orientation: number;
}

export function isDng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0;
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42;
  return le || be;
}

const num = (ifd: IFD | undefined, tag: number, i = 0): number | undefined => {
  const v = ifd?.[`t${tag}`] as ArrayLike<number> | undefined;
  return v && v.length > i ? Number(v[i]) : undefined;
};
const arr = (ifd: IFD | undefined, tag: number): number[] | undefined => {
  const v = ifd?.[`t${tag}`] as ArrayLike<number> | undefined;
  return v ? Array.from(v, Number) : undefined;
};
const str = (ifd: IFD | undefined, tag: number): string => {
  const v = ifd?.[`t${tag}`];
  return v && typeof v[0] === 'string' ? (v[0] as string).trim() : '';
};

const PHOTOMETRIC_CFA = 32803;
const PHOTOMETRIC_LINEAR_RAW = 34892;

function allIfds(ifds: IFD[]): IFD[] {
  const out: IFD[] = [];
  const walk = (list: IFD[]) => {
    for (const f of list) {
      out.push(f);
      if (f.subIFD) walk(f.subIFD);
    }
  };
  walk(ifds);
  return out;
}

/** The full-resolution raw IFD: NewSubfileType 0 with CFA or LinearRaw data, the largest one. */
function rawIfd(ifds: IFD[]): IFD | null {
  const cands = allIfds(ifds).filter((f) => {
    const sub = num(f, 254) ?? 0;
    const ph = num(f, 262);
    return (sub & 1) === 0 && (ph === PHOTOMETRIC_CFA || ph === PHOTOMETRIC_LINEAR_RAW);
  });
  cands.sort((a, b) => (num(b, 256) ?? 0) * (num(b, 257) ?? 0) - (num(a, 256) ?? 0) * (num(a, 257) ?? 0));
  return cands[0] ?? null;
}

/** Unpack decoded strip/tile bytes to one Uint16 per sample. */
export function unpackSamples(bytes: Uint8Array, count: number, perRow: number, bps: number, littleEndian: boolean): Uint16Array {
  const out = new Uint16Array(count);
  if (bps === 16) {
    for (let i = 0; i < count; i++) out[i] = littleEndian ? bytes[2 * i] | (bytes[2 * i + 1] << 8) : (bytes[2 * i] << 8) | bytes[2 * i + 1];
    return out;
  }
  if (bps === 8) {
    out.set(bytes.subarray(0, count));
    return out;
  }
  // DNG / TIFF bit packing: most significant bit first, each row starts on a byte boundary
  const rowBytes = Math.ceil((perRow * bps) / 8);
  const rows = Math.ceil(count / perRow);
  for (let r = 0; r < rows; r++) {
    let bit = r * rowBytes * 8;
    const n = Math.min(perRow, count - r * perRow);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let k = 0; k < bps; k++, bit++) v = (v << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
      out[r * perRow + i] = v;
    }
  }
  return out;
}

/** CIE xy chromaticity to XYZ with Y = 1. */
function xyToXYZ(x: number, y: number): [number, number, number] {
  return [x / y, 1, (1 - x - y) / y];
}

function mat3(v: number[] | undefined): Mat3 | null {
  if (!v || v.length < 9) return null;
  return [[v[0], v[1], v[2]], [v[3], v[4], v[5]], [v[6], v[7], v[8]]];
}

/** ColorMatrix for the illuminant nearest daylight (D65/D55/D50/daylight/flash), with its CameraCalibration applied. */
function chooseMatrix(ifd0: IFD): Mat3 | null {
  const m1 = mat3(arr(ifd0, 50721));
  const m2 = mat3(arr(ifd0, 50722));
  const daylight = new Set([1, 4, 9, 20, 21, 22, 23]); // daylight, flash, fine weather, D55, D65, D75, D50
  const il1 = num(ifd0, 50778) ?? 0;
  const il2 = num(ifd0, 50779) ?? 0;
  // the second matrix when it is the daylight one, or when neither is (DNG orders them by colour temperature)
  const useSecond = !!m2 && (!m1 || daylight.has(il2) || !daylight.has(il1));
  const cm = useSecond ? m2 : m1;
  const cc = mat3(arr(ifd0, useSecond ? 50724 : 50723));
  if (!cm) return null;
  return cc ? mul3(cc, cm) : cm;
}

export interface DngDecodeOptions {
  /** output RGB space (the document's); default sRGB */
  target?: RawTarget;
}

export function decodeDng(bytes: Uint8Array, opts: DngDecodeOptions = {}): { image: Pixels16; info: DngInfo } {
  if (!isDng(bytes)) throw new Error('Not a DNG / TIFF file');
  const buf = bytes.slice().buffer as ArrayBuffer;
  const ifds = UTIF.decode(buf);
  const ifd0 = ifds[0];
  if (!ifd0 || num(ifd0, 50706) === undefined) throw new Error('This TIFF is not a DNG (no DNGVersion tag)');
  const raw = rawIfd(ifds);
  if (!raw) throw new Error('This DNG has no raw image data Quvrelo can read');
  UTIF.decodeImage(buf, raw, ifds);
  const W = raw.width ?? num(raw, 256)!;
  const H = raw.height ?? num(raw, 257)!;
  const spp = num(raw, 277) ?? 1;
  const bps = num(raw, 258) ?? 16;
  const compression = num(raw, 259) ?? 1;
  const photometric = num(raw, 262)!;
  if (!raw.data || !raw.data.length) throw new Error(`Unsupported DNG compression (${compression})`);
  if (compression === 34892 || (compression === 7 && bps === 8 && photometric === PHOTOMETRIC_LINEAR_RAW)) {
    throw new Error('Lossy-compressed DNG is not supported yet; export an uncompressed or lossless DNG');
  }
  const littleEndian = raw.isLE ?? true;
  const samples = unpackSamples(raw.data, W * H * spp, W * spp, bps, littleEndian);

  // linearisation, black and white levels
  const lin = arr(raw, 50712);
  const white = num(raw, 50717) ?? (1 << bps) - 1;
  const blRep = arr(raw, 50713) ?? [1, 1];
  const blRows = Math.max(1, blRep[0]);
  const blCols = Math.max(1, blRep[1] ?? 1);
  const bl = arr(raw, 50714) ?? [0];
  const blDeltaH = arr(raw, 50715); // per column
  const blDeltaV = arr(raw, 50716); // per row
  const blAt = (x: number, y: number, s: number) => {
    const idx = ((y % blRows) * blCols + (x % blCols)) * (bl.length >= blRows * blCols * spp ? spp : 1) + (bl.length >= blRows * blCols * spp ? s : 0);
    return (bl[idx] ?? bl[0] ?? 0) + (blDeltaH?.[x] ?? 0) + (blDeltaV?.[y] ?? 0);
  };
  const blackMean = bl.reduce((a, b) => a + b, 0) / bl.length;

  // crop: ActiveArea (top, left, bottom, right), then DefaultCrop inside it
  const aa = arr(raw, 50829) ?? [0, 0, H, W];
  const aTop = aa[0], aLeft = aa[1];
  const aW = aa[3] - aa[1], aH = aa[2] - aa[0];
  const dco = arr(raw, 50719) ?? [0, 0];
  const dcs = arr(raw, 50720) ?? [aW, aH];
  const cropX = aLeft + Math.round(dco[0]);
  const cropY = aTop + Math.round(dco[1]);
  const w = Math.max(1, Math.min(W - cropX, Math.round(dcs[0])));
  const h = Math.max(1, Math.min(H - cropY, Math.round(dcs[1])));

  // white balance: camera neutral → multipliers
  const ifdColour = ifd0;
  const cm = chooseMatrix(ifdColour);
  const target = rgbSpace(opts.target ?? 'srgb');
  let neutral = arr(ifdColour, 50728);
  const whiteXY = arr(ifdColour, 50729);
  if ((!neutral || neutral.length < 3) && whiteXY && cm) {
    const xyz = xyToXYZ(whiteXY[0], whiteXY[1]);
    neutral = [0, 1, 2].map((r) => cm[r][0] * xyz[0] + cm[r][1] * xyz[1] + cm[r][2] * xyz[2]);
  }
  let wb: [number, number, number] = [1, 1, 1];
  if (neutral && neutral.length >= 3 && neutral.every((v) => v > 0)) {
    wb = [1 / neutral[0], 1 / neutral[1], 1 / neutral[2]];
    wb = [wb[0] / wb[1], 1, wb[2] / wb[1]];
  }

  // camera → target RGB (dcraw's approach: camera←XYZ←RGB, rows normalised, inverted)
  let rgbCam: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (cm) {
    const camRgb = mul3(cm, target.xyzFromRgb);
    for (const row of camRgb) {
      const s = row[0] + row[1] + row[2];
      if (Math.abs(s) > 1e-9) for (let k = 0; k < 3; k++) row[k] /= s;
    }
    rgbCam = invert3(camRgb);
  }
  const baselineExposure = num(ifd0, 50730) ?? 0;
  const gain = Math.pow(2, baselineExposure);
  const curve = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) curve[i] = Math.round(target.encode(i / 65535) * 65535);

  const out = new Uint16Array(w * h * 4);
  const scale = (x: number, y: number, s: number, v: number) => {
    const lv = lin ? lin[Math.min(lin.length - 1, v)] : v;
    const b = blAt(x, y, s);
    return (lv - b) / Math.max(1, white - b);
  };
  const emit = (i: number, r: number, g: number, b: number) => {
    const o = i * 4;
    const R = (rgbCam[0][0] * r + rgbCam[0][1] * g + rgbCam[0][2] * b) * gain;
    const G = (rgbCam[1][0] * r + rgbCam[1][1] * g + rgbCam[1][2] * b) * gain;
    const B = (rgbCam[2][0] * r + rgbCam[2][1] * g + rgbCam[2][2] * b) * gain;
    out[o] = curve[R <= 0 ? 0 : R >= 1 ? 65535 : Math.round(R * 65535)];
    out[o + 1] = curve[G <= 0 ? 0 : G >= 1 ? 65535 : Math.round(G * 65535)];
    out[o + 2] = curve[B <= 0 ? 0 : B >= 1 ? 65535 : Math.round(B * 65535)];
    out[o + 3] = 65535;
  };

  let cfaName: string;
  let demosaic: DngInfo['demosaic'];
  if (photometric === PHOTOMETRIC_LINEAR_RAW) {
    if (spp < 3) throw new Error('LinearRaw DNG with fewer than three channels is not supported');
    cfaName = 'LinearRaw';
    demosaic = 'none';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x + cropX, sy = y + cropY;
        const base = (sy * W + sx) * spp;
        const c = [0, 1, 2].map((s) => Math.min(1, Math.max(0, scale(sx, sy, s, samples[base + s]) * wb[s])));
        emit(y * w + x, c[0], c[1], c[2]);
      }
    }
  } else {
    const dim = arr(raw, 33421) ?? arr(ifd0, 33421) ?? [2, 2];
    const pat = arr(raw, 33422) ?? arr(ifd0, 33422) ?? [0, 1, 1, 2];
    const planes = arr(raw, 50710) ?? [0, 1, 2];
    const pattern: CfaPattern = { rows: dim[0], cols: dim[1], cells: pat.slice(0, dim[0] * dim[1]).map((v) => Math.max(0, planes.indexOf(v))) };
    const colour = cfaColourFn(pattern, cropX % pattern.cols, cropY % pattern.rows);
    const mosaic = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x + cropX, sy = y + cropY;
        const v = scale(sx, sy, 0, samples[sy * W + sx]);
        // highlight clip after white balance (keeps blown skies white, not pink)
        mosaic[y * w + x] = Math.min(1, Math.max(0, v * wb[colour(x, y)]));
      }
    }
    const letters = 'RGB';
    if (isBayer(pattern)) {
      cfaName = [colour(0, 0), colour(1, 0), colour(0, 1), colour(1, 1)].map((c) => letters[c]).join('');
      demosaic = 'malvar';
      demosaicMalvar(mosaic, w, h, colour, emit);
    } else {
      cfaName = `CFA ${pattern.rows}x${pattern.cols}`;
      demosaic = 'generic';
      demosaicGeneric(mosaic, w, h, colour, emit);
    }
  }

  const orientation = num(ifd0, 274) ?? 1;
  const image = orient({ width: w, height: h, data: out }, orientation);
  return {
    image,
    info: {
      make: str(ifd0, 271),
      model: str(ifd0, 50708) || str(ifd0, 272),
      width: image.width,
      height: image.height,
      bitsPerSample: bps,
      compression,
      cfa: cfaName,
      demosaic,
      blackLevel: blackMean,
      whiteLevel: white,
      wb,
      colourMatrix: !!cm,
      baselineExposure,
      orientation,
    },
  };
}

/** Apply a TIFF Orientation (1..8) to an RGBA16 image. */
export function orient(p: Pixels16, o: number): Pixels16 {
  if (o <= 1 || o > 8) return p;
  const swap = o >= 5;
  const W = swap ? p.height : p.width;
  const H = swap ? p.width : p.height;
  const out = new Uint16Array(p.data.length);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      let nx: number, ny: number;
      switch (o) {
        case 2: nx = p.width - 1 - x; ny = y; break;
        case 3: nx = p.width - 1 - x; ny = p.height - 1 - y; break;
        case 4: nx = x; ny = p.height - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = p.height - 1 - y; ny = x; break;
        case 7: nx = p.height - 1 - y; ny = p.width - 1 - x; break;
        default: nx = y; ny = p.width - 1 - x; break; // 8
      }
      const s = (y * p.width + x) * 4;
      const d = (ny * W + nx) * 4;
      out[d] = p.data[s];
      out[d + 1] = p.data[s + 1];
      out[d + 2] = p.data[s + 2];
      out[d + 3] = p.data[s + 3];
    }
  }
  return { width: W, height: H, data: out };
}
