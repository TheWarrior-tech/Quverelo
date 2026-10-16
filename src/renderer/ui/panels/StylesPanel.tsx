/**
 * Styles (Layout studio, left rail): named paragraph, character and table-cell
 * styles, as in InDesign's Paragraph / Character / Cell Styles panels and
 * Affinity Publisher's Text Styles. Click a style to apply it to the text you
 * are editing (or the selected frame / table cells); edit a style and every
 * paragraph, run and cell using it updates. Styles can be based on another
 * style, name a next style for Return, be redefined from the selection, and be
 * deleted without changing how the text looks.
 */
import { useState, type ReactNode } from 'react';
import type { CellProps, Id, Paint, TextAlign, TextStyle } from '../../../core/types';
import {
  addCellStyle, addCharacterStyle, addParagraphStyle, defaultLayoutStyles, applyCharStyle, applyParagraphStyle, deleteTextStyle, pickChar, resolveParagraphStyle,
  sheetOf, styleFromText, styleUsage, updateTextStyle,
} from '../../../core/typography';
import { cellsInRange, setCellStyle } from '../../../core/tables';
import { findNode, solid } from '../../../core/document';
import { updateNode } from '../../../core/commands';
import { editor } from '../../state/editor';
import { toast } from '../../state/bus';
import { frameTextTarget } from '../../state/textTarget';
import { useEditor } from '../hooks';
import { Icon } from '../Icons';
import { Section } from '../controls/Panel';
import { NumberField } from '../controls/NumberField';
import { FontPicker } from '../controls/FontPicker';
import { PaintRow } from '../color/PaintRow';
import { primaryFamily } from '../fonts';

type Kind = 'paragraph' | 'character' | 'cell';

/** The frame / story the styles panel acts on (edited or selected text frame). */
function currentFrameTarget() {
  const doc = editor.doc;
  if (!doc) return null;
  const id = editor.ui.editingTextId ?? editor.ui.selection[0];
  const n = id ? findNode(doc, id)?.node : null;
  return n?.type === 'textframe' ? frameTextTarget(doc, n.storyId) : null;
}

function currentCells(): { nodeId: Id; cells: { r: number; c: number }[] } | null {
  const doc = editor.doc;
  const tc = editor.ui.tableCell;
  const sel = editor.ui.selection[0];
  const id = tc?.nodeId ?? sel;
  const n = id && doc ? findNode(doc, id)?.node : null;
  if (!n || n.type !== 'table') return null;
  if (tc && tc.nodeId === n.id) return { nodeId: n.id, cells: cellsInRange(n, tc.r, tc.c, tc.r2 ?? tc.r, tc.c2 ?? tc.c) };
  return { nodeId: n.id, cells: cellsInRange(n, 0, 0, n.rowHeights.length - 1, n.colWidths.length - 1) };
}

function applyStyle(kind: Kind, id: Id | null) {
  if (kind === 'cell') {
    const t = currentCells();
    if (!t) return toast('Select a table (or double-click a cell) to apply a cell style');
    editor.commit('Apply cell style', (d) => updateNode(d, t.nodeId, (n) => (n.type === 'table' ? setCellStyle(n, t.cells, id) : n)));
    return;
  }
  const t = currentFrameTarget();
  if (!t) return toast('Select a text frame, or click into its text, to apply a style');
  if (kind === 'character' && t.scope === 'caret') return toast('Select some text to apply a character style');
  editor.commit(kind === 'paragraph' ? 'Apply paragraph style' : 'Apply character style', (d) => {
    const s = d.stories[t.storyId];
    const next = kind === 'paragraph' ? applyParagraphStyle(s, t.range.start, t.range.end, id) : applyCharStyle(s, t.range.start, t.range.end, id);
    return { ...d, stories: { ...d.stories, [t.storyId]: next } };
  });
}

