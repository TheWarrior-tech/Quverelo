/**
 * Inspector › Text (CRITIQUE-4 N11): the full, persistent home for type, as in
 * Figma's Text section and Affinity's Character/Paragraph panels. Font (full
 * width) · Style + Size · Leading + Tracking · Alignment, then "More type
 * options" for underline and the OpenType basics (kerning, capitals).
 *
 * The context bar keeps one quick set (font · size · B I U · align); the
 * floating selection toolbar carries no text controls (DESIGN.md §8).
 */
import { useState } from 'react';
import type { TextAlign, TextCaps, TextStyle } from '../../../core/types';
import { activeTextTarget } from '../ContextBar';
import { primaryFamily } from '../fonts';
import { FontPicker } from '../controls/FontPicker';
import { NumberField } from '../controls/NumberField';
import { Section } from '../controls/Panel';
import { Segmented } from '../controls/Segmented';
import { Icon } from '../Icons';
import { useEditor } from '../hooks';
import { OpenTypeOptions, ParagraphOptions, StylePickers } from './TypeOptions';
import type { FrameTextTarget } from '../../state/textTarget';

const WEIGHTS: { w: number; name: string }[] = [
  { w: 300, name: 'Light' },
  { w: 400, name: 'Regular' },
  { w: 500, name: 'Medium' },
  { w: 600, name: 'Semibold' },
  { w: 700, name: 'Bold' },
  { w: 900, name: 'Black' },
];

/** "Regular", "Bold italic", … for a weight + italic pair. */
export function styleName(weight: number, italic: boolean): string {
  const near = WEIGHTS.reduce((a, b) => (Math.abs(b.w - weight) < Math.abs(a.w - weight) ? b : a));
  if (!italic) return near.name;
  return near.w === 400 ? 'Italic' : `${near.name} italic`;
}

const ALIGN: { value: TextAlign; label: string }[] = [
  { value: 'left', label: 'Align left' },
  { value: 'center', label: 'Align centre' },
  { value: 'right', label: 'Align right' },
  { value: 'justify', label: 'Justify' },
];

const CAPS: { value: TextCaps; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'small-caps', label: 'Small caps' },
  { value: 'all-small-caps', label: 'All small caps' },
];

export function TextSection() {
  useEditor();
  const [more, setMore] = useState(false);
  const target = activeTextTarget();
  if (!target) return null;
  const s: TextStyle = target.style;
  const apply = target.apply;
  // Layout frames: styles, paragraph spacing and per-character scope (state/textTarget.ts)
  const frame = 'storyId' in target ? (target as FrameTextTarget) : null;
  const mixed = (k: keyof TextStyle) => !!frame && frame.mixed(k);
  const styleValue = `${s.fontWeight}${s.italic ? 'i' : ''}`;
  const styleOptions = WEIGHTS.flatMap(({ w }) => [`${w}`, `${w}i`]);
  if (!styleOptions.includes(styleValue)) styleOptions.unshift(styleValue);
  return (
    <Section id="text" title={frame && frame.scope !== 'story' ? <>Text <span className="count">{frame.scope === 'selection' ? 'selection' : 'at caret'}</span></> : 'Text'} className="text-section">
      {frame && <StylePickers target={frame} />}
      <div className="row text-font-row" data-keep-text-edit>
        <FontPicker full value={primaryFamily(s.fontFamily)} onPreview={(f) => apply({ fontFamily: f })} onCommit={(f) => apply({ fontFamily: f })} />
      </div>
      <div className="grid2" data-keep-text-edit>
        <select aria-label="Font style" value={styleValue} onChange={(e) => {
          const v = e.target.value;
          apply({ fontWeight: parseInt(v, 10), italic: v.endsWith('i') });
        }}>
          {styleOptions.map((v) => <option key={v} value={v}>{styleName(parseInt(v, 10), v.endsWith('i'))}</option>)}
        </select>
        <NumberField label="Size" ariaLabel="Font size (pt)" unit="pt" digits={1} mixed={mixed('fontSize')} value={s.fontSize} min={4} max={1000} onChange={(v) => apply({ fontSize: v })} onCommit={(v) => apply({ fontSize: v })} />
      </div>
      <div className="grid2" data-keep-text-edit>
        <NumberField label={<Icon name="leading" size={16} />} title="Leading: line height as a multiple of the size" ariaLabel="Leading (line height multiple)" unit="×" unitInline digits={2} value={s.lineHeight} min={0.6} max={4} step={0.05} onChange={(v) => apply({ lineHeight: v })} onCommit={(v) => apply({ lineHeight: v })} />
        <NumberField label={<Icon name="tracking" size={16} />} title="Tracking: letter spacing in thousandths of an em" ariaLabel="Tracking (thousandths of an em)" digits={0} value={s.letterSpacing} min={-200} max={1000} step={10} onChange={(v) => apply({ letterSpacing: v })} onCommit={(v) => apply({ letterSpacing: v })} />
      </div>
      <div className="row" data-keep-text-edit>
        <Segmented
          ariaLabel="Text alignment"
          full
          value={s.align}
          onChange={(a) => apply({ align: a })}
          options={ALIGN.map((a) => ({ value: a.value, ariaLabel: a.label, label: <Icon name={`text-${a.value}`} size={16} /> }))}
        />
      </div>
      {frame && <ParagraphOptions style={s} apply={apply} mixed={mixed} />}
      <div className="row" data-keep-text-edit>
        <button type="button" className="btn sm ghost more-type" aria-expanded={more} aria-controls="more-type-options" onClick={() => setMore(!more)}>
          <Icon name={more ? 'chevron-down' : 'chevron-right'} size={16} /> More type options
        </button>
      </div>
      {more && (
        <div id="more-type-options" className="more-type-options" data-keep-text-edit>
          <div className="row insp-row">
            <label htmlFor="text-caps">Capitals</label>
            <select id="text-caps" value={s.caps ?? 'normal'} onChange={(e) => apply({ caps: e.target.value as TextCaps })}>
              {CAPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="row">
            <label className="check"><input type="checkbox" checked={s.kerning !== false} onChange={(e) => apply({ kerning: e.target.checked })} /> Kerning</label>
            <label className="check"><input type="checkbox" checked={!!s.underline} onChange={(e) => apply({ underline: e.target.checked })} /> Underline</label>
          </div>
          {frame && <OpenTypeOptions style={s} apply={apply} />}
        </div>
      )}
    </Section>
  );
}
