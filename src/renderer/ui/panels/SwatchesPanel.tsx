import { addSwatch, removeSwatch } from '../../../core/commands';
import { solid } from '../../../core/document';
import { useEditor } from '../hooks';
import { applyFillToSelection, applyStrokeToSelection } from './ColorPanel';
import { Icon } from '../Icons';
import { Section } from '../controls/Panel';
import { sameRgb } from '../color/colorMath';
import { addRecentColour, useRecentColours } from '../color/recent';

const HINT = 'Click: fill · Shift-click: stroke · Right-click: remove';

export function SwatchesPanel() {
  const ed = useEditor();
  const doc = ed.doc!;
  const recent = useRecentColours();
  const pick = (color: string, e: React.MouseEvent) => {
    const stroke = e.shiftKey || e.altKey;
    if (stroke) ed.setUi({ strokeColor: color, strokeEnabled: true });
    else ed.setUi({ fillColor: color, fillEnabled: true });
    addRecentColour(color);
    if (ed.ui.selection.length) {
      if (stroke) applyStrokeToSelection(solid(color));
      else applyFillToSelection(solid(color));
    }
  };
  const current = ed.ui.fillEnabled ? ed.ui.fillColor : '';
  return (
    <div className="swatches-panel">
      <Section
        title={<>Document <span className="count num">{doc.swatches.length}</span></>}
        actions={<button className="icon-btn xs" aria-label="Add current fill colour as swatch" title="Add current fill colour" onClick={() => ed.commit('Add swatch', (d) => addSwatch(d, ed.ui.fillColor))}><Icon name="plus" size={16} /></button>}
      >
        <div className="swatches" role="listbox" aria-label="Swatches" title={HINT}>
          {doc.swatches.map((s) => {
            const on = !!current && sameRgb(s.color, current);
            return (
              <button
                key={s.id}
                className={`swatch${on ? ' on' : ''}`}
                style={{ ['--sw' as string]: s.color }}
                title={`${s.name} · ${HINT}`}
                aria-label={`Swatch ${s.name}`}
                aria-selected={on}
                role="option"
                onClick={(e) => pick(s.color, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  ed.commit('Remove swatch', (d) => removeSwatch(d, s.id));
                }}
              />
            );
          })}
        </div>
      </Section>
      {recent.length > 0 && (
        <Section title="Recent">
          <div className="swatches" role="listbox" aria-label="Recent colours">
            {recent.map((c) => (
              <button key={c} className="swatch" role="option" aria-selected={false} style={{ ['--sw' as string]: c }} title={`${c} · Click: fill · Shift-click: stroke`} aria-label={`Recent colour ${c}`} onClick={(e) => pick(c, e)} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
