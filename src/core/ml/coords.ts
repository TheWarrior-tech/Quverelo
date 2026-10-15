/**
 * Coordinate mapping for click-to-select, in one place so it can be unit-tested
 * (tests/unit/mlCoords.test.ts). The chain for one click is:
 *
 *   document (world) point
 *     -> layer (node units)          worldToPixelMatrix(doc, id)    (engine/pixelOps.ts)
 *     -> analysis pixel              scale(analysisW / node.w, analysisH / node.h)
 *     -> [focus crop pixel]          minus the crop origin            (cropRect below)
 *     -> model grid (S x S)          squash resize, align_corners=False, NO letterbox
 *
 * The model was trained on squash-resized images (ml/quvrelo_ml/data.py), so there is no
 * letterbox/pad offset anywhere in the chain: x and y scale independently.
 */
import { invert, multiply, scale, type Matrix } from '../geometry';

/** Size the image is analysed at: longest side capped at maxSide, never enlarged. */
export function analysisSize(srcW: number, srcH: number, maxSide: number): { width: number; height: number } {
  const k = Math.min(1, maxSide / Math.max(srcW, srcH));
  return { width: Math.max(1, Math.round(srcW * k)), height: Math.max(1, Math.round(srcH * k)) };
}

/** world -> analysis pixel and back, given the world -> node-units matrix of a raster layer. */
export function analysisTransform(worldToNode: Matrix, nodeW: number, nodeH: number, width: number, height: number): { toPixel: Matrix; toWorld: Matrix } {
  const toPixel = multiply(scale(width / nodeW, height / nodeH), worldToNode);
  return { toPixel, toWorld: invert(toPixel) };
}

/**
 * Image pixel coordinate (continuous, pixel (i, j) covers [i, i+1)) -> model grid coordinate
 * whose integer values are cell centres (numpy mgrid / align_corners=False convention).
 */
export function imageToModel(x: number, y: number, srcW: number, srcH: number, gw: number, gh = gw): { x: number; y: number } {
  return { x: ((x + 0.5) * gw) / srcW - 0.5, y: ((y + 0.5) * gh) / srcH - 0.5 };
}

export interface CropRect {
  x: number;
  y: number;
  /** square side in image pixels */
  side: number;
}

/**
 * A square crop of `side` px centred on (cx, cy), shifted so it stays inside the W x H image
 * (no padding is ever invented). Returns null when the square does not fit; callers then use the
 * whole image.
 */
export function cropRect(cx: number, cy: number, side: number, W: number, H: number): CropRect | null {
  side = Math.round(side);
  if (side < 1 || side > W || side > H) return null;
  const x = Math.min(W - side, Math.max(0, Math.round(cx - side / 2)));
  const y = Math.min(H - side, Math.max(0, Math.round(cy - side / 2)));
  return { x, y, side };
}
