import { useState } from 'react';
import { moveNodeTo, updateNode, updateNodes } from '../../../core/commands';
import { BLEND_MODES, type BlendMode, type Id, type SceneNode } from '../../../core/types';
import { editor } from '../../state/editor';
import { runCommand } from '../../state/commands';
import { useEditor } from '../hooks';
import { Icon } from '../Icons';

const TYPE_ICON: Record<SceneNode['type'], string> = {
  rect: 'rect', ellipse: 'ellipse', polygon: 'polygon', star: 'star', path: 'pen', text: 'text', textframe: 'textframe',
  imageframe: 'imageframe', raster: 'pixel', group: 'group',
};

function Thumb({ n }: { n: SceneNode }) {
  if ((n.type === 'raster' || (n.type === 'imageframe' && n.assetId)) && editor.assets.get((n as { assetId: string }).assetId)) {
    const c = editor.assets.get((n as { assetId: string }).assetId)!;
    return (
      <span className="thumb" style={{ backgroundImage: `url(${thumbUrl(c)})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
    );
  }
  const color = 'fill' in n && n.fill.type === 'solid' ? n.fill.color : undefined;
  return (
    <span className="thumb" style={{ color: color ?? '#555' }}>
      <Icon name={TYPE_ICON[n.type]} />
    </span>
  );
}

const thumbCache = new WeakMap<HTMLCanvasElement, string>();
function thumbUrl(c: HTMLCanvasElement): string {
  let u = thumbCache.get(c);
  if (!u) {
    const s = 48 / Math.max(c.width, c.height);
    const t = document.createElement('canvas');
    t.width = Math.max(1, c.width * s);
    t.height = Math.max(1, c.height * s);
    t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height);
    u = t.toDataURL();
    thumbCache.set(c, u);
  }
  return u;
}

function LayerRow({ n, depth, containerId, index, dragId, setDragId }: { n: SceneNode; depth: number; containerId: Id; index: number; dragId: Id | null; setDragId: (id: Id | null) => void }) {
  const ed = useEditor();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [over, setOver] = useState(false);
  const selected = ed.ui.selection.includes(n.id);
  const click = (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ed.select(selected ? ed.ui.selection.filter((x) => x !== n.id) : [...ed.ui.selection, n.id]);
    } else ed.select([n.id]);
  };
  return (
    <>
      <li
        className={`layer-row ${selected ? 'selected' : ''} ${n.visible ? '' : 'hidden-layer'} ${over ? 'drop-before' : ''}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={click}
        onDoubleClick={() => setRenaming(true)}
        draggable={depth === 0}
        onDragStart={(e) => {
          setDragId(n.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDragId(null)}
        onDragOver={(e) => {
          if (dragId && dragId !== n.id && depth === 0) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!dragId) return;
          // rows are listed top-first; dropping "before" a row means above it in z-order
          ed.commit('Reorder layers', (d) => {
            const c = d.pages.find((p) => p.id === containerId) ?? d.masters.find((m) => m.id === containerId);
            const from = c?.nodes.findIndex((x) => x.id === dragId) ?? -1;
            const target = from >= 0 && from < index ? index : index + 1;
            return moveNodeTo(d, dragId, containerId, target);
          });
        }}
        aria-selected={selected}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={n.type === 'group' ? open : undefined}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') ed.select([n.id]);
          if (e.key === 'F2') setRenaming(true);
        }}
        data-layer-id={n.id}
      >
        {n.type === 'group' ? (
          <button className="twisty" aria-label={open ? 'Collapse group' : 'Expand group'} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? '▾' : '▸'}</button>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <Thumb n={n} />
        <span className="name">
          {renaming ? (
            <input
              type="text"
              autoFocus
              defaultValue={n.name}
              aria-label="Layer name"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                setRenaming(false);
                const v = e.target.value.trim();
                if (v && v !== n.name) ed.commit('Rename layer', (d) => updateNode(d, n.id, { name: v }));
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            n.name
          )}
        </span>
        {n.mask && <span className="meta" title="Has mask"><Icon name="mask" /></span>}
        {n.type === 'raster' && n.adjustments.length > 0 && <span className="meta" title="Live adjustments">fx</span>}
        <button className="icon-btn sm" aria-label={n.locked ? 'Unlock layer' : 'Lock layer'} title={n.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); ed.commit('Lock', (d) => updateNode(d, n.id, { locked: !n.locked })); }}>
          <Icon name={n.locked ? 'lock' : 'unlock'} />
        </button>
        <button className="icon-btn sm" aria-label={n.visible ? 'Hide layer' : 'Show layer'} title={n.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); ed.commit('Visibility', (d) => updateNode(d, n.id, { visible: !n.visible })); }}>
          <Icon name={n.visible ? 'eye' : 'eye-off'} />
        </button>
      </li>
      {n.type === 'group' && open && [...n.children].reverse().map((c, i) => (
        <LayerRow key={c.id} n={c} depth={depth + 1} containerId={containerId} index={n.children.length - 1 - i} dragId={dragId} setDragId={setDragId} />
      ))}
    </>
  );
}

