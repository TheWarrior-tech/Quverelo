import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SceneNode } from '../../core/types';
import { updateNode } from '../../core/commands';
import { solid } from '../../core/document';
import type { Viewport } from '../engine/Viewport';
import { editor } from '../state/editor';
import { runCommand } from '../state/commands';
import { useEditor } from './hooks';
import { Icon } from './Icons';
import { tip, shortcutFor } from './tooltip';
import { ColorChipButton } from './color/Chips';
import { MenuButton, type MenuItem } from './controls/Menu';
import { NumberField } from './controls/NumberField';
import { FontPicker } from './controls/FontPicker';
import { activeTextTarget } from './ContextBar';
import { primaryFamily } from './fonts';
import { applyFillToSelection, applyStrokeToSelection, nodeFill } from './panels/ColorPanel';
import { FIT_OPTIONS } from './panels/PropertiesPanel';

type Box = { left: number; top: number; right: number; bottom: number };
const GAP = 8;
const SHAPES = new Set<SceneNode['type']>(['rect', 'ellipse', 'polygon', 'star', 'path']);

const sameBox = (a: Box | null, b: Box | null) => !!a && !!b && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.right - b.right) < 0.5 && Math.abs(a.bottom - b.bottom) < 0.5;

/** Selection rect and canvas rect in window coordinates, tracked through renders, pans and zooms. */
function useSelectionBox(vp: Viewport): { sel: Box | null; area: Box | null; busy: boolean } {
  const [state, setState] = useState<{ sel: Box | null; area: Box | null; busy: boolean }>({ sel: null, area: null, busy: false });
  const zooming = useRef(0);
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const h = vp.host.getBoundingClientRect();
      const r = vp.selectionRect();
      const sel = r ? { left: h.left + r.x, top: h.top + r.y, right: h.left + r.x + r.w, bottom: h.top + r.y + r.h } : null;
      const area = { left: h.left, top: h.top, right: h.right, bottom: h.bottom };
      const busy = vp.interacting || zooming.current > 0;
      setState((s) => (s.busy === busy && (s.sel === sel || sameBox(s.sel, sel)) && sameBox(s.area, area) ? s : { sel, area, busy }));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    let wheelTimer = 0;
    const onWheel = () => {
      zooming.current = 1;
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        zooming.current = 0;
        schedule();
      }, 160);
      schedule();
    };
    const off = vp.onChrome(schedule);
    vp.host.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      off();
      cancelAnimationFrame(raf);
      window.clearTimeout(wheelTimer);
      vp.host.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', schedule);
    };
  }, [vp]);
  return state;
}

const sep = (k: string) => <span key={k} className="stb-sep" aria-hidden="true" />;

function ShapeGroup({ nodes }: { nodes: SceneNode[] }) {
  const n = nodes[0];
  const fill = nodeFill(n) ?? { type: 'none' as const };
  const stroke = 'stroke' in n ? n.stroke.paint : { type: 'none' as const };
  const col = (p: typeof fill, fb: string) => (p.type === 'solid' ? p.color : p.type === 'none' ? fb : p.stops[0]?.color ?? fb);
  return (
    <>
      <ColorChipButton kind="fill" label="Fill" chevron={false} color={col(fill, editor.ui.fillColor)} enabled={fill.type !== 'none'} onChange={(c) => applyFillToSelection(solid(c), 'stb-fill')} onToggle={(on) => applyFillToSelection(on ? solid(col(fill, editor.ui.fillColor)) : { type: 'none' })} />
      <ColorChipButton kind="stroke" label="Stroke" chevron={false} color={col(stroke, editor.ui.strokeColor)} enabled={stroke.type !== 'none'} onChange={(c) => applyStrokeToSelection(solid(c), 'stb-stroke')} onToggle={(on) => applyStrokeToSelection(on ? solid(col(stroke, editor.ui.strokeColor)) : { type: 'none' })} />
    </>
  );
}

