import { useState } from 'react';
import { moveNodeTo, updateNode } from '../../../core/commands';
import { DISPLAY_NAME_MAX, layerDisplayName } from '../../../core/document';
import type { Adjustment, AdjustmentType, Id, RasterNode, SceneNode } from '../../../core/types';
import { ADJUSTMENTS, defaultParams } from '../../../core/pixels';
import { newId } from '../../../core/ids';
import { Menu, useMenu, type MenuEntry } from '../controls/Menu';
import { editor } from '../../state/editor';
import { getViewport, runCommand } from '../../state/commands';
import { useEditor } from '../hooks';
import { Icon } from '../Icons';
import { useScrollEdges } from '../controls/Panel';
import { EmptyState } from '../controls/EmptyState';
import { shortcutFor, tip } from '../tips';
import { dropIndex, isNoopDrop } from './layerDrop';
import { thumbTint } from '../color/colorMath';
import '../photo.css';

const TYPE_ICON: Record<SceneNode['type'], string> = {
  rect: 'rect', ellipse: 'ellipse', polygon: 'polygon', star: 'star', path: 'pen', text: 'text', textframe: 'textframe',
  imageframe: 'imageframe', raster: 'pixel', adjustment: 'adjust', group: 'group',
};

/** The thumbnail tile colour of the current theme (`--c-raised`), cached per theme. */
let tileCache: { theme: string; color: string } | null = null;
function thumbTile(): string {
  const theme = document.documentElement.dataset.theme ?? 'dark';
  if (tileCache?.theme !== theme) {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--c-raised').trim();
    tileCache = { theme, color: v || '#1e1f21' };
  }
  return tileCache.color;
}

