/**
 * Layout-only inspector sections: text wrap (any object), tables (rows,
 * columns, header rows, cell range, merge / split, cell style, cell fill and
 * alignment), text-frame flow (auto-flow, fields, vertical alignment) and the
 * document baseline grid.
 */
import type { CellProps, Paint, SceneNode, TableNode, TextWrap } from '../../../core/types';
import { updateNode } from '../../../core/commands';
import {
  anchorOf, cellsInRange, colCount, deleteColumn, deleteRow, insertColumn, insertRow, mergeCells, resolveCell, rowCount, setCellProps, setCellStyle, splitCell,
} from '../../../core/tables';
import { sheetOf } from '../../../core/typography';
import { editor } from '../../state/editor';
import { runCommand } from '../../state/commands';
import { useEditor } from '../hooks';
import { Section } from '../controls/Panel';
import { Segmented } from '../controls/Segmented';
import { NumberField } from '../controls/NumberField';
import { PaintRow } from '../color/PaintRow';
import { Icon } from '../Icons';
import { storyFlow } from '../../engine/draw';

const WRAP: { value: TextWrap['mode']; label: string; title: string }[] = [
  { value: 'none', label: 'None', title: 'Text ignores this object' },
  { value: 'box', label: 'Box', title: 'Text flows around the bounding box' },
  { value: 'contour', label: 'Shape', title: 'Text follows the object’s outline' },
  { value: 'jump', label: 'Jump', title: 'Text jumps over the object (nothing beside it)' },
];

/** Text wrap for the selected object(s). */
export function WrapSection({ node }: { node: SceneNode }) {
  const wrap = node.wrap ?? { mode: 'none', offset: 0 };
  const set = (w: Partial<TextWrap>, merge?: string) =>
    editor.commit('Text wrap', (d) => updateNode(d, node.id, { wrap: { ...wrap, ...w } } as Partial<SceneNode>), merge);
  return (
    <Section id="wrap" title="Text wrap">
      <Segmented ariaLabel="Text wrap" full value={wrap.mode} onChange={(m) => set({ mode: m })} options={WRAP.map((w) => ({ value: w.value, label: w.label, title: w.title }))} />
      {wrap.mode !== 'none' && (
        <div className="grid2">
          <NumberField label="Offset" ariaLabel="Wrap offset (px)" unit="px" digits={1} min={0} max={500} value={wrap.offset} onChange={(v) => set({ offset: v }, `wrapoff:${node.id}`)} onCommit={(v) => set({ offset: v }, `wrapoff:${node.id}`)} />
        </div>
      )}
    </Section>
  );
}

/** Flow tools for a text frame: overset status, auto-flow, fields, vertical alignment. */
export function FrameFlowSection({ node }: { node: Extract<SceneNode, { type: 'textframe' }> }) {
  const ed = useEditor();
  const story = ed.doc!.stories[node.storyId];
  const pi = ed.activePageIndex;
  const flow = story ? storyFlow(ed.doc!, node.storyId, pi >= 0 ? pi : undefined) : null;
  const isLast = story?.chain[story.chain.length - 1] === node.id;
  const overset = !!flow?.overflow && isLast;
  const hiddenWords = overset && story ? story.text.slice(flow!.overflowAt).trim().split(/\s+/).filter(Boolean).length : 0;
  return (
    <Section id="frame-flow" title="Flow">
      {overset ? (
        <p className="flow-status bad" role="status"><Icon name="close" size={16} /> Overset: {hiddenWords} word{hiddenWords === 1 ? '' : 's'} hidden</p>
      ) : (
        <p className="flow-status" role="status">{story && story.chain.length > 1 ? `Frame ${story.chain.indexOf(node.id) + 1} of ${story.chain.length} in this story` : 'All text fits'}</p>
      )}
      <div className="row flow-actions">
        <button type="button" className="btn sm" disabled={!overset} onClick={() => runCommand('text.autoflow')} data-tip="Add pages and linked frames until the story fits">Auto-flow</button>
        <button type="button" className="btn sm ghost" data-keep-text-edit onClick={() => runCommand('text.insert-page-number')} data-tip="Insert a page number field at the caret"><Icon name="field" size={16} /> Page number</button>
      </div>
    </Section>
  );
}

