/** Read and write a node's fill / stroke paint whatever kind of node it is (shape, text, compound, frame). */
import type { Paint, SceneNode } from './types';

export type PaintSlot = 'fill' | 'stroke';

export function getPaint(n: SceneNode, slot: PaintSlot): Paint | null {
  if (n.type === 'group') {
    if (!n.compound) return null;
    return slot === 'fill' ? n.compound.fill : n.compound.stroke.paint;
  }
  if (n.type === 'text') return slot === 'fill' ? n.style.fill : n.stroke.paint;
  if (n.type === 'raster') return null;
  return slot === 'fill' ? n.fill : n.stroke.paint;
}

export function setPaint(n: SceneNode, slot: PaintSlot, p: Paint): SceneNode {
  if (n.type === 'group') {
    if (!n.compound) return n;
    return { ...n, compound: slot === 'fill' ? { ...n.compound, fill: p } : { ...n.compound, stroke: { ...n.compound.stroke, paint: p, width: n.compound.stroke.width || 2 } } };
  }
  if (n.type === 'text') return slot === 'fill' ? { ...n, style: { ...n.style, fill: p } } : { ...n, stroke: { ...n.stroke, paint: p, width: n.stroke.width || 1 } };
  if (n.type === 'raster') return n;
  return slot === 'fill' ? ({ ...n, fill: p } as SceneNode) : ({ ...n, stroke: { ...n.stroke, paint: p, width: n.stroke.width || 2 } } as SceneNode);
}
