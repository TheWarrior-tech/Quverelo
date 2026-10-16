/** Straighten (Crop tool): rotate the page content, then crop to the largest level rectangle inside it. */
import { straightenCrop } from '../../core/resample';
import { rotateContent } from '../engine/photoDoc';
import { editor } from './editor';
import { toast } from './bus';
import { getViewport } from './commands';
import { setCropBox } from './crop';

/** Rotate the content by `deg` (clockwise) and set the crop box to the largest straight rectangle inside it. */
export function straighten(deg: number): void {
  const doc = editor.doc;
  const c = editor.activeContainer;
  if (!doc || !c || !Number.isFinite(deg) || Math.abs(deg) < 0.01) return;
  editor.commit('Straighten', (d) => rotateContent(d, c.id, deg));
  const W = doc.settings.width;
  const H = doc.settings.height;
  const k = straightenCrop(W, H, deg);
  if (editor.ui.tool !== 'crop') editor.setTool('crop');
  setCropBox({ x: (W - k.w) / 2, y: (H - k.h) / 2, w: k.w, h: k.h });
  getViewport()?.drawOverlay();
  toast(`Straightened ${deg > 0 ? '+' : ''}${deg.toFixed(1)}° · Apply the crop to trim the corners`, 'info');
}

/** Angle (degrees, clockwise) that makes the line a -> b level or plumb, whichever is nearer. */
export function levelAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; // -180..180, y down
  // nearest of 0 / 90 / 180 / -90
  const k = Math.round(deg / 90);
  deg -= k * 90;
  return -deg;
}
