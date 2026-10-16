/**
 * Default paints for new objects (tool rail chips, context bar, inspector
 * "New objects"). The UI keeps a flat colour per target for the brush, flood
 * fill and swatches, plus an optional gradient; these helpers read and write the
 * pair as one `Paint` so every colour chip can share the same paint editor.
 */
import type { Paint } from '../../core/types';
import type { UiState } from './editor';

export type PaintTarget = 'fill' | 'stroke';

type UiPaintFields = Pick<UiState, 'fillColor' | 'fillEnabled' | 'fillGradient' | 'strokeColor' | 'strokeEnabled' | 'strokeGradient'>;

export function firstColorOf(p: Paint, fallback: string): string {
  return p.type === 'solid' ? p.color : p.type === 'none' ? fallback : p.stops[0]?.color ?? fallback;
}

/** The default paint for new objects on one target. */
export function uiPaint(ui: UiPaintFields, t: PaintTarget): Paint {
  const enabled = t === 'fill' ? ui.fillEnabled : ui.strokeEnabled;
  if (!enabled) return { type: 'none' };
  const grad = t === 'fill' ? ui.fillGradient : ui.strokeGradient;
  if (grad && (grad.type === 'linear' || grad.type === 'radial' || grad.type === 'conical')) return grad;
  return { type: 'solid', color: t === 'fill' ? ui.fillColor : ui.strokeColor };
}

/** UI patch that makes `p` the default paint for one target. The flat colour follows the paint's first colour. */
export function uiPaintPatch(t: PaintTarget, p: Paint, current: UiPaintFields): Partial<UiPaintFields> {
  const color = firstColorOf(p, t === 'fill' ? current.fillColor : current.strokeColor);
  const grad = p.type === 'linear' || p.type === 'radial' || p.type === 'conical' ? p : null;
  const enabled = p.type !== 'none';
  return t === 'fill'
    ? { fillColor: color, fillEnabled: enabled, fillGradient: enabled ? grad : current.fillGradient }
    : { strokeColor: color, strokeEnabled: enabled, strokeGradient: enabled ? grad : current.strokeGradient };
}
