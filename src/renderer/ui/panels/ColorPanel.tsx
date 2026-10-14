import { useState } from 'react';
import { setStoryStyle, updateNodes } from '../../../core/commands';
import { solid } from '../../../core/document';
import type { Paint, SceneNode } from '../../../core/types';
import { editor } from '../../state/editor';
import { useEditor } from '../hooks';
import { PaintEditor } from '../ColorControls';
import { FillStrokeChips } from '../color/Chips';

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
  editor.setUi({ fillColor: u.strokeColor, strokeColor: u.fillColor, fillEnabled: u.strokeEnabled, strokeEnabled: u.fillEnabled });
  if (!u.selection.length) return;
  editor.commit('Swap fill and stroke', (d) => updateNodes(d, u.selection, (n) => {
    if (!('fill' in n) || !('stroke' in n) || n.type === 'textframe') return n;
    const fill = n.stroke.paint;
    const stroke = n.fill;
    const width = stroke.type !== 'none' && !n.stroke.width ? u.toolOptions.strokeWidth || 2 : n.stroke.width;
    return { ...n, fill, stroke: { ...n.stroke, paint: stroke, width } } as SceneNode;
  }));
}

const paintColor = (p: Paint | null, fallback: string) => (p && p.type === 'solid' ? p.color : p && (p.type === 'linear' || p.type === 'radial') ? p.stops[0]?.color ?? fallback : fallback);

export function ColorPanel() {
  const ed = useEditor();
  const [target, setTarget] = useState<'fill' | 'stroke'>('fill');
  const nodes = ed.selectedNodes();
  const n = nodes[0];
  const fillPaint: Paint = n ? nodeFill(n) ?? { type: 'none' } : ed.ui.fillEnabled ? solid(ed.ui.fillColor) : { type: 'none' };
  const strokePaint: Paint = n ? ('stroke' in n ? n.stroke.paint : { type: 'none' }) : ed.ui.strokeEnabled ? solid(ed.ui.strokeColor) : { type: 'none' };
  const paint = target === 'fill' ? fillPaint : strokePaint;
  const onChange = (p: Paint) => {
    if (p.type === 'solid') ed.setUi(target === 'fill' ? { fillColor: p.color, fillEnabled: true } : { strokeColor: p.color, strokeEnabled: true });
    if (p.type === 'none' && !n) ed.setUi(target === 'fill' ? { fillEnabled: false } : { strokeEnabled: false });
    if (n) {
      if (target === 'fill') applyFillToSelection(p, 'colour-fill');
      else applyStrokeToSelection(p, 'colour-stroke');
    }
  };
  return (
    <div className="colour-panel">
      <div className="colour-head">
        <FillStrokeChips
          fill={{ color: paintColor(fillPaint, ed.ui.fillColor), enabled: fillPaint.type !== 'none' }}
          stroke={{ color: paintColor(strokePaint, ed.ui.strokeColor), enabled: strokePaint.type !== 'none' }}
          target={target}
          onTarget={setTarget}
          onSwap={swapFillStroke}
        />
        <div className="colour-head-text">
          <span className="colour-target">{target === 'fill' ? 'Fill' : 'Stroke'}</span>
          <span className="hint">{n ? (nodes.length > 1 ? `${nodes.length} objects` : n.name) : 'Default for new objects'}</span>
        </div>
      </div>
      <PaintEditor paint={paint} onChange={onChange} allowNone={!(n?.type === 'text' && target === 'fill')} />
    </div>
  );
}
