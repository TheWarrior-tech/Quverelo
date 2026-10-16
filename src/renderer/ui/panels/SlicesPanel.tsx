/**
 * Export tab (Vector's Export persona): the document's slices, each with its
 * own outputs (format × scale), the file names they will write, and Export
 * slices to write every enabled slice into one folder.
 */
import { SLICE_FORMATS, SLICE_SCALES, plannedFiles, removeSlice, sliceRect, updateSlice } from '../../../core/slices';
import type { Slice, SliceFormat, SliceOutput } from '../../../core/types';
import { editor } from '../../state/editor';
import { runCommand } from '../../state/commands';
import { exportSlices } from '../../state/sliceExport';
import { useEditor } from '../hooks';
import { EmptyState } from '../controls/EmptyState';
import { Icon } from '../Icons';
import { tip } from '../tips';
import { renderLocalBounds } from '../../engine/draw';

const FORMAT_LABEL: Record<SliceFormat, string> = { png: 'PNG', jpg: 'JPEG', svg: 'SVG', pdf: 'PDF' };

function setOutputs(s: Slice, outputs: SliceOutput[]) {
  editor.commit('Slice outputs', (d) => updateSlice(d, s.id, { outputs }));
}

function SliceRow({ s }: { s: Slice }) {
  const ed = useEditor();
  const doc = ed.doc!;
  const r = sliceRect(doc, s, renderLocalBounds);
  const files = plannedFiles([{ ...s, enabled: true }]).map((f) => f.file);
  return (
    <li className="slice-item" data-slice={s.id}>
      <div className="slice-head">
        <input type="checkbox" aria-label={`Export ${s.name}`} checked={s.enabled} onChange={(e) => editor.commit('Slice', (d) => updateSlice(d, s.id, { enabled: e.target.checked }))} />
        <input type="text" aria-label="Slice name" value={s.name} onChange={(e) => editor.commit('Rename slice', (d) => updateSlice(d, s.id, { name: e.target.value }), 'slicename:' + s.id)} />
        <button type="button" className="icon-btn sm" {...tip(`Remove slice ${s.name}`)} onClick={() => editor.commit('Remove slice', (d) => removeSlice(d, s.id))}><Icon name="trash" /></button>
      </div>
      <div className="slice-meta num">{Math.round(r.w)} × {Math.round(r.h)} px{s.nodeId ? ' · follows its object' : ''}</div>
      <div className="slice-outputs" role="group" aria-label={`${s.name} outputs`}>
        {s.outputs.map((o, i) => (
          <div className="slice-output" key={i}>
            <select aria-label="Format" value={o.format} onChange={(e) => setOutputs(s, s.outputs.map((x, j) => (j === i ? { ...x, format: e.target.value as SliceFormat } : x)))}>
              {SLICE_FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
            </select>
            <select aria-label="Scale" value={o.scale} disabled={o.format === 'svg' || o.format === 'pdf'} onChange={(e) => setOutputs(s, s.outputs.map((x, j) => (j === i ? { ...x, scale: parseFloat(e.target.value) } : x)))}>
              {SLICE_SCALES.map((k) => <option key={k} value={k}>{`@${k}x`}</option>)}
            </select>
            <button type="button" className="icon-btn sm" {...tip('Remove output')} disabled={s.outputs.length <= 1} onClick={() => setOutputs(s, s.outputs.filter((_, j) => j !== i))}><Icon name="minus" /></button>
          </div>
        ))}
        <div className="panel-actions">
          <button type="button" className="btn sm ghost" onClick={() => {
            const last = s.outputs[s.outputs.length - 1] ?? { format: 'png' as const, scale: 1 };
            setOutputs(s, [...s.outputs, { format: last.format, scale: last.format === 'png' || last.format === 'jpg' ? Math.min(4, last.scale + 1) : 1 }]);
          }}><Icon name="plus" /> Output</button>
        </div>
      </div>
      <div className="slice-files" data-testid="slice-files">{files.join(' · ')}</div>
    </li>
  );
}

export function SlicesPanel() {
  const ed = useEditor();
  const doc = ed.doc!;
  const pageId = ed.activeContainer?.id;
  const slices = (doc.slices ?? []).filter((s) => s.pageId === pageId);
  const enabled = (doc.slices ?? []).filter((s) => s.enabled).length;
  return (
    <div className="slices-panel" data-testid="slices-panel">
      <div className="panel-actions">
        <button type="button" className="btn sm" onClick={() => runCommand('slice.add')} {...tip('Add export slice', 'slice.add')} data-tip-hint={ed.ui.selection.length ? 'One slice per selected object or artboard' : 'One per artboard, or the whole page'}>
          <Icon name="plus" /> Add slice
        </button>
        <button type="button" className="btn sm primary" disabled={!enabled} onClick={() => void exportSlices()} {...tip('Export slices', 'file.export-slices')}>
          <Icon name="export" /> Export slices
        </button>
      </div>
      {slices.length === 0 ? (
        <EmptyState icon="slice" title="No slices yet">
          A slice exports an artboard, an object or an area as its own files, for example PNG at @1x and @2x plus SVG.
        </EmptyState>
      ) : (
        <ul className="slice-list" aria-label="Slices">
          {slices.map((s) => <SliceRow key={s.id} s={s} />)}
        </ul>
      )}
    </div>
  );
}
