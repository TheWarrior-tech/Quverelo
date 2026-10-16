/**
 * Pro typography controls for Layout text frames (inspector › Text):
 * paragraph / character style pickers, paragraph spacing and indents with
 * baseline-grid alignment, and the OpenType feature set (ligatures, figure
 * style and spacing, position, baseline shift, strikethrough). A feature the
 * font does not have is marked, so a student is never left wondering why
 * old-style figures do nothing in Inter.
 */
import type { FigureSpacing, FigureStyle, TabAlign, TabStop, TextLanguage, TextPosition, TextStyle } from '../../../core/types';
import { HYPHEN_LANGUAGES } from '../../../core/hyphenation';
import { DEFAULT_TAB_INTERVAL } from '../../../core/textflow';
import { Segmented } from '../controls/Segmented';
import { Icon } from '../Icons';
import { BUNDLED_FEATURES } from '../../../core/otFeatures';
import { applyCharStyle, applyParagraphStyle, paragraphIndexAt, sheetOf } from '../../../core/typography';
import { applyCellCharStyle, cellStory } from '../../../core/tables';
import { updateNode } from '../../../core/commands';
import { findNode } from '../../../core/document';
import type { SceneNode } from '../../../core/types';
import { editor } from '../../state/editor';
import type { FrameTextTarget } from '../../state/textTarget';
import { NumberField } from '../controls/NumberField';
import { primaryFamily } from '../fonts';
import { useEditor } from '../hooks';

const FIGURES: { value: FigureStyle; label: string; feature?: string }[] = [
  { value: 'default', label: 'Font default' },
  { value: 'lining', label: 'Lining', feature: 'lnum' },
  { value: 'oldstyle', label: 'Old-style', feature: 'onum' },
];
const SPACING: { value: FigureSpacing; label: string; feature?: string }[] = [
  { value: 'default', label: 'Font default' },
  { value: 'proportional', label: 'Proportional', feature: 'pnum' },
  { value: 'tabular', label: 'Tabular', feature: 'tnum' },
];
const POSITION: { value: TextPosition; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'superscript', label: 'Superscript' },
  { value: 'subscript', label: 'Subscript' },
];

/** Whether a bundled font has an OpenType feature (unknown fonts: assume yes). */
export function fontHas(family: string, feature: string): boolean {
  const list = BUNDLED_FEATURES[primaryFamily(family).toLowerCase()];
  return !list || list.includes(feature);
}

