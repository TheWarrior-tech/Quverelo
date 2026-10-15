import { useState } from 'react';
import { moveNodeTo, updateNode, updateNodes } from '../../../core/commands';
import { BLEND_MODES, type BlendMode, type Id, type SceneNode } from '../../../core/types';
import { editor } from '../../state/editor';
import { getViewport, runCommand } from '../../state/commands';
import { useEditor } from '../hooks';
import { Icon } from '../Icons';
import { NumberField } from '../controls/NumberField';
import { useScrollEdges } from '../controls/Panel';
import { EmptyState } from '../controls/EmptyState';
import { tip } from '../tooltip';
import { dropIndex, isNoopDrop } from './layerDrop';

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
    <span className="thumb" style={color ? { ['--thumb' as string]: color } : undefined}>
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

type DropPlace = 'above' | 'below';

/** Move keyboard focus to the previous/next visible row. */
function focusSibling(from: HTMLElement, d: 1 | -1 | 'first' | 'last') {
  const rows = [...(from.closest('.layer-list')?.querySelectorAll<HTMLElement>('.layer-row') ?? [])];
  const i = rows.indexOf(from);
  const t = d === 'first' ? rows[0] : d === 'last' ? rows[rows.length - 1] : rows[i + d];
  t?.focus();
}

function LayerRow({ n, depth, containerId, index, dragId, setDragId, focusable }: { n: SceneNode; depth: number; containerId: Id; index: number; dragId: Id | null; setDragId: (id: Id | null) => void; focusable: boolean }) {
  const ed = useEditor();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [drop, setDrop] = useState<DropPlace | null>(null);
  const selected = ed.ui.selection.includes(n.id);
  const isGroup = n.type === 'group';
  const canDrop = depth === 0 && !!dragId && dragId !== n.id;
  const click = (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ed.select(selected ? ed.ui.selection.filter((x) => x !== n.id) : [...ed.ui.selection, n.id]);
    } else ed.select([n.id]);
  };
  const fromIndex = () => {
    const c = ed.doc?.pages.find((p) => p.id === containerId) ?? ed.doc?.masters.find((m) => m.id === containerId);
    return c?.nodes.findIndex((x) => x.id === dragId) ?? -1;
  };
  const toggleVisible = () => ed.commit('Visibility', (d) => updateNode(d, n.id, { visible: !n.visible }));
  const toggleLock = () => ed.commit('Lock', (d) => updateNode(d, n.id, { locked: !n.locked }));
  return (
    <>
      <li
        className={`layer-row${selected ? ' selected' : ''}${n.visible ? '' : ' hidden-layer'}${n.locked ? ' locked' : ''}${drop ? ` drop-${drop}` : ''}${dragId === n.id ? ' dragging' : ''}`}
        style={{ ['--depth' as string]: depth }}
        onClick={click}
        onMouseEnter={() => getViewport()?.setHover(n.id)}
        onMouseLeave={() => getViewport()?.setHover(null)}
        onDoubleClick={() => setRenaming(true)}
        draggable={depth === 0 && !renaming}
        onDragStart={(e) => {
          setDragId(n.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', n.name);
        }}
        onDragEnd={() => setDragId(null)}
        onDragOver={(e) => {
          if (!canDrop) return;
          const r = e.currentTarget.getBoundingClientRect();
          const place: DropPlace = e.clientY < r.top + r.height / 2 ? 'above' : 'below';
          if (isNoopDrop(fromIndex(), index, place)) return setDrop(null);
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (place !== drop) setDrop(place);
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          const place = drop;
          setDrop(null);
          if (!dragId || !place) return;
          const from = fromIndex();
          ed.commit('Reorder layers', (d) => moveNodeTo(d, dragId, containerId, dropIndex(from, index, place)));
        }}
        aria-selected={selected}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isGroup ? open : undefined}
        aria-label={`${n.name}${n.visible ? '' : ', hidden'}${n.locked ? ', locked' : ''}`}
        tabIndex={focusable ? 0 : -1}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const el = e.currentTarget;
          if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault();
            ed.select([n.id]);
            runCommand('arrange.backward');
          } else if (e.key === 'ArrowUp' && e.altKey) {
            e.preventDefault();
            ed.select([n.id]);
            runCommand('arrange.forward');
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            focusSibling(el, e.key === 'ArrowDown' ? 1 : -1);
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            focusSibling(el, e.key === 'Home' ? 'first' : 'last');
          } else if (e.key === 'ArrowRight' && isGroup && !open) setOpen(true);
          else if (e.key === 'ArrowLeft' && isGroup && open) setOpen(false);
          else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            ed.select([n.id]);
          } else if (e.key === 'F2') setRenaming(true);
          else if (e.key.toLowerCase() === 'h' && e.altKey) toggleVisible();
        }}
        data-layer-id={n.id}
      >
        <span className="indent" aria-hidden="true" />
        {isGroup ? (
          <button className="twisty" tabIndex={-1} aria-label={open ? 'Collapse group' : 'Expand group'} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
          </button>
        ) : (
          <span className="twisty-space" aria-hidden="true" />
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
              onFocus={(e) => e.currentTarget.select()}
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
        {n.mask && <span className="meta" data-tip="Has mask" aria-label="Has mask"><Icon name="mask" size={16} /></span>}
        {n.type === 'raster' && n.adjustments.length > 0 && <span className="meta" data-tip={`${n.adjustments.length} live adjustment${n.adjustments.length > 1 ? 's' : ''}`}><Icon name="adjust" size={16} /></span>}
        <button className={`icon-btn xs toggle lock${n.locked ? ' set' : ''}`} tabIndex={-1} aria-label={n.locked ? 'Unlock layer' : 'Lock layer'} aria-pressed={n.locked} data-tip={n.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); toggleLock(); }}>
          <Icon name={n.locked ? 'lock' : 'unlock'} size={16} />
        </button>
        <button className={`icon-btn xs toggle eye${n.visible ? '' : ' set'}`} tabIndex={-1} aria-label={n.visible ? 'Hide layer' : 'Show layer'} aria-pressed={!n.visible} data-tip={n.visible ? 'Hide (Alt+H)' : 'Show (Alt+H)'} onClick={(e) => { e.stopPropagation(); toggleVisible(); }}>
          <Icon name={n.visible ? 'eye' : 'eye-off'} size={16} />
        </button>
      </li>
      {isGroup && open && [...n.children].reverse().map((c, i) => (
        <LayerRow key={c.id} n={c} depth={depth + 1} containerId={containerId} index={n.children.length - 1 - i} dragId={dragId} setDragId={setDragId} focusable={false} />
      ))}
    </>
  );
}

