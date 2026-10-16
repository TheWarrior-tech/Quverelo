/**
 * Off-main-thread adjustment rendering: applies an adjustment stack to an RGBA
 * buffer with the same pure code the main thread uses (core/pixels), so the
 * canvas stays responsive while a 24 MP image is filtered at full resolution.
 */
import { applyAdjustments } from '../../core/pixels';
import type { Adjustment } from '../../core/types';

interface Job { job: number; width: number; height: number; buf: ArrayBuffer; list: Adjustment[]; scale: number }

self.onmessage = (e: MessageEvent<Job>) => {
  const { job, width, height, buf, list, scale } = e.data;
  try {
    const out = applyAdjustments({ width, height, data: new Uint8ClampedArray(buf) }, list, scale);
    // applyAdjustments returns a fresh buffer per step; transfer it back without a copy
    const data = out.data.buffer === buf ? out.data.slice().buffer : out.data.buffer;
    (self as unknown as Worker).postMessage({ job, width: out.width, height: out.height, buf: data }, [data as ArrayBuffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ job, error: String((err as Error)?.message ?? err) });
  }
};
