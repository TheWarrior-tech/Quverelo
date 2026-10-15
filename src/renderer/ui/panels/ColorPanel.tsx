import { setStoryStyle, updateNodes } from '../../../core/commands';
import type { Paint, SceneNode } from '../../../core/types';
import { editor } from '../../state/editor';

/** Read the fill paint of a node (text colour for text). */
export function nodeFill(n: SceneNode): Paint | null {
  if (n.type === 'text') return n.style.fill;
  if (n.type === 'textframe') return editor.doc?.stories[n.storyId]?.style.fill ?? null;
  if ('fill' in n) return n.fill;
  return null;
}

/** Apply a fill colour to the current selection (shapes, text, frames). */
export function applyFillToSelection(p: Paint, merge?: string): void {
  const nodes = editor.selectedNodes();
  editor.commit('Fill', (d) => {
    let out = updateNodes(d, editor.ui.selection, (n) => {
      if (n.type === 'text') return { ...n, style: { ...n.style, fill: p } };
      if (n.type === 'textframe' || n.type === 'raster' || n.type === 'group') return n;
      if ('fill' in n) return { ...n, fill: p } as SceneNode;
      return n;
    });
    for (const n of nodes) if (n.type === 'textframe') out = setStoryStyle(out, n.storyId, { fill: p });
    return out;
  }, merge);
}

export function applyStrokeToSelection(p: Paint, merge?: string): void {
  editor.commit('Stroke', (d) => updateNodes(d, editor.ui.selection, (n) => {
    if (!('stroke' in n)) return n;
    const width = n.stroke.width || (p.type === 'none' ? 0 : editor.ui.toolOptions.strokeWidth || 2);
    return { ...n, stroke: { ...n.stroke, paint: p, width } } as SceneNode;
  }), merge);
}

/** Exchange fill and stroke: the defaults for new objects, and the paints of selected shapes. */
export function swapFillStroke(): void {
  const u = editor.ui;
  editor.setUi({ fillColor: u.strokeColor, strokeColor: u.fillColor, fillEnabled: u.strokeEnabled, strokeEnabled: u.fillEnabled, fillGradient: u.strokeGradient, strokeGradient: u.fillGradient });
  if (!u.selection.length) return;
  editor.commit('Swap fill and stroke', (d) => updateNodes(d, u.selection, (n) => {
    if (!('fill' in n) || !('stroke' in n) || n.type === 'textframe') return n;
    const fill = n.stroke.paint;
    const stroke = n.fill;
    const width = stroke.type !== 'none' && !n.stroke.width ? u.toolOptions.strokeWidth || 2 : n.stroke.width;
    return { ...n, fill, stroke: { ...n.stroke, paint: stroke, width } } as SceneNode;
  }));
}
