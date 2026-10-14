import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../hooks';
import { Icon } from '../Icons';
import { useScrollEdges } from '../controls/Panel';
import { PropertiesPanel } from './PropertiesPanel';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { LayersPanel } from './LayersPanel';
import { PagesPanel } from './PagesPanel';
import { HistoryPanel } from './HistoryPanel';
import { ColorPanel } from './ColorPanel';
import { SwatchesPanel } from './SwatchesPanel';
import { AssetsPanel } from './AssetsPanel';

type Tab = { id: string; label: string; render: () => JSX.Element; flush?: boolean };

/** Persisted layout of the three panel groups: fixed heights (the flexible group ignores its own) and collapse flags. */
interface PanelLayout {
  h: [number, number, number];
  collapsed: [boolean, boolean, boolean];
}
const LAYOUT_KEY = 'quvrelo.panelLayout.v2';
const DEFAULT_LAYOUT: PanelLayout = { h: [0, 212, 140], collapsed: [false, false, false] };
const MIN_H = [160, 120, 84];

function loadLayout(): PanelLayout {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
    if (v && Array.isArray(v.h) && v.h.length === 3 && Array.isArray(v.collapsed)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_LAYOUT;
}

function PanelTabs({ tabs, active, onSelect, collapsed, onToggle, label, groupId }: { tabs: Tab[]; active: string; onSelect: (id: string) => void; collapsed: boolean; onToggle: () => void; label: string; groupId: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, tabs.findIndex((t) => t.id === active));
  return (
    <div className="panel-head">
      <button type="button" className="icon-btn xs panel-collapse" aria-expanded={!collapsed} aria-controls={`${groupId}-body`} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`} title={collapsed ? 'Expand' : 'Collapse'} onClick={onToggle}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} />
      </button>
      <div className="panel-tabs" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="tab"
            id={`${groupId}-tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`${groupId}-body`}
            tabIndex={i === idx ? 0 : -1}
            className={t.id === active ? 'active' : ''}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : d ? (i + d + tabs.length) % tabs.length : -1;
              if (n < 0) return;
              e.preventDefault();
              onSelect(tabs[n].id);
              refs.current[n]?.focus();
            }}
            data-panel={t.id}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelGroup({ tabs, initial, label, groupId, collapsed, onToggle, style }: { tabs: Tab[]; initial: string; label: string; groupId: string; collapsed: boolean; onToggle: () => void; style: React.CSSProperties }) {
  const [active, setActive] = useState(initial);
  useEffect(() => setActive(initial), [initial]);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  const scrollRef = useScrollEdges<HTMLDivElement>();
  const select = (id: string) => {
    setActive(id);
    if (collapsed) onToggle();
  };
  return (
    <section className={`panel-group${collapsed ? ' collapsed' : ''}`} style={style} aria-label={label} data-group={groupId}>
      <PanelTabs tabs={tabs} active={tab.id} onSelect={select} collapsed={collapsed} onToggle={onToggle} label={label} groupId={groupId} />
      {!collapsed && (
        <div ref={scrollRef} id={`${groupId}-body`} className={`panel-body${tab.flush ? ' flush' : ''}`} role="tabpanel" aria-labelledby={`${groupId}-tab-${tab.id}`} key={tab.id}>
          {tab.render()}
        </div>
      )}
    </section>
  );
}

/** Drag handle on the hairline between two groups (also keyboard: arrows, Shift for big steps, Enter resets). */
function Splitter({ onDrag, onEnd, onReset, label, value }: { onDrag: (dy: number) => void; onEnd: () => void; onReset: () => void; label: string; value: number }) {
  return (
    <div
      className="panel-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
        const y0 = e.clientY;
        const mv = (ev: PointerEvent) => onDrag(ev.clientY - y0);
        const up = () => {
          el.classList.remove('dragging');
          el.removeEventListener('pointermove', mv);
          el.removeEventListener('pointerup', up);
          onEnd();
        };
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', up);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') return onReset();
        const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        onDrag(d * (e.shiftKey ? 32 : 8));
        onEnd();
      }}
    />
  );
}

