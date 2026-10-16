/**
 * Symbols panel (Vector, left rail): every symbol in the document with a
 * thumbnail and how many instances use it. Create one from the selection,
 * insert an instance, rename or delete (instances are detached, not removed).
 */
import { useEffect, useRef } from 'react';
import { deleteSymbol, insertInstance, renameSymbol, symbolInstances } from '../../../core/symbols';
import type { SymbolDef } from '../../../core/types';
import { editor } from '../../state/editor';
import { runCommand } from '../../state/commands';
import { useEditor } from '../hooks';
import { EmptyState } from '../controls/EmptyState';
import { Icon } from '../Icons';
import { tip } from '../tips';
import { drawNodeTransformed, renderBounds } from '../../engine/draw';

function Thumb({ def }: { def: SymbolDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ed = useEditor();
  useEffect(() => {
    const c = ref.current;
    const doc = ed.doc;
    if (!c || !doc) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = 40 * dpr;
    c.height = 40 * dpr;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const rs = def.nodes.map(renderBounds);
    if (!rs.length) return;
    const x0 = Math.min(...rs.map((r) => r.x));
    const y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w));
    const y1 = Math.max(...rs.map((r) => r.y + r.h));
    const k = (32 * dpr) / Math.max(1, x1 - x0, y1 - y0);
    ctx.setTransform(k, 0, 0, k, c.width / 2 - ((x0 + x1) / 2) * k, c.height / 2 - ((y0 + y1) / 2) * k);
    for (const n of def.nodes) drawNodeTransformed(ctx, n, { doc, assets: ed.assets, editor: false, preview: true, zoom: k });
  }, [def.nodes, ed.doc, ed.assets]);
  return <canvas ref={ref} className="symbol-thumb" aria-hidden="true" />;
}

function insert(def: SymbolDef) {
  const doc = editor.doc;
  const c = editor.activeContainer;
  if (!doc || !c) return;
  let id: string | null = null;
  editor.commit('Insert symbol', (d) => {
    const r = insertInstance(d, def.id, c.id, d.settings.width / 2, d.settings.height / 2);
    id = r.instanceId;
    return r.doc;
  });
  if (id) editor.select([id]);
}

export function SymbolsPanel() {
  const ed = useEditor();
  const doc = ed.doc!;
  const symbols = doc.symbols ?? [];
  const counts = symbolInstances(doc);
  const canCreate = ed.ui.selection.length > 0;
  return (
    <div className="symbols-panel" data-testid="symbols-panel">
      <div className="panel-actions">
        <button type="button" className="btn sm" disabled={!canCreate} onClick={() => runCommand('symbol.create')} {...tip('Create symbol', 'symbol.create')} data-tip-hint={canCreate ? 'From the selected objects' : 'Select objects first'}>
          <Icon name="plus" /> Create symbol
        </button>
      </div>
      {symbols.length === 0 ? (
        <EmptyState icon="symbol" title="No symbols yet">
          Turn a selection into a symbol to reuse it: edit any copy and every copy updates.
        </EmptyState>
      ) : (
        <ul className="symbol-list" aria-label="Symbols">
          {symbols.map((s) => {
            const n = counts.get(s.id)?.length ?? 0;
            return (
              <li key={s.id} className="symbol-item" data-symbol={s.id}>
                <Thumb def={s} />
                <div>
                  <input
                    type="text"
                    className="symbol-name inline-edit"
                    aria-label="Symbol name"
                    value={s.name}
                    onChange={(e) => editor.commit('Rename symbol', (d) => renameSymbol(d, s.id, e.target.value), 'symname:' + s.id)}
                  />
                  <div className="symbol-meta">{n === 1 ? '1 instance' : `${n} instances`}</div>
                </div>
                <div className="symbol-actions">
                  <button type="button" className="icon-btn sm" {...tip(`Insert ${s.name}`)} onClick={() => insert(s)}><Icon name="plus" /></button>
                  <button type="button" className="icon-btn sm" {...tip(`Delete ${s.name}`)} data-tip-hint="Instances stay as plain groups" onClick={() => editor.commit('Delete symbol', (d) => deleteSymbol(d, s.id))}><Icon name="trash" /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
