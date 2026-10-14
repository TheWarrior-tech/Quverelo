import { useState } from 'react';
import { setStoryStyle, updateNodes } from '../../../core/commands';
import { solid } from '../../../core/document';
import type { Paint, SceneNode } from '../../../core/types';
import { editor } from '../../state/editor';
import { useEditor } from '../hooks';
import { PaintEditor } from '../ColorControls';

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

export function ColorPanel() {
  const ed = useEditor();
  const [target, setTarget] = useState<'fill' | 'stroke'>('fill');
  const nodes = ed.selectedNodes();
  const n = nodes[0];
  let paint: Paint;
  if (n) {
    if (target === 'fill') paint = nodeFill(n) ?? { type: 'none' };
    else paint = 'stroke' in n ? n.stroke.paint : { type: 'none' };
  } else {
    paint = target === 'fill' ? (ed.ui.fillEnabled ? solid(ed.ui.fillColor) : { type: 'none' }) : (ed.ui.strokeEnabled ? solid(ed.ui.strokeColor) : { type: 'none' });
  }
  const onChange = (p: Paint) => {
    if (p.type === 'solid') ed.setUi(target === 'fill' ? { fillColor: p.color, fillEnabled: true } : { strokeColor: p.color, strokeEnabled: true });
    if (p.type === 'none' && !n) ed.setUi(target === 'fill' ? { fillEnabled: false } : { strokeEnabled: false });
    if (n) {
      if (target === 'fill') applyFillToSelection(p, 'colour-fill');
      else applyStrokeToSelection(p, 'colour-stroke');
    }
  };
  return (
    <div>
      <div className="paint-tabs" role="radiogroup" aria-label="Colour target">
        <button className={`btn ${target === 'fill' ? 'selected' : ''}`} style={target === 'fill' ? { borderColor: 'var(--accent)' } : undefined} role="radio" aria-checked={target === 'fill'} onClick={() => setTarget('fill')}>Fill</button>
        <button className={`btn ${target === 'stroke' ? 'selected' : ''}`} style={target === 'stroke' ? { borderColor: 'var(--accent)' } : undefined} role="radio" aria-checked={target === 'stroke'} onClick={() => setTarget('stroke')}>Stroke</button>
      </div>
      <p style={{ margin: '0 0 6px', color: 'var(--text-faint)', fontSize: 12 }}>{n ? `Editing ${nodes.length > 1 ? `${nodes.length} objects` : n.name}` : 'Default colour for new objects'}</p>
      <PaintEditor paint={paint} onChange={onChange} allowNone={!(n?.type === 'text' && target === 'fill')} />
    </div>
  );
}