export function StylesPanel() {
  const ed = useEditor();
  const doc = ed.doc!;
  const sheet = sheetOf(doc);
  const [editing, setEditing] = useState<{ kind: Kind; id: Id } | null>(null);
  const target = currentFrameTarget();
  const curPara = target ? doc.stories[target.storyId]?.paras?.[paraIndex(doc.stories[target.storyId]?.text ?? '', target.range.start)]?.styleId ?? null : null;

  const create = (kind: Kind) => {
    let id = '';
    editor.commit(`New ${kind} style`, (d) => {
      if (kind === 'cell') {
        const r = addCellStyle(d, { props: { fill: solid('#ecedef') } });
        id = r.id;
        return r.doc;
      }
      // based on the formatting at the caret / selection when there is one
      const t = currentFrameTarget();
      const story = t ? d.stories[t.storyId] : null;
      const props = story && t ? styleFromText(story, sheetOf(d), t.range.start) : {};
      const r = kind === 'paragraph' ? addParagraphStyle(d, { props }) : addCharacterStyle(d, { props: t && t.scope === 'selection' ? pickChar(props) : { fontWeight: 700 } });
      id = r.id;
      return r.doc;
    });
    setEditing({ kind, id });
  };

  const list = (kind: Kind) => (kind === 'paragraph' ? sheet.paragraph : kind === 'character' ? sheet.character : sheet.cell);
  const rows = (kind: Kind, title: string, empty: string) => (
    <Section
      id={`styles-${kind}`}
      title={<>{title} <span className="count">{list(kind).length}</span></>}
      actions={<button type="button" className="icon-btn sm" aria-label={`New ${kind} style`} data-tip={`New ${kind} style${kind !== 'cell' && target ? ' from the selection' : ''}`} onClick={() => create(kind)} data-testid={`new-${kind}-style`}><Icon name="plus" /></button>}
    >
      {list(kind).length === 0 && <p className="empty-note">{empty}</p>}
      <ul className="style-list" role="list" aria-label={title}>
        {list(kind).map((s) => {
          const open = editing?.kind === kind && editing.id === s.id;
          const uses = styleUsage(doc, kind, s.id);
          return (
            <li key={s.id} className={`style-row${open ? ' open' : ''}${kind === 'paragraph' && curPara === s.id ? ' current' : ''}`} data-style-name={s.name}>
              <div className="style-line">
                <button type="button" className="style-apply" data-keep-text-edit onClick={() => applyStyle(kind, s.id)} data-tip={`Apply ${s.name}`}>
                  <Icon name={kind === 'paragraph' ? 'pilcrow' : kind === 'character' ? 'charstyle' : 'table'} size={16} />
                  <span className="style-name">{s.name}</span>
                  {'basedOn' in s && s.basedOn && <span className="style-based">← {list(kind).find((x) => x.id === s.basedOn)?.name}</span>}
                  <span className="style-uses num" aria-label={`Used ${uses} times`}>{uses || ''}</span>
                </button>
                <button type="button" className="icon-btn sm" aria-label={`Edit ${s.name}`} aria-expanded={open} data-tip="Edit style" onClick={() => setEditing(open ? null : { kind, id: s.id })}><Icon name={open ? 'chevron-down' : 'settings'} size={16} /></button>
              </div>
              {open && <StyleEditor kind={kind} id={s.id} onClose={() => setEditing(null)} />}
            </li>
          );
        })}
      </ul>
    </Section>
  );

  const empty = !sheet.paragraph.length && !sheet.character.length && !sheet.cell.length;
  return (
    <div className="styles-panel">
      {empty && (
        <div className="row starter-styles">
          <button type="button" className="btn sm" data-testid="starter-styles" onClick={() => editor.commit('Add starter styles', (d) => ({ ...d, textStyles: defaultLayoutStyles() }))}>Add starter styles</button>
          <span className="hint">Body, headings, caption, emphasis and a header cell</span>
        </div>
      )}
      {rows('paragraph', 'Paragraph styles', 'Paragraph styles set the font, size, spacing and alignment of whole paragraphs. Edit one and every paragraph using it updates.')}
      {rows('character', 'Character styles', 'Character styles format a few words inside a paragraph, such as emphasis or small caps.')}
      {rows('cell', 'Cell styles', 'Cell styles set the fill, border, padding and text of table cells.')}
    </div>
  );
}