/** Paragraph and character style pickers for the frame / selection (character style only inside a table cell). */
export function StylePickers({ target }: { target: FrameTextTarget }) {
  const ed = useEditor();
  const doc = ed.doc!;
  const sheet = sheetOf(doc);
  const cellLoc = target.kind === 'cell' && target.cell ? target.cell : null;
  const table = cellLoc ? findNode(doc, cellLoc.nodeId)?.node : null;
  const story = cellLoc ? (table?.type === 'table' ? cellStory(table, sheet, cellLoc.r, cellLoc.c) : null) : doc.stories[target.storyId];
  if (!story) return null;
  const pi = paragraphIndexAt(story.text, target.range.start);
  const paraStyle = story.paras?.[pi]?.styleId ?? '';
  const span = (story.spans ?? []).find((s) => s.start <= target.range.start && s.end > target.range.start);
  const charStyle = target.scope === 'story' ? '' : span?.styleId ?? '';
  const applyPara = (id: string) =>
    editor.commit('Apply paragraph style', (d) => {
      const s = d.stories[target.storyId];
      return { ...d, stories: { ...d.stories, [target.storyId]: applyParagraphStyle(s, target.range.start, target.range.end, id || null) } };
    });
  const applyChar = (id: string) => {
    if (cellLoc) {
      const { nodeId, r, c } = cellLoc;
      editor.commit('Apply character style', (d) => updateNode(d, nodeId, (x: SceneNode) => (x.type === 'table' ? applyCellCharStyle(x, r, c, target.range.start, target.range.end, id || null) : x)));
      return;
    }
    editor.commit('Apply character style', (d) => {
      const s = d.stories[target.storyId];
      return { ...d, stories: { ...d.stories, [target.storyId]: applyCharStyle(s, target.range.start, target.range.end, id || null) } };
    });
  };
  const charPicker = (
    <select aria-label="Character style" title={target.scope === 'selection' ? 'Character style of the selected text' : 'Select text to apply a character style'} value={charStyle} disabled={target.scope !== 'selection'} onChange={(e) => applyChar(e.target.value)} data-testid="char-style">
      <option value="">No character style</option>
      {sheet.character.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
  if (cellLoc) return <div className="row type-styles" data-keep-text-edit>{charPicker}</div>;
  return (
    <div className="grid2 type-styles" data-keep-text-edit>
      <select aria-label="Paragraph style" title="Paragraph style" value={paraStyle} onChange={(e) => applyPara(e.target.value)} data-testid="para-style">
        <option value="">No paragraph style</option>
        {sheet.paragraph.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {charPicker}
    </div>
  );
}

/** Space before / after, indents, baseline grid. */
export function ParagraphOptions({ style, apply, mixed }: { style: TextStyle; apply: (p: Partial<TextStyle>) => void; mixed: (k: keyof TextStyle) => boolean }) {
  const ed = useEditor();
  const grid = ed.doc?.settings.baselineGrid;
  const num = (key: 'spaceBefore' | 'spaceAfter' | 'leftIndent' | 'rightIndent' | 'firstIndent', label: string, aria: string, min = 0) => (
    <NumberField label={label} ariaLabel={aria} unit="pt" digits={1} min={min} max={1000} mixed={mixed(key)} value={style[key] ?? 0} onChange={(v) => apply({ [key]: v })} onCommit={(v) => apply({ [key]: v })} />
  );
  return (
    <div className="type-para" data-keep-text-edit>
      <div className="grid2">
        {num('spaceBefore', 'Before', 'Space before paragraph')}
        {num('spaceAfter', 'After', 'Space after paragraph')}
      </div>
      <div className="grid3">
        {num('leftIndent', 'Left', 'Left indent')}
        {num('firstIndent', '1st', 'First line indent', -1000)}
        {num('rightIndent', 'Right', 'Right indent')}
      </div>
      <div className="row">
        <label className="check" title={grid?.enabled ? 'Snap this paragraph’s baselines to the document baseline grid' : 'Turn on the baseline grid in the document properties first'}>
          <input type="checkbox" checked={!!style.alignToGrid} onChange={(e) => apply({ alignToGrid: e.target.checked })} /> Align to baseline grid
        </label>
      </div>
      <HyphenKeepOptions style={style} apply={apply} />
      <TabStopsEditor style={style} apply={apply} />
    </div>
  );
}

/** Hyphenation (with its language) and keep options: keep with next, keep lines together, widows and orphans. */
export function HyphenKeepOptions({ style, apply }: { style: TextStyle; apply: (p: Partial<TextStyle>) => void }) {
  const wo = (style.widows ?? 0) > 1 || (style.orphans ?? 0) > 1;
  return (
    <>
      <div className="row type-hyphen">
        <label className="check" title="Break long words at line ends with a hyphen, using dictionary patterns">
          <input type="checkbox" data-testid="para-hyphenate" checked={!!style.hyphenate} onChange={(e) => apply({ hyphenate: e.target.checked })} /> Hyphenate
        </label>
        <select aria-label="Hyphenation language" title="Hyphenation language" value={style.language ?? 'en-GB'} disabled={!style.hyphenate} onChange={(e) => apply({ language: e.target.value as TextLanguage })}>
          {HYPHEN_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>
      <div className="row type-checks type-keeps">
        <label className="check" title="Keep this paragraph’s last line in the same column as the next paragraph (headings)">
          <input type="checkbox" data-testid="para-keep-next" checked={!!style.keepWithNext} onChange={(e) => apply({ keepWithNext: e.target.checked })} /> Keep with next
        </label>
        <label className="check" title="Never split this paragraph across columns or frames">
          <input type="checkbox" data-testid="para-keep-together" checked={!!style.keepTogether} onChange={(e) => apply({ keepTogether: e.target.checked })} /> Keep lines together
        </label>
        <label className="check" title="At least two lines of a paragraph at the foot of a column and at the top of the next">
          <input type="checkbox" data-testid="para-widows" checked={wo} onChange={(e) => apply({ widows: e.target.checked ? 2 : 0, orphans: e.target.checked ? 2 : 0 })} /> Widow and orphan control
        </label>
      </div>
    </>
  );
}

const TAB_ALIGN: { value: TabAlign; label: string }[] = [
  { value: 'left', label: 'Left tab' },
  { value: 'center', label: 'Centre tab' },
  { value: 'right', label: 'Right tab' },
  { value: 'decimal', label: 'Decimal tab (aligns on the point)' },
];
const LEADERS: { value: string; label: string }[] = [
  { value: '', label: 'No leader' },
  { value: '.', label: 'Dots  . . . .' },
  { value: '-', label: 'Dashes  - - - -' },
  { value: '_', label: 'Line  ____' },
];

/** Tab stops of the paragraph: position, alignment and leader; default stops every ½ inch after the last. */
export function TabStopsEditor({ style, apply }: { style: TextStyle; apply: (p: Partial<TextStyle>) => void }) {
  const stops = [...(style.tabStops ?? [])].sort((a, b) => a.pos - b.pos);
  const set = (next: TabStop[]) => apply({ tabStops: [...next].sort((a, b) => a.pos - b.pos) });
  const update = (i: number, patch: Partial<TabStop>) => set(stops.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const add = () => set([...stops, { pos: (stops.length ? stops[stops.length - 1].pos : 0) + DEFAULT_TAB_INTERVAL * 2, align: 'left' }]);
  return (
    <div className="tab-stops" data-testid="tab-stops">
      <div className="sub-label tab-stops-head">
        <span>Tab stops</span>
        <button type="button" className="icon-btn sm" aria-label="Add tab stop" data-tip="Add tab stop" onClick={add}><Icon name="plus" size={16} /></button>
      </div>
      {!stops.length && <p className="hint tab-stops-empty">Default stops every 12.7 mm. Press Tab in the text to move to the next one.</p>}
      {stops.map((st, i) => (
        <div className="tab-stop" key={i} data-testid="tab-stop">
          <NumberField label="At" ariaLabel={`Tab stop ${i + 1} position`} unit="pt" digits={1} min={0} max={5000} value={st.pos} onCommit={(v) => update(i, { pos: v })} />
          <Segmented
            ariaLabel={`Tab stop ${i + 1} alignment`}
            value={st.align}
            onChange={(a) => update(i, { align: a })}
            options={TAB_ALIGN.map((a) => ({ value: a.value, ariaLabel: a.label, label: <Icon name={`tab-${a.value}`} size={16} /> }))}
          />
          <select aria-label={`Tab stop ${i + 1} leader`} value={st.leader ?? ''} onChange={(e) => update(i, { leader: e.target.value || undefined })}>
            {LEADERS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button type="button" className="icon-btn sm" aria-label={`Remove tab stop ${i + 1}`} data-tip="Remove tab stop" onClick={() => set(stops.filter((_, k) => k !== i))}><Icon name="trash" size={16} /></button>
        </div>
      ))}
    </div>
  );
}

/** OpenType and character extras (inside "More type options"). */
export function OpenTypeOptions({ style, apply }: { style: TextStyle; apply: (p: Partial<TextStyle>) => void }) {
  const fam = style.fontFamily;
  const missing = (f?: string) => (f && !fontHas(fam, f) ? ' (not in this font)' : '');
  return (
    <div className="type-ot" data-keep-text-edit>
      <div className="row insp-row">
        <label htmlFor="text-figures">Figures</label>
        <select id="text-figures" value={style.figures ?? 'default'} onChange={(e) => apply({ figures: e.target.value as FigureStyle })}>
          {FIGURES.map((f) => <option key={f.value} value={f.value}>{f.label + missing(f.feature)}</option>)}
        </select>
      </div>
      <div className="row insp-row">
        <label htmlFor="text-figure-spacing">Spacing</label>
        <select id="text-figure-spacing" aria-label="Figure spacing" value={style.figureSpacing ?? 'default'} onChange={(e) => apply({ figureSpacing: e.target.value as FigureSpacing })}>
          {SPACING.map((f) => <option key={f.value} value={f.value}>{f.label + missing(f.feature)}</option>)}
        </select>
      </div>
      <div className="row insp-row">
        <label htmlFor="text-position">Position</label>
        <select id="text-position" value={style.position ?? 'normal'} onChange={(e) => apply({ position: e.target.value as TextPosition })}>
          {POSITION.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <div className="grid2">
        <NumberField label="Shift" title="Baseline shift" ariaLabel="Baseline shift (pt)" unit="pt" digits={1} min={-500} max={500} value={style.baselineShift ?? 0} onChange={(v) => apply({ baselineShift: v })} onCommit={(v) => apply({ baselineShift: v })} />
        <NumberField label="Lead" title="Absolute leading (0 = automatic from the multiple)" ariaLabel="Absolute leading (pt)" unit="pt" digits={1} min={0} max={1000} value={style.leading ?? 0} onChange={(v) => apply({ leading: v })} onCommit={(v) => apply({ leading: v })} />
      </div>
      <div className="row type-checks">
        <label className="check" title={'Standard ligatures (fi, fl, ff)' + missing('liga')}><input type="checkbox" checked={style.ligatures !== false} onChange={(e) => apply({ ligatures: e.target.checked })} /> Ligatures</label>
        <label className="check" title={'Discretionary ligatures (ct, st)' + missing('dlig')}><input type="checkbox" checked={!!style.discretionaryLigatures} onChange={(e) => apply({ discretionaryLigatures: e.target.checked })} /> Discretionary</label>
        <label className="check"><input type="checkbox" checked={!!style.strike} onChange={(e) => apply({ strike: e.target.checked })} /> Strikethrough</label>
      </div>
    </div>
  );
}
