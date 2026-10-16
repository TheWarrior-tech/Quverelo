import { addSwatch, removeSwatch } from '../../../core/commands';
import { solid } from '../../../core/document';
import { useEditor } from '../hooks';
import { applyFillToSelection, applyStrokeToSelection } from './ColorPanel';
import { Icon } from '../Icons';
import { Section } from '../controls/Panel';
import { sameRgb } from '../color/colorMath';
import { addRecentColour, useRecentColours } from '../color/recent';
import { paintUsesSwatch, swatchDetail, swatchPaint } from '../../../core/colour/swatches';
import { openDialog } from '../../state/bus';
import type { Paint, Swatch } from '../../../core/types';

const HINT = 'Click: fill · Shift-click: stroke · Right-click: remove';

export function SwatchesPanel() {
  const ed = useEditor();
  const doc = ed.doc!;
  const recent = useRecentColours();
  const pick = (color: string, e: React.MouseEvent, paint: Paint = solid(color)) => {
    const stroke = e.shiftKey || e.altKey;
    if (stroke) ed.setUi({ strokeColor: color, strokeEnabled: true });
    else ed.setUi({ fillColor: color, fillEnabled: true });
    addRecentColour(color);
    if (ed.ui.selection.length) {
      if (stroke) applyStrokeToSelection(paint);
      else applyFillToSelection(paint);
    }
  };
  const current = ed.ui.fillEnabled ? ed.ui.fillColor : '';
  // the selection's fill, for CMYK and spot swatches (their preview colour alone can't tell)
  const selFill = ((): Paint | null => {
    const n = ed.selectedNodes()[0];
    if (!n) return null;
    if (n.type === 'text') return n.style.fill;
    return 'fill' in n ? n.fill : null;
  })();
  const isOn = (s: Swatch) => (s.cmyk ? paintUsesSwatch(selFill, s) : !!current && sameRgb(s.color, current));
  return (
    <div className="swatches-panel">
      <Section
        title={<>Document <span className="count num">{doc.swatches.length}</span></>}
        actions={<>
          <button className="icon-btn xs" aria-label="New CMYK or spot colour" data-tip="New CMYK or spot colour…" data-testid="swatch-new-cmyk" onClick={() => openDialog('swatch', { kind: 'cmyk' })}><Icon name="swatch" size={16} /></button>
          <button className="icon-btn xs" aria-label="Add current fill colour as swatch" data-tip="Add current fill colour" onClick={() => ed.commit('Add swatch', (d) => addSwatch(d, ed.ui.fillColor))}><Icon name="plus" size={16} /></button>
        </>}
      >
        <div className="swatches" role="listbox" aria-label="Swatches" data-tip={HINT}>
          {doc.swatches.map((s) => {
            const on = isOn(s);
            const kind = s.spot ? ' spot' : s.cmyk ? ' cmyk' : '';
            const detail = s.cmyk ? ` · ${swatchDetail(s)}` : '';
            return (
              <button
                key={s.id}
                className={`swatch${kind}${on ? ' on' : ''}`}
                style={{ ['--sw' as string]: s.color }}
                data-tip={`${s.name}${detail} · ${HINT}`}
                aria-label={`Swatch ${s.name}${detail}`}
                aria-selected={on}
                data-swatch-kind={s.spot ? 'spot' : s.cmyk ? 'cmyk' : 'rgb'}
                role="option"
                onClick={(e) => pick(s.color, e, swatchPaint(s))}
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
              <button key={c} className="swatch" role="option" aria-selected={false} style={{ ['--sw' as string]: c }} data-tip={`${c} · Click: fill · Shift-click: stroke`} aria-label={`Recent colour ${c}`} onClick={(e) => pick(c, e)} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