export function LayersPanel() {
  const ed = useEditor();
  const [dragId, setDragId] = useState<Id | null>(null);
  const c = ed.activeContainer;
  if (!c) return null;
  const sel = ed.selectedNodes();
  const first = sel[0];
  const doc = ed.doc!;
  const page = doc.pages.find((p) => p.id === c.id);
  const master = page?.masterId ? doc.masters.find((m) => m.id === page.masterId) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', margin: '-8px -10px' }}>
      {first && (
        <div style={{ padding: '8px 10px 4px', borderBottom: '1px solid var(--border)' }}>
          <div className="row">
            <select value={first.blend} aria-label="Layer blend mode" onChange={(e) => ed.commit('Blend mode', (d) => updateNodes(d, ed.ui.selection, (m) => ({ ...m, blend: e.target.value as BlendMode })))}>
              {BLEND_MODES.map((m) => <option key={m} value={m}>{m.replace(/-/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase())}</option>)}
            </select>
            <input type="range" min={0} max={100} value={Math.round(first.opacity * 100)} aria-label="Layer opacity" onChange={(e) => ed.commit('Opacity', (d) => updateNodes(d, ed.ui.selection, (m) => ({ ...m, opacity: parseInt(e.target.value, 10) / 100 })), 'opacity')} />
            <span style={{ width: 34 }}>{Math.round(first.opacity * 100)}%</span>
          </div>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px' }}>
        {c.nodes.length === 0 && <p className="empty-note">This page is empty. Pick a tool on the left and draw, or place an image.</p>}
        <ul className="layer-list" role="tree" aria-label="Layers" aria-multiselectable="true">
          {[...c.nodes].reverse().map((n, i) => (
            <LayerRow key={n.id} n={n} depth={0} containerId={c.id} index={c.nodes.length - 1 - i} dragId={dragId} setDragId={setDragId} />
          ))}
        </ul>
        {master && master.nodes.length > 0 && (
          <div style={{ marginTop: 8, color: 'var(--text-faint)', fontSize: 12, padding: '0 6px' }}>
            + {master.nodes.length} item(s) from master “{master.name}” <button className="btn ghost" style={{ height: 22 }} onClick={() => ed.setUi({ activeContainerId: master.id, selection: [] })}>Edit master</button>
          </div>
        )}
      </div>
      <div className="layer-actions" role="toolbar" aria-label="Layer actions">
        <button className="icon-btn sm" title="New pixel layer" aria-label="New pixel layer" onClick={() => runCommand('layer.new-pixel')}><Icon name="plus" /></button>
        <button className="icon-btn sm" title="Group" aria-label="Group" disabled={sel.length < 2} onClick={() => runCommand('arrange.group')}><Icon name="group" /></button>
        <button className="icon-btn sm" title="Mask to selection" aria-label="Mask to pixel selection" disabled={!sel.length || !ed.ui.pixelSelection} onClick={() => runCommand('layer.mask-selection')}><Icon name="mask" /></button>
        <button className="icon-btn sm" title="Duplicate" aria-label="Duplicate" disabled={!sel.length} onClick={() => runCommand('edit.duplicate')}><Icon name="copy" /></button>
        <button className="icon-btn sm" title="Bring forward" aria-label="Bring forward" disabled={!sel.length} onClick={() => runCommand('arrange.forward')}><Icon name="arrow-up" /></button>
        <button className="icon-btn sm" title="Send backward" aria-label="Send backward" disabled={!sel.length} onClick={() => runCommand('arrange.backward')}><Icon name="arrow-down" /></button>
        <div style={{ flex: 1 }} />
        <button className="icon-btn sm" title="Delete" aria-label="Delete" disabled={!sel.length} onClick={() => runCommand('edit.delete')}><Icon name="trash" /></button>
      </div>
    </div>
  );
}
