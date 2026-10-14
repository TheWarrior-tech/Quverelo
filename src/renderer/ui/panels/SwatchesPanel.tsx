import { addSwatch, removeSwatch } from '../../../core/commands';
import { solid } from '../../../core/document';
import { useEditor } from '../hooks';
import { applyFillToSelection, applyStrokeToSelection } from './ColorPanel';
import { Icon } from '../Icons';

export function SwatchesPanel() {
  const ed = useEditor();
  const doc = ed.doc!;
  const pick = (color: string, e: React.MouseEvent) => {
    const stroke = e.shiftKey || e.altKey;
    if (stroke) ed.setUi({ strokeColor: color, strokeEnabled: true });
    else ed.setUi({ fillColor: color, fillEnabled: true });
    if (ed.ui.selection.length) {
      if (stroke) applyStrokeToSelection(solid(color));
      else applyFillToSelection(solid(color));
    }
  };
  return (
    <div>
      <div className="section-title">
        Document swatches
        <button className="icon-btn sm" aria-label="Add current fill colour as swatch" title="Add current colour" onClick={() => ed.commit('Add swatch', (d) => addSwatch(d, ed.ui.fillColor))}><Icon name="plus" /></button>
      </div>
      <div className="swatches" role="listbox" aria-label="Swatches">
        {doc.swatches.map((s) => (
          <button
            key={s.id}
            className="swatch"
            style={{ background: s.color }}
            title={`${s.name} — click: fill, Shift-click: stroke, right-click: remove`}
            aria-label={`Swatch ${s.name}`}
            role="option"
            onClick={(e) => pick(s.color, e)}
            onContextMenu={(e) => {
              e.preventDefault();
              ed.commit('Remove swatch', (d) => removeSwatch(d, s.id));
            }}
          />
        ))}
      </div>
      <p style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 8 }}>Click to fill · Shift-click for stroke · right-click to remove</p>
    </div>
  );
}