export function Panels() {
  const ed = useEditor();
  const studio = ed.ui.studio;
  const [layout, setLayout] = useState<PanelLayout>(loadLayout);
  const drag = useRef<{ start: PanelLayout; sizes: number[] } | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const save = (l: PanelLayout) => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
    } catch {
      /* ignore */
    }
  };
  const groups: { id: string; label: string; tabs: Tab[]; initial: string }[] = [
    {
      id: 'inspector',
      label: 'Inspector',
      tabs: [
        { id: 'properties', label: 'Properties', render: () => <PropertiesPanel /> },
        ...(studio === 'photo' ? [{ id: 'adjust', label: 'Adjustments', render: () => <AdjustmentsPanel /> }] : []),
        { id: 'colour', label: 'Colour', render: () => <ColorPanel /> },
      ],
      initial: studio === 'photo' ? 'adjust' : 'properties',
    },
    {
      id: 'structure',
      label: 'Document structure',
      tabs: [
        { id: 'layers', label: 'Layers', render: () => <LayersPanel />, flush: true },
        { id: 'pages', label: 'Pages', render: () => <PagesPanel /> },
        { id: 'history', label: 'History', render: () => <HistoryPanel /> },
      ],
      initial: studio === 'layout' ? 'pages' : 'layers',
    },
    {
      id: 'library',
      label: 'Library',
      tabs: [
        { id: 'swatches', label: 'Swatches', render: () => <SwatchesPanel /> },
        { id: 'assets', label: 'Assets', render: () => <AssetsPanel /> },
      ],
      initial: 'swatches',
    },
  ];
  // the first expanded group takes the free space; the rest keep their height
  const flexIdx = layout.collapsed.findIndex((c) => !c);
  const styleFor = (i: number): React.CSSProperties => {
    if (layout.collapsed[i]) return { flex: 'none' };
    if (i === flexIdx) return { flex: '1 1 0', minHeight: MIN_H[i] };
    return { flex: 'none', height: Math.max(MIN_H[i], layout.h[i]) };
  };
  const toggle = (i: number) => {
    const collapsed = [...layout.collapsed] as PanelLayout['collapsed'];
    collapsed[i] = !collapsed[i];
    const next = { ...layout, collapsed };
    setLayout(next);
    save(next);
  };
  const begin = () => {
    const els = rootRef.current?.querySelectorAll<HTMLElement>(':scope > .panel-group') ?? [];
    drag.current = { start: layout, sizes: [...els].map((e) => e.getBoundingClientRect().height) };
  };
  /** move the hairline between group a and the next expanded group b by dy */
  const dragSplit = (a: number, b: number, dy: number) => {
    if (!drag.current) begin();
    const { start, sizes } = drag.current!;
    const lo = Math.max(-(sizes[a] - MIN_H[a]), -Infinity);
    const hi = sizes[b] - MIN_H[b];
    const d = Math.max(lo, Math.min(hi, dy));
    const h = [...start.h] as PanelLayout['h'];
    if (a !== flexIdx) h[a] = sizes[a] + d;
    if (b !== flexIdx) h[b] = sizes[b] - d;
    setLayout({ ...start, h });
  };
  const end = () => {
    drag.current = null;
    setLayout((l) => {
      save(l);
      return l;
    });
  };
  const items: JSX.Element[] = [];
  groups.forEach((g, i) => {
    if (i > 0) {
      // splitter sits between the previous expanded group and this one, only when both are expanded
      const a = i - 1;
      if (!layout.collapsed[a] && !layout.collapsed[i]) {
        items.push(
          <Splitter
            key={`split-${i}`}
            label={`Resize ${groups[a].label} and ${g.label}`}
            value={layout.h[i === flexIdx ? a : i]}
            onDrag={(dy) => dragSplit(a, i, dy)}
            onEnd={end}
            onReset={() => {
              const h = [...layout.h] as PanelLayout['h'];
              h[a] = DEFAULT_LAYOUT.h[a];
              h[i] = DEFAULT_LAYOUT.h[i];
              const next = { ...layout, h };
              setLayout(next);
              save(next);
            }}
          />,
        );
      }
    }
    items.push(<PanelGroup key={g.id} groupId={g.id} label={g.label} tabs={g.tabs} initial={g.initial} collapsed={layout.collapsed[i]} onToggle={() => toggle(i)} style={styleFor(i)} />);
  });
  return (
    <aside className="panels" aria-label="Panels" ref={rootRef}>
      {items}
    </aside>
  );
}
