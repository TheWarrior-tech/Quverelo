/**
 * Colour maths for raw import: 3×3 matrices and the RGB spaces a raw file can
 * be developed into (matching the document profiles Quvrelo ships). Matrices
 * are RGB → XYZ for D65 white, as the DNG ColorMatrix tags are calibrated for.
 */
export type Mat3 = number[][];
export type RawTarget = 'srgb' | 'adobe-rgb' | 'display-p3';

export function mul3(a: Mat3, b: Mat3): Mat3 {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
}

export function invert3(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Colour matrix is not invertible');
  const k = 1 / det;
  return [
    [A * k, -(b * i - c * h) * k, (b * f - c * e) * k],
    [B * k, (a * i - c * g) * k, -(a * f - c * d) * k],
    [C * k, -(a * h - b * g) * k, (a * e - b * d) * k],
  ];
}

const srgbEncode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export interface RgbSpace {
  xyzFromRgb: Mat3;
  /** linear 0..1 → encoded 0..1 */
  encode: (v: number) => number;
}

export function rgbSpace(t: RawTarget): RgbSpace {
  switch (t) {
    case 'adobe-rgb':
      return {
        xyzFromRgb: [[0.5767309, 0.185554, 0.1881852], [0.2973769, 0.6273491, 0.0752741], [0.0270343, 0.0706872, 0.9911085]],
        encode: (v) => Math.pow(Math.max(0, v), 1 / 2.19921875),
      };
    case 'display-p3':
      return {
        xyzFromRgb: [[0.4865709, 0.2656677, 0.1982173], [0.2289746, 0.6917385, 0.0792869], [0, 0.0451134, 1.0439444]],
        encode: srgbEncode,
      };
    default:
      return {
        xyzFromRgb: [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]],
        encode: srgbEncode,
      };
  }
}