function paraIndex(text: string, pos: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(pos, text.length); i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const ALIGNS: { v: TextAlign; label: string }[] = [
  { v: 'left', label: 'Left' }, { v: 'center', label: 'Centre' }, { v: 'right', label: 'Right' }, { v: 'justify', label: 'Justify' },
];

function StyleEditor({ kind, id, onClose }: { kind: Kind; id: Id; onClose: () => void }) {
  const ed = useEditor();
  const doc = ed.doc!;
  const sheet = sheetOf(doc);
  if (kind === 'cell') return <CellStyleEditor id={id} onClose={onClose} />;
  const def = (kind === 'paragraph' ? sheet.paragraph : sheet.character).find((s) => s.id === id);
  if (!def) return null;
  const inherited: Partial<TextStyle> = kind === 'paragraph' ? resolveParagraphStyle(sheet, def.basedOn) : {};
  const eff = { ...inherited, ...def.props };
  const merge = `style-def:${id}`;
  const set = (props: Partial<TextStyle>) => editor.commit('Edit style', (d) => updateTextStyle(d, kind, id, { props }), merge);
  const own = (k: keyof TextStyle) => def.props[k] !== undefined;
  const reset = (k: keyof TextStyle) => editor.commit('Edit style', (d) => updateTextStyle(d, kind, id, { props: { [k]: undefined } as Partial<TextStyle> }));
  const n = (k: 'fontSize' | 'letterSpacing' | 'spaceBefore' | 'spaceAfter' | 'firstIndent', label: ReactNode, aria: string, dflt: number, unit?: string, min = 0, max = 1000) => (
    <NumberField label={label} ariaLabel={aria} unit={unit} digits={1} min={min} max={max} value={(eff[k] as number | undefined) ?? dflt} onChange={(v) => set({ [k]: v })} onCommit={(v) => set({ [k]: v })} className={own(k) ? 'own' : 'inherited'} />
  );
  const redefine = () => {
    const t = currentFrameTarget();
    if (!t) return toast('Click into some text first: the style takes its formatting');
    editor.commit('Redefine style', (d) => {
      const s = d.stories[t.storyId];
      const props = styleFromText(s, sheetOf(d), t.range.start);
      return updateTextStyle(d, kind, id, { props: kind === 'character' ? pickChar(props) : props, replaceProps: true });
    });
  };
  const others = (kind === 'paragraph' ? sheet.paragraph : sheet.character).filter((s) => s.id !== id);
  return (
    <div className="style-editor" data-keep-text-edit>
      <div className="row insp-row">
        <label htmlFor={`sn-${id}`}>Name</label>
        <input id={`sn-${id}`} type="text" value={def.name} onChange={(e) => editor.commit('Rename style', (d) => updateTextStyle(d, kind, id, { name: e.target.value }), `sname:${id}`)} />
      </div>
      <div className="row insp-row">
        <label htmlFor={`sb-${id}`}>Based on</label>
        <select id={`sb-${id}`} value={def.basedOn ?? ''} onChange={(e) => {
          try {
            editor.commit('Based on', (d) => updateTextStyle(d, kind, id, { basedOn: e.target.value || null }));
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }}>
          <option value="">No parent</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      {kind === 'paragraph' && (
        <div className="row insp-row">
          <label htmlFor={`sx-${id}`}>Next</label>
          <select id={`sx-${id}`} aria-label="Next style" value={(def as { nextStyle?: Id | null }).nextStyle ?? ''} onChange={(e) => editor.commit('Next style', (d) => updateTextStyle(d, 'paragraph', id, { nextStyle: e.target.value || null }))}>
            <option value="">Same style</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}
      <div className="row text-font-row">
        <FontPicker full value={primaryFamily(eff.fontFamily ?? 'Inter')} onPreview={(f) => set({ fontFamily: f })} onCommit={(f) => set({ fontFamily: f })} />
      </div>
      <div className="grid2">
        <select aria-label="Weight" value={`${eff.fontWeight ?? 400}${eff.italic ? 'i' : ''}`} onChange={(e) => set({ fontWeight: parseInt(e.target.value, 10), italic: e.target.value.endsWith('i') })}>
          {[300, 400, 500, 600, 700, 900].flatMap((w) => [<option key={w} value={`${w}`}>{weightName(w)}</option>, <option key={w + 'i'} value={`${w}i`}>{weightName(w)} italic</option>])}
        </select>
        {n('fontSize', 'Size', 'Style font size (pt)', 16, 'pt', 4)}
      </div>
      <div className="grid2">
        <NumberField label={<Icon name="leading" size={16} />} ariaLabel="Style leading (line height multiple)" unit="×" unitInline digits={2} min={0.6} max={4} step={0.05} value={eff.lineHeight ?? 1.3} onChange={(v) => set({ lineHeight: v })} onCommit={(v) => set({ lineHeight: v })} />
        {n('letterSpacing', <Icon name="tracking" size={16} />, 'Style tracking (thousandths of an em)', 0, undefined, -200, 1000)}
      </div>
      {kind === 'paragraph' && (
        <>
          <div className="row">
            <select aria-label="Style alignment" value={eff.align ?? 'left'} onChange={(e) => set({ align: e.target.value as TextAlign })}>
              {ALIGNS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </select>
          </div>
          <div className="grid3">
            {n('spaceBefore', 'Before', 'Style space before', 0, 'pt')}
            {n('spaceAfter', 'After', 'Style space after', 0, 'pt')}
            {n('firstIndent', '1st', 'Style first line indent', 0, 'pt', -1000)}
          </div>
          <div className="row">
            <label className="check"><input type="checkbox" checked={!!eff.alignToGrid} onChange={(e) => set({ alignToGrid: e.target.checked })} /> Align to baseline grid</label>
          </div>
        </>
      )}
      <div className="row insp-row">
        <label htmlFor={`sf-${id}`}>Figures</label>
        <select id={`sf-${id}`} value={eff.figures ?? 'default'} onChange={(e) => set({ figures: e.target.value as TextStyle['figures'] })}>
          <option value="default">Font default</option>
          <option value="lining">Lining</option>
          <option value="oldstyle">Old-style</option>
        </select>
      </div>
      <div className="row insp-row">
        <label htmlFor={`sc-${id}`}>Capitals</label>
        <select id={`sc-${id}`} value={eff.caps ?? 'normal'} onChange={(e) => set({ caps: e.target.value as TextStyle['caps'] })}>
          <option value="normal">Normal</option>
          <option value="small-caps">Small caps</option>
          <option value="all-small-caps">All small caps</option>
        </select>
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={eff.ligatures !== false} onChange={(e) => set({ ligatures: e.target.checked })} /> Ligatures</label>
        <label className="check"><input type="checkbox" checked={!!eff.underline} onChange={(e) => set({ underline: e.target.checked })} /> Underline</label>
      </div>
      <div className="row insp-row">
        <label>Colour</label>
        <PaintRow kind="fill" label="Style colour" paint={(eff.fill as Paint | undefined) ?? solid('#1b1b1f')} allowNone={false} allowGradient={false} onChange={(p) => set({ fill: p })} />
      </div>
      <div className="row style-editor-actions">
        <button type="button" className="btn sm ghost" onClick={redefine} data-tip="Take the formatting of the text at the caret">Redefine from text</button>
        {own('fontFamily') && <button type="button" className="btn sm ghost" onClick={() => reset('fontFamily')}>Inherit font</button>}
        <span className="row-spacer" />
        <button type="button" className="icon-btn sm" aria-label="Delete style" data-tip="Delete style (text keeps its look)" onClick={() => {
          editor.commit('Delete style', (d) => deleteTextStyle(d, kind, id));
          onClose();
        }}><Icon name="trash" /></button>
      </div>
    </div>
  );
}

function weightName(w: number): string {
  return ({ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 900: 'Black' } as Record<number, string>)[w] ?? String(w);
}

function CellStyleEditor({ id, onClose }: { id: Id; onClose: () => void }) {
  const ed = useEditor();
  const def = sheetOf(ed.doc!).cell.find((c) => c.id === id);
  if (!def) return null;
  const set = (props: Partial<CellProps>) => editor.commit('Edit cell style', (d) => updateTextStyle(d, 'cell', id, { props }), `cell-def:${id}`);
  const p = def.props;
  return (
    <div className="style-editor" data-keep-text-edit>
      <div className="row insp-row">
        <label htmlFor={`cn-${id}`}>Name</label>
        <input id={`cn-${id}`} type="text" value={def.name} onChange={(e) => editor.commit('Rename style', (d) => updateTextStyle(d, 'cell', id, { name: e.target.value }), `sname:${id}`)} />
      </div>
      <div className="row insp-row">
        <label>Fill</label>
        <PaintRow kind="fill" label="Cell fill" paint={p.fill ?? { type: 'none' }} allowGradient={false} onChange={(v) => set({ fill: v })} />
      </div>
      <div className="row insp-row">
        <label>Border</label>
        <PaintRow kind="stroke" label="Cell border" paint={p.stroke ?? solid('#33363d')} allowGradient={false} onChange={(v) => set({ stroke: v })} />
      </div>
      <div className="grid2">
        <NumberField label="W" ariaLabel="Border width" unit="px" digits={1} min={0} max={20} value={p.strokeWidth ?? 1} onChange={(v) => set({ strokeWidth: v })} onCommit={(v) => set({ strokeWidth: v })} />
        <NumberField label="Pad" ariaLabel="Cell padding" unit="px" digits={1} min={0} max={100} value={p.padding ?? 6} onChange={(v) => set({ padding: v })} onCommit={(v) => set({ padding: v })} />
      </div>
      <div className="row insp-row">
        <label>Text</label>
        <PaintRow kind="fill" label="Cell text colour" paint={p.text?.fill ?? solid('#1b1b1f')} allowNone={false} allowGradient={false} onChange={(v) => set({ text: { ...(p.text ?? {}), fill: v } })} />
      </div>
      <div className="grid2">
        <select aria-label="Cell text weight" value={String(p.text?.fontWeight ?? 400)} onChange={(e) => set({ text: { ...(p.text ?? {}), fontWeight: parseInt(e.target.value, 10) } })}>
          <option value="400">Regular</option>
          <option value="700">Bold</option>
        </select>
        <select aria-label="Vertical alignment" value={p.vAlign ?? 'top'} onChange={(e) => set({ vAlign: e.target.value as CellProps['vAlign'] })}>
          <option value="top">Top</option>
          <option value="middle">Middle</option>
          <option value="bottom">Bottom</option>
        </select>
      </div>
      <div className="row style-editor-actions">
        <span className="row-spacer" />
        <button type="button" className="icon-btn sm" aria-label="Delete style" data-tip="Delete style (cells keep their look)" onClick={() => {
          editor.commit('Delete style', (d) => deleteTextStyle(d, 'cell', id));
          onClose();
        }}><Icon name="trash" /></button>
      </div>
    </div>
  );
}
