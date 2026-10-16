/** Small colour helpers shared by the importers (PSD, PDF/AI, IDML). */

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

export function rgbHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** Naive (uncalibrated) CMYK 0..1 to sRGB. Good enough for import previews; colour-managed conversion lives with the colour specialist. */
export function cmykToHex(c: number, m: number, y: number, k: number): string {
  return rgbHex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));
}

export function grayHex(g: number): string {
  return rgbHex(g * 255, g * 255, g * 255);
}

/** CIE L*a*b* (D50) to sRGB hex. */
export function labToHex(L: number, a: number, b: number): string {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  // D50 white
  let X = 0.9642 * f(fx), Y = 1 * f(fy), Z = 0.8249 * f(fz);
  // Bradford D50 -> D65
  [X, Y, Z] = [
    0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z,
    -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z,
    0.0122982 * X - 0.020483 * Y + 1.3299098 * Z,
  ];
  const lin = [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
  const g = lin.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  return rgbHex(g[0] * 255, g[1] * 255, g[2] * 255);
}