/** Table rows / columns / cells. */
export function TableSection({ node }: { node: TableNode }) {
  const ed = useEditor();
  const sheet = sheetOf(ed.doc!);
  const tc = ed.ui.tableCell?.nodeId === node.id ? ed.ui.tableCell : null;
  const r = Math.min(tc?.r ?? 0, rowCount(node) - 1);
  const c = Math.min(tc?.c ?? 0, colCount(node) - 1);
  const r2 = Math.min(tc?.r2 ?? r, rowCount(node) - 1);
  const c2 = Math.min(tc?.c2 ?? c, colCount(node) - 1);
  const cells = cellsInRange(node, r, c, r2, c2);
  const props = resolveCell(node, sheet, r, c);
  const anchor = node.cells[anchorOf(node, r, c).r][anchorOf(node, r, c).c];
  const merged = (anchor.rowSpan ?? 1) > 1 || (anchor.colSpan ?? 1) > 1;
  const edit = (label: string, fn: (t: TableNode) => TableNode, merge?: string) => editor.commit(label, (d) => updateNode(d, node.id, (n) => (n.type === 'table' ? fn(n) : n)), merge);
  const setSel = (nr: number, nc: number, nr2 = nr, nc2 = nc) => editor.setUi({ tableCell: { nodeId: node.id, r: nr, c: nc, r2: nr2, c2: nc2 } });
  const cellProps = (p: Partial<CellProps>, merge?: string) => edit('Cell format', (t) => setCellProps(t, cells, p), merge);
  const one = (v: number) => Math.max(1, Math.round(v));
  return (
    <Section id="table" title={<>Table <span className="count">{rowCount(node)} × {colCount(node)}</span></>}>
      <div className="grid3">
        <NumberField label="Rows" ariaLabel="Rows" digits={0} min={1} max={200} value={rowCount(node)} onCommit={(v) => edit('Rows', (t) => resize(t, one(v), colCount(t)))} />
        <NumberField label="Cols" ariaLabel="Columns" digits={0} min={1} max={50} value={colCount(node)} onCommit={(v) => edit('Columns', (t) => resize(t, rowCount(t), one(v)))} />
        <NumberField label="Head" ariaLabel="Header rows" digits={0} min={0} max={rowCount(node)} value={node.headerRows} onCommit={(v) => edit('Header rows', (t) => ({ ...t, headerRows: Math.max(0, Math.min(rowCount(t), Math.round(v))) }))} />
      </div>
      <div className="sub-label">Cells</div>
      <div className="grid4 table-range">
        <NumberField label="R" ariaLabel="First row" digits={0} min={1} max={rowCount(node)} value={r + 1} onCommit={(v) => setSel(one(v) - 1, c, Math.max(one(v) - 1, r2), c2)} />
        <NumberField label="C" ariaLabel="First column" digits={0} min={1} max={colCount(node)} value={c + 1} onCommit={(v) => setSel(r, one(v) - 1, r2, Math.max(one(v) - 1, c2))} />
        <NumberField label="to R" ariaLabel="Last row" digits={0} min={1} max={rowCount(node)} value={r2 + 1} onCommit={(v) => setSel(r, c, Math.max(r, one(v) - 1), c2)} />
        <NumberField label="C" ariaLabel="Last column" digits={0} min={1} max={colCount(node)} value={c2 + 1} onCommit={(v) => setSel(r, c, r2, Math.max(c, one(v) - 1))} />
      </div>
      <div className="row table-actions">
        <button type="button" className="btn sm ghost" disabled={r === r2 && c === c2} onClick={() => edit('Merge cells', (t) => mergeCells(t, r, c, r2, c2))}>Merge</button>
        <button type="button" className="btn sm ghost" disabled={!merged} onClick={() => edit('Split cell', (t) => splitCell(t, r, c))}>Split</button>
        <span className="row-spacer" />
        <button type="button" className="icon-btn sm" {...tipOf('Insert row below')} onClick={() => edit('Insert row', (t) => insertRow(t, r2 + 1))}><Icon name="plus" /></button>
        <button type="button" className="icon-btn sm" {...tipOf('Delete row')} disabled={rowCount(node) < 2} onClick={() => edit('Delete row', (t) => deleteRow(t, r))}><Icon name="minus" /></button>
        <button type="button" className="icon-btn sm" {...tipOf('Insert column right')} onClick={() => edit('Insert column', (t) => insertColumn(t, c2 + 1))}><Icon name="chevron-right" /></button>
        <button type="button" className="icon-btn sm" {...tipOf('Delete column')} disabled={colCount(node) < 2} onClick={() => edit('Delete column', (t) => deleteColumn(t, c))}><Icon name="trash" /></button>
      </div>
      <div className="row insp-row">
        <label htmlFor="cell-style">Style</label>
        <select id="cell-style" value={node.cells[r][c].styleId ?? ''} onChange={(e) => edit('Cell style', (t) => setCellStyle(t, cells, e.target.value || null))}>
          <option value="">No cell style</option>
          {sheet.cell.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="row insp-row">
        <label>Fill</label>
        <PaintRow kind="fill" label="Cell fill" paint={props.fill} allowGradient={false} onChange={(p: Paint) => cellProps({ fill: p }, `cfill:${node.id}`)} />
      </div>
      <div className="grid2">
        <Segmented ariaLabel="Cell vertical alignment" value={props.vAlign} onChange={(v) => cellProps({ vAlign: v })} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Mid' }, { value: 'bottom', label: 'Bot', ariaLabel: 'Bottom' }]} />
        <NumberField label="Pad" ariaLabel="Cell padding (px)" unit="px" digits={1} min={0} max={100} value={props.padding} onChange={(v) => cellProps({ padding: v }, `cpad:${node.id}`)} onCommit={(v) => cellProps({ padding: v }, `cpad:${node.id}`)} />
      </div>
      <div className="row">
        <button type="button" className="btn sm ghost" onClick={() => runCommand('table.fit-rows')} data-tip="Grow rows so all cell text fits">Fit rows to text</button>
      </div>
      <p className="hint">Double-click a cell to type; Tab moves to the next cell.</p>
    </Section>
  );
}

function tipOf(label: string) {
  return { 'aria-label': label, 'data-tip': label };
}

/** Grow or shrink a table to rows × cols (adds / removes at the end). */
function resize(t: TableNode, rows: number, cols: number): TableNode {
  let out = t;
  while (rowCount(out) < rows) out = insertRow(out, rowCount(out));
  while (rowCount(out) > rows && rowCount(out) > 1) out = deleteRow(out, rowCount(out) - 1);
  while (colCount(out) < cols) out = insertColumn(out, colCount(out));
  while (colCount(out) > cols && colCount(out) > 1) out = deleteColumn(out, colCount(out) - 1);
  return out;
}

/** Document › Baseline grid (Layout). */
export function BaselineGridSection() {
  const ed = useEditor();
  const s = ed.doc!.settings;
  const g = s.baselineGrid ?? { enabled: false, start: s.margins.top || 36, increment: 18, visible: true };
  const set = (p: Partial<typeof g>, merge?: string) => editor.commit('Baseline grid', (d) => ({ ...d, settings: { ...d.settings, baselineGrid: { ...g, ...p } } }), merge);
  return (
    <Section id="baseline-grid" title="Baseline grid">
      <div className="row">
        <label className="check"><input type="checkbox" checked={g.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="grid-enabled" /> Use baseline grid</label>
        <label className="check"><input type="checkbox" checked={g.visible} disabled={!g.enabled} onChange={(e) => set({ visible: e.target.checked })} /> Show</label>
      </div>
      {g.enabled && (
        <div className="grid2">
          <NumberField label="Start" ariaLabel="Grid start (px from the top)" unit="px" digits={1} min={0} max={s.height} value={g.start} onChange={(v) => set({ start: v }, 'grid-start')} onCommit={(v) => set({ start: v }, 'grid-start')} />
          <NumberField label="Every" ariaLabel="Grid increment (px)" unit="px" digits={1} min={2} max={500} value={g.increment} onChange={(v) => set({ increment: v }, 'grid-inc')} onCommit={(v) => set({ increment: v }, 'grid-inc')} />
        </div>
      )}
      <p className="hint">Paragraphs set to “Align to baseline grid” sit on these lines; objects snap to them when snapping is on.</p>
    </Section>
  );
}