function TextGroup() {
  const target = activeTextTarget();
  if (!target) return null;
  const st = target.style;
  return (
    <>
      <FontPicker compact value={primaryFamily(st.fontFamily)} onPreview={(f) => target.apply({ fontFamily: f })} onCommit={(f) => target.apply({ fontFamily: f })} />
      <NumberField className="stb-size" ariaLabel="Font size (pt)" label="Size" unit="pt" value={st.fontSize} min={4} max={1000} onChange={(v) => target.apply({ fontSize: v })} onCommit={(v) => target.apply({ fontSize: v })} />
      <button type="button" className={`icon-btn sm${st.fontWeight >= 600 ? ' active' : ''}`} {...tip('Bold')} aria-pressed={st.fontWeight >= 600} onClick={() => target.apply({ fontWeight: st.fontWeight >= 600 ? 400 : 700 })}><b>B</b></button>
      <button type="button" className={`icon-btn sm${st.italic ? ' active' : ''}`} {...tip('Italic')} aria-pressed={st.italic} onClick={() => target.apply({ italic: !st.italic })}><i>I</i></button>
      <ColorChipButton kind="fill" label="Text colour" chevron={false} color={st.fill.type === 'solid' ? st.fill.color : '#000000'} enabled onChange={(c) => target.apply({ fill: solid(c) })} />
    </>
  );
}

function FrameGroup({ node }: { node: Extract<SceneNode, { type: 'imageframe' }> }) {
  return (
    <>
      <MenuButton
        label={`Fit: ${FIT_OPTIONS.find((f) => f.value === node.fit)?.label ?? ''}`}
        showLabel
        items={FIT_OPTIONS.map((f) => ({ id: f.value, label: f.title, icon: f.value === node.fit ? 'check' : undefined, run: () => editor.commit('Frame fit', (d) => updateNode(d, node.id, { fit: f.value, contentX: 0, contentY: 0, contentScale: 1 } as Partial<SceneNode>)) }))}
      />
      <button type="button" className="btn ghost sm" onClick={() => runCommand('file.place')}><Icon name="image" /> Replace…</button>
    </>
  );
}

/**
 * Floating selection toolbar (UX P1-12, MOBBIN #6): the 3–5 most likely next
 * actions, 8px under the selection (above when there is no room), shown after
 * pointer-up and hidden while dragging, transforming or zooming. F6 moves
 * keyboard focus into it; Esc returns to the canvas. Preferences ▸ Canvas
 * turns it off.
 */
