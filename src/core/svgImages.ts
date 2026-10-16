/**
 * How SVG export writes images: embedded as data: URIs (one self-contained
 * file) or linked to image files written next to the SVG; and whether an
 * image may be JPEG. JPEG is only used where lossy is fine: an image with
 * any transparency stays PNG (JPEG has no alpha), so "JPEG when opaque" never
 * changes how the artwork looks beyond compression.
 */
export type SvgImageMode = 'embed' | 'link';
export type SvgImageEncoding = 'png' | 'jpeg-opaque';

export interface SvgImageOptions {
  mode: SvgImageMode;
  encoding: SvgImageEncoding;
  /** JPEG quality 0..1 */
  quality: number;
}

export const DEFAULT_SVG_IMAGES: SvgImageOptions = { mode: 'embed', encoding: 'png', quality: 0.9 };

export function imageMime(hasAlpha: boolean, encoding: SvgImageEncoding): 'image/png' | 'image/jpeg' {
  return encoding === 'jpeg-opaque' && !hasAlpha ? 'image/jpeg' : 'image/png';
}

/** Whether RGBA pixel data has any pixel that is not fully opaque. */
export function hasTransparency(rgba: Uint8ClampedArray | Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
  return false;
}

/** "Poster.svg" (or a full path) → "Poster". */
export function svgBaseName(pathOrName: string): string {
  const file = pathOrName.split(/[\\/]/).pop() ?? pathOrName;
  return file.replace(/\.svg$/i, '') || 'Untitled';
}

/** The folder part of a path ("" for a bare name). */
export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i < 0 ? '' : path.slice(0, i);
}

/** File name for the n-th linked image of an SVG (1-based), safe on every OS. */
export function linkedImageName(svgBase: string, n: number, mime: string): string {
  const safe = svgBase.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim() || 'image';
  return `${safe} image ${n}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`;
}

/** Relative href for a linked image in the same folder as the SVG. */
export function linkedHref(fileName: string): string {
  return encodeURIComponent(fileName);
}