export function LayersPanel() {
  const ed = useEditor();
  const [dragId, setDragId] = useState<Id | null>(null);
  const scrollRef = useScrollEdges<HTMLDivElement>();
  const c = ed.activeContainer;
  if (!c) return null;
  const sel = ed.selectedNodes();
  const first = sel[0];
  const doc = ed.doc!;
  const page = doc.pages.find((p) => p.id === c.id);
  const master = page?.masterId ? doc.masters.find((m) => m.id === page.masterId) : null;
  const rows = [...c.nodes].reverse();
  const focusId = rows.find((n) => ed.ui.selection.includes(n.id))?.id ?? rows[0]?.id;
  const setOpacity = (v: number) => ed.commit('Opacity', (d) => updateNodes(d, ed.ui.selection, (m) => ({ ...m, opacity: v / 100 })), 'layer-opacity');
  const mixedOpacity = sel.some((m) => m.opacity !== first?.opacity);
  const photo = ed.ui.studio === 'photo';
  return (
    <div className="layers-panel">
      {/* Photo keeps Photoshop's blend · opacity header; Vector and Layout edit these in the inspector */}
      {photo && <div className={`layers-head${first ? '' : ' disabled'}`}>
        <select value={first?.blend ?? 'normal'} disabled={!first} aria-label="Layer blend mode" onChange={(e) => ed.commit('Blend mode', (d) => updateNodes(d, ed.ui.selection, (m) => ({ ...m, blend: e.target.value as BlendMode })))}>
          {BLEND_MODES.map((m) => <option key={m} value={m}>{m.replace(/-/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase())}</option>)}
        </select>
        <NumberField className="opacity-field" label="Opacity" ariaLabel="Layer opacity percent" unit="%" digits={0} min={0} max={100} value={Math.round((first?.opacity ?? 1) * 100)} mixed={mixedOpacity} disabled={!first} onChange={setOpacity} onCommit={setOpacity} />
      </div>}
      <div className="layers-scroll" ref={scrollRef}>
        {c.nodes.length === 0 && <LayersEmpty />}
        <ul className="layer-list" role="tree" aria-label="Layers" aria-multiselectable="true">
          {rows.map((n, i) => (
            <LayerRow key={n.id} n={n} depth={0} containerId={c.id} index={c.nodes.length - 1 - i} dragId={dragId} setDragId={setDragId} focusable={n.id === focusId} />
          ))}
        </ul>
        {master && master.nodes.length > 0 && (
          <div className="master-note">
            <span>{master.nodes.length} item{master.nodes.length > 1 ? 's' : ''} from master “{master.name}”</span>
            <button className="btn ghost sm" onClick={() => ed.setUi({ activeContainerId: master.id, selection: [] })}>Edit master</button>
          </div>
        )}
      </div>
      <div className="layer-actions" role="toolbar" aria-label="Layer actions">
        <button className="icon-btn sm" {...tip('New pixel layer', 'layer.new-pixel')} onClick={() => runCommand('layer.new-pixel')}><Icon name="plus" /></button>
        <button className="icon-btn sm" {...tip('Group', 'arrange.group')} disabled={sel.length < 2} onClick={() => runCommand('arrange.group')}><Icon name="group" /></button>
        <button className="icon-btn sm" {...tip('Mask to pixel selection', 'layer.mask-selection')} disabled={!sel.length || !ed.ui.pixelSelection} onClick={() => runCommand('layer.mask-selection')}><Icon name="mask" /></button>
        <button className="icon-btn sm" {...tip('Duplicate', 'edit.duplicate')} disabled={!sel.length} onClick={() => runCommand('edit.duplicate')}><Icon name="copy" /></button>
        <button className="icon-btn sm" {...tip('Bring forward', 'arrange.forward')} disabled={!sel.length} onClick={() => runCommand('arrange.forward')}><Icon name="arrow-up" /></button>
        <button className="icon-btn sm" {...tip('Send backward', 'arrange.backward')} disabled={!sel.length} onClick={() => runCommand('arrange.backward')}><Icon name="arrow-down" /></button>
        <span className="row-spacer" />
        <button className="icon-btn sm" {...tip('Delete', 'edit.delete')} disabled={!sel.length} onClick={() => runCommand('edit.delete')}><Icon name="trash" /></button>
      </div>
    </div>
  );
}

/**
 * Empty Layers panel teaches the model instead of saying "nothing here"
 * (UX gap list, MOBBIN #8): what this list is, and the three ways to start.
 */
function LayersEmpty() {
  const ed = useEditor();
  const photo = ed.ui.studio === 'photo';
    return (
    <EmptyState
      icon="layers"
      title="No layers yet"
      className="layers-empty"
      actions={
        <>
          <button type="button" className="btn ghost sm" onClick={() => runCommand('file.place')}><Icon name="image" /> Place image</button>
          {photo ? (
            <button type="button" className="btn ghost sm" onClick={() => ed.setTool('brush')}><Icon name="brush" /> Paint</button>
          ) : (
            <button type="button" className="btn ghost sm" onClick={() => ed.setTool('rect')}><Icon name="rect" /> Draw a shape</button>
          )}
          <button type="button" className="btn ghost sm" onClick={() => ed.setTool('text')}><Icon name="text" /> Add text</button>
        </>
      }
      footnote="Or drop an image file onto the canvas."
    >
      Everything you add to this page stacks here, top to bottom. Drag rows to reorder, click the eye to hide.
    </EmptyState>
  );
}