export function SelectionToolbar({ viewport }: { viewport: Viewport }) {
  const ed = useEditor();
  const { sel, area, busy } = useSelectionBox(viewport);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const nodes = ed.selectedNodes();
  const enabled = ed.settings.showSelectionToolbar !== false;
  const show = enabled && !!sel && !!area && !busy && ed.ui.tool === 'move' && nodes.length > 0 && !ed.ui.editingTextId;

  useLayoutEffect(() => {
    if (!show || !ref.current || !sel || !area) return setPos(null);
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    let top = sel.bottom + GAP;
    let above = false;
    if (top + h > area.bottom - GAP) {
      top = sel.top - GAP - h;
      above = true;
    }
    top = Math.max(area.top + GAP, Math.min(top, area.bottom - GAP - h));
    const cx = (sel.left + sel.right) / 2;
    const left = Math.max(area.left + GAP, Math.min(cx - w / 2, area.right - GAP - w));
    setPos((p) => (p && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 && p.above === above ? p : { left, top, above }));
  }, [show, sel, area, nodes.length, ed.version]);

  // F6 jumps into the toolbar (and back to the canvas)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F6' || !ref.current) return;
      if (ref.current.contains(document.activeElement)) {
        e.preventDefault();
        viewport.host.querySelector<HTMLElement>('canvas')?.focus();
        return;
      }
      const first = ref.current.querySelector<HTMLElement>('button:not(:disabled), input');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewport]);

  if (!show) return null;
  const types = new Set(nodes.map((n) => n.type));
  const allText = [...types].every((t) => t === 'text' || t === 'textframe');
  const allShapes = [...types].every((t) => SHAPES.has(t));
  const single = nodes.length === 1 ? nodes[0] : null;
  const arrange: MenuItem[] = [
    { id: 'front', label: 'Bring to front', keys: shortcutFor('arrange.front'), run: () => runCommand('arrange.front') },
    { id: 'forward', label: 'Bring forward', keys: shortcutFor('arrange.forward'), run: () => runCommand('arrange.forward') },
    { id: 'backward', label: 'Send backward', keys: shortcutFor('arrange.backward'), run: () => runCommand('arrange.backward') },
    { id: 'back', label: 'Send to back', keys: shortcutFor('arrange.back'), run: () => runCommand('arrange.back') },
  ];
  const groups: JSX.Element[] = [];
  if (allText) groups.push(<TextGroup key="text" />);
  else if (single?.type === 'imageframe') groups.push(<FrameGroup key="frame" node={single} />);
  else if (allShapes) groups.push(<ShapeGroup key="shape" nodes={nodes} />);
  else if (single?.type === 'raster')
    groups.push(
      <span key="raster" className="stb-group">
        <button type="button" className="icon-btn sm" {...tip('Flip horizontal')} onClick={() => runCommand('arrange.flip-h')}><Icon name="flip-h" /></button>
        <button type="button" className="icon-btn sm" {...tip('Flip vertical')} onClick={() => runCommand('arrange.flip-v')}><Icon name="flip-v" /></button>
        <button type="button" className="icon-btn sm" {...tip('Rotate 90° clockwise')} onClick={() => runCommand('arrange.rotate-cw')}><Icon name="rotate" /></button>
      </span>,
    );
  const tail: JSX.Element[] = [<MenuButton key="arrange" label="Arrange" icon="layers" items={arrange} />];
  if (ed.ui.studio === 'vector' && nodes.length >= 2 && allShapes)
    tail.push(
      <MenuButton
        key="bool"
        label="Boolean"
        icon="bool-add"
        items={[
          { id: 'add', label: 'Add', icon: 'bool-add', run: () => runCommand('layer.bool-add') },
          { id: 'subtract', label: 'Subtract', icon: 'bool-subtract', run: () => runCommand('layer.bool-subtract') },
          { id: 'intersect', label: 'Intersect', icon: 'bool-intersect', run: () => runCommand('layer.bool-intersect') },
          { id: 'exclude', label: 'Exclude', icon: 'bool-exclude', run: () => runCommand('layer.bool-exclude') },
          { id: 'divide', label: 'Divide', icon: 'bool-divide', run: () => runCommand('layer.bool-divide') },
        ]}
      />,
    );
  if (nodes.length > 1) tail.push(<button key="group" type="button" className="icon-btn sm" {...tip('Group', 'arrange.group')} onClick={() => runCommand('arrange.group')}><Icon name="group" /></button>);
  else if (single?.type === 'group') tail.push(<button key="ungroup" type="button" className="btn ghost sm" {...tip('Ungroup', 'arrange.ungroup')} onClick={() => runCommand('arrange.ungroup')}>Ungroup</button>);
  tail.push(<button key="dup" type="button" className="icon-btn sm" {...tip('Duplicate', 'edit.duplicate')} onClick={() => runCommand('edit.duplicate')}><Icon name="copy" /></button>);
  tail.push(<button key="del" type="button" className="icon-btn sm" {...tip('Delete', 'edit.delete')} onClick={() => runCommand('edit.delete')}><Icon name="trash" /></button>);
  return (
    <div
      ref={ref}
      className={`selection-toolbar${pos ? ' placed' : ''}${pos?.above ? ' above' : ''}`}
      role="toolbar"
      aria-label="Selection actions"
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input')) viewport.host.querySelector<HTMLElement>('canvas')?.focus();
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
          const i = items.indexOf(document.activeElement as HTMLElement);
          if (i < 0) return;
          e.preventDefault();
          items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}
    >
      {groups.length ? [...groups, sep('s1'), ...tail] : tail}
    </div>
  );
}