function Thumb({ n }: { n: SceneNode }) {
  if ((n.type === 'raster' || (n.type === 'imageframe' && n.assetId)) && editor.assets.get((n as { assetId: string }).assetId)) {
    const c = editor.assets.get((n as { assetId: string }).assetId)!;
    return (
      <span className="thumb" style={{ backgroundImage: `url(${thumbUrl(c)})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
    );
  }
  const fill = 'fill' in n && n.fill.type === 'solid' ? n.fill.color : undefined;
  const color = thumbTint(fill, thumbTile()) ?? undefined;
  return (
    <span className="thumb" style={color ? { ['--thumb' as string]: color } : undefined}>
      <Icon name={TYPE_ICON[n.type]} />
    </span>
  );
}

/**
 * Pixel-mask thumbnail (white = shown). Click: paint the mask instead of the
 * pixels (click again to go back); Shift-click: turn the mask off / on.
 */
function MaskThumb({ n }: { n: SceneNode }) {
  const ed = useEditor();
  const pm = n.pixelMask!;
  const c = editor.assets.get(pm.assetId);
  const editing = ed.ui.maskEditId === n.id;
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`mask-thumb${editing ? ' editing' : ''}${pm.enabled ? '' : ' off'}`}
      style={c ? { backgroundImage: `url(${maskUrl(c)})` } : undefined}
      aria-label={editing ? 'Editing mask (click to edit pixels)' : 'Edit mask'}
      aria-pressed={editing}
      data-tip={editing ? 'Painting the mask · click to paint pixels' : 'Click to paint the mask · Shift-click turns it off'}
      data-mask-thumb={n.id}
      onClick={(e) => {
        e.stopPropagation();
        editor.select([n.id]);
        if (e.shiftKey) void runCommand('layer.mask-enable');
        else editor.setUi({ maskEditId: editing ? null : n.id });
      }}
    />
  );
}

const maskCache = new WeakMap<HTMLCanvasElement, string>();
/** Mask alpha as a black / white thumbnail. */
function maskUrl(c: HTMLCanvasElement): string {
  let u = maskCache.get(c);
  if (!u) {
    const s = 40 / Math.max(c.width, c.height);
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(c.width * s));
    t.height = Math.max(1, Math.round(c.height * s));
    const x = t.getContext('2d')!;
    x.fillStyle = '#000';
    x.fillRect(0, 0, t.width, t.height);
    const w = document.createElement('canvas');
    w.width = t.width;
    w.height = t.height;
    const wx = w.getContext('2d')!;
    wx.drawImage(c, 0, 0, t.width, t.height);
    wx.globalCompositeOperation = 'source-in';
    wx.fillStyle = '#fff';
    wx.fillRect(0, 0, t.width, t.height);
    x.drawImage(w, 0, 0);
    u = t.toDataURL();
    maskCache.set(c, u);
  }
  return u;
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
  const label = layerDisplayName(n, ed.doc, DISPLAY_NAME_MAX);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [drop, setDrop] = useState<DropPlace | null>(null);
  const selected = ed.ui.selection.includes(n.id);
  // Photo: the active layer reads as selected even with an empty object selection (CRITIQUE-4 R2)
  const active = !selected && ed.ui.studio === 'photo' && !ed.ui.selection.length && ed.ui.activeLayerId === n.id;
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
        className={`layer-row${selected || active ? ' selected' : ''}${active ? ' active-layer' : ''}${n.visible ? '' : ' hidden-layer'}${n.locked ? ' locked' : ''}${n.clipped ? ' clipped' : ''}${drop ? ` drop-${drop}` : ''}${dragId === n.id ? ' dragging' : ''}`}
        style={{ ['--depth' as string]: depth }}
        onClick={click}
        onMouseEnter={() => getViewport()?.setHover(n.id)}
        onMouseLeave={() => getViewport()?.setHover(null)}
        onDoubleClick={() => setRenaming(true)}
        draggable={depth === 0 && !renaming}
        onDragStart={(e) => {
          setDragId(n.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', label);
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
        aria-selected={selected || active}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isGroup ? open : undefined}
        aria-label={`${label}${n.visible ? '' : ', hidden'}${n.locked ? ', locked' : ''}${n.clipped ? ', clipped' : ''}${n.pixelMask ? ', masked' : ''}`}
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
 {n.clipped && <span className="clip-mark" data-tip="Clipped to the layer below" aria-hidden="true"><Icon name="clip" size={16} /></span>}
        <Thumb n={n} />
        {n.pixelMask && <MaskThumb n={n} />}
        <span className="name" data-tip={!renaming && label.length > 20 ? label : undefined}>
          {renaming ? (
            <input
              type="text"
              autoFocus
              defaultValue={label}
              aria-label="Layer name"
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                setRenaming(false);
                const v = e.target.value.trim();
                if (v && v !== label) ed.commit('Rename layer', (d) => updateNode(d, n.id, { name: v }));
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            label
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
  const doc = ed.doc!;
  const page = doc.pages.find((p) => p.id === c.id);
  const master = page?.masterId ? doc.masters.find((m) => m.id === page.masterId) : null;
  const rows = [...c.nodes].reverse();
  const focusId = rows.find((n) => ed.ui.selection.includes(n.id))?.id ?? rows.find((n) => n.id === ed.ui.activeLayerId)?.id ?? rows[0]?.id;
  // Opacity and blend live in one place, Design › Appearance, in every studio
  // (critique 2 P1-4); rows keep their eye/lock quick actions.
  return (
    <div className="layers-panel">
      <div className="layers-scroll" ref={scrollRef}>
        {c.nodes.length === 0 && <LayersEmpty compact={!!page} />}
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
        <AddLayerMenu />
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

const FILTER_TYPES = new Set<AdjustmentType>(['blur', 'sharpen', 'noise', 'vignette']);

/** Menu entries behind the Layers footer "+" (UX audit P1-8). */
export function addLayerItems(opts: { studio: string; selection: SceneNode[]; canPlace: boolean }): MenuEntry[] {
  const raster = opts.selection.find((n): n is RasterNode => n.type === 'raster');
  const items: MenuEntry[] = [
    { id: 'pixel', label: 'Pixel layer', icon: 'pixel', keys: shortcutFor('layer.new-pixel'), run: () => runCommand('layer.new-pixel') },
    { id: 'group', label: 'Group selection', icon: 'group', keys: shortcutFor('arrange.group'), disabled: opts.selection.length < 2, detail: opts.selection.length < 2 ? 'Select two or more layers' : undefined, run: () => runCommand('arrange.group') },
  ];
  if (opts.canPlace) items.push({ id: 'place', label: 'Place image…', icon: 'image', keys: shortcutFor('file.place'), run: () => runCommand('file.place') });
  if (opts.studio === 'photo') {
    items.push('-', { heading: 'Adjustment' });
    ADJUSTMENTS.filter((x) => !FILTER_TYPES.has(x.type)).forEach((a, i) => {
      items.push({
        id: `adj-${a.type}`,
        label: a.label,
        icon: 'adjust',
        disabled: !raster,
        detail: !raster && i === 0 ? 'Select a pixel layer first' : undefined,
        run: () => {
          if (!raster) return;
          const adj: Adjustment = { id: newId('adj'), type: a.type, enabled: true, params: defaultParams(a.type) };
          editor.commit('Adjustment', (d) => updateNode(d, raster.id, { adjustments: [...raster.adjustments, adj] } as Partial<SceneNode>));
        },
      });
    });
  }
  return items;
}

/** Footer "+": opens the add menu (Pixel layer · Group · Place image… · Adjustment). */
function AddLayerMenu() {
  const ed = useEditor();
  const [anchor, toggle, close] = useMenu();
  const items = addLayerItems({ studio: ed.ui.studio, selection: ed.selectedNodes(), canPlace: ed.feature('import-images') });
  return (
    <>
      <button type="button" className="icon-btn sm layer-add" {...tip('Add layer')} aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => toggle(e.currentTarget)}>
        <Icon name="plus" />
      </button>
      {anchor && <Menu anchor={anchor} label="Add layer" items={items} side="above" minWidth={208} onClose={close} />}
    </>
  );
}

/**
 * Empty Layers panel teaches the model instead of saying "nothing here"
 * (UX gap list, MOBBIN #8): what this list is, and the three ways to start.
 * When the canvas shows its own empty card (an empty page), that card owns the
 * actions and this shrinks to glyph, title and one line, so the window never
 * shows two empty states with the same three buttons (critique 3 P2-3).
 */
function LayersEmpty({ compact }: { compact: boolean }) {
  const ed = useEditor();
  const photo = ed.ui.studio === 'photo';
  if (compact) {
    return (
      <EmptyState icon="layers" title="No layers yet" className="layers-empty compact">
        Everything you add to this page stacks here, top to bottom.
      </EmptyState>
    );
  }
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
