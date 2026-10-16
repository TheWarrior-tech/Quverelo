/** Statistics for a 256-bin histogram channel (Histogram panel). */
export interface HistStats {
  pixels: number;
  mean: number;
  stdDev: number;
  median: number;
  min: number;
  max: number;
  /** share (0..1) of pixels at 0 / 255: clipped shadows and highlights */
  clippedShadows: number;
  clippedHighlights: number;
}

export function histStats(bins: ArrayLike<number>): HistStats {
  let n = 0, sum = 0, sq = 0, min = -1, max = -1;
  for (let i = 0; i < 256; i++) {
    const c = bins[i] ?? 0;
    if (!c) continue;
    if (min < 0) min = i;
    max = i;
    n += c;
    sum += c * i;
    sq += c * i * i;
  }
  if (!n) return { pixels: 0, mean: 0, stdDev: 0, median: 0, min: 0, max: 0, clippedShadows: 0, clippedHighlights: 0 };
  const mean = sum / n;
  let acc = 0, median = 0;
  for (let i = 0; i < 256; i++) {
    acc += bins[i] ?? 0;
    if (acc >= n / 2) {
      median = i;
      break;
    }
  }
  return {
    pixels: n,
    mean,
    stdDev: Math.sqrt(Math.max(0, sq / n - mean * mean)),
    median,
    min,
    max,
    clippedShadows: (bins[0] ?? 0) / n,
    clippedHighlights: (bins[255] ?? 0) / n,
  };
}

/** Pixels whose value lies in [from, to] (inclusive), as a share of all pixels. */
export function rangeShare(bins: ArrayLike<number>, from: number, to: number): number {
  let n = 0, k = 0;
  for (let i = 0; i < 256; i++) {
    const c = bins[i] ?? 0;
    n += c;
    if (i >= from && i <= to) k += c;
  }
  return n ? k / n : 0;
}
